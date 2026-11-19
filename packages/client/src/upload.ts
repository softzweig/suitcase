import { type AssetHash, type ResourceMetadata, ServiceErrorCode } from "@softzweig/suitcase-core";
import type {
  ClientDefinition,
  ClientResourceKind,
  SuitcaseOperations,
  UploadConstraintsResult,
  UploadFinalizeResult,
  UploadTarget,
} from "@softzweig/suitcase-core/contracts";
import { ByteSize, type DeclaredField } from "@softzweig/suitcase-core/utils";
import { SuitcaseClientError } from "./error.js";

/**
 * The parts of a file the client needs: its name, size and type, and its bytes.
 * A browser `File` satisfies this as it is, and so does any `Blob` given a name.
 */
export interface UploadFile {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Hashes the bytes an upload is claimed to have, so the backend can verify them. */
export type DigestFile = (bytes: ArrayBuffer) => Promise<AssetHash>;

/** Sends the bytes to the target the backend handed out, which is usually a signed `PUT`. */
export type TransferFile = (
  target: UploadTarget,
  bytes: ArrayBuffer,
  signal?: AbortSignal,
) => Promise<void>;

/**
 * What starting one upload takes: the file, the kind it becomes, and what the kind asks for.
 *
 * The `intent` comes from {@link DeclaredField}, so a kind that declares one cannot be uploaded
 * without it, and a kind that declares none accepts none.
 */
export type UploadStart<
  TDefinition extends ClientDefinition,
  TKind extends ClientResourceKind<TDefinition> = ClientResourceKind<TDefinition>,
> = {
  readonly kind: TKind;
  readonly file: UploadFile;
  /** Consumer metadata kept on the session for the backend's finalizer. */
  readonly metadata?: ResourceMetadata;
  /**
   * Cancels the upload. It is checked between steps and handed to the transfer, so it can stop
   * the bytes in flight; hashing is not interruptible, so a cancel never lands mid-digest.
   */
  readonly signal?: AbortSignal;
} & DeclaredField<"intent", TDefinition["resources"][TKind]["uploadIntent"]>;

/** The resource the upload produced, and whether the backend had to receive any bytes for it. */
export type UploadStartResult = UploadFinalizeResult & {
  readonly reused: boolean;
};

/**
 * What one upload needs from the environment it runs in: the operations to ask, the digest to
 * claim with, and the transfer to move the bytes. None of these is read from a global, so the
 * workflow stays usable in a browser, a worker or a test.
 */
export type UploadDependencies<TDefinition extends ClientDefinition> = Readonly<{
  operations: SuitcaseOperations<TDefinition>;
  digest: DigestFile;
  transfer: TransferFile;
}>;

/** Answers the limits a kind advertises, so a doomed upload is refused before it is hashed. */
function assertWithinLimits(limits: UploadConstraintsResult, file: UploadFile) {
  if (limits.maxSize !== null) {
    const limit = ByteSize.parse(limits.maxSize);

    if (limit.lt(file.size)) {
      throw new SuitcaseClientError(
        ServiceErrorCode.PRECONDITION_FAILED,
        `The file is larger than the ${limit.format()} this upload allows.`,
        { maxSize: limit.toBytes(), size: file.size },
      );
    }
  }

  if (limits.mimeTypes !== null && !limits.mimeTypes.includes(file.type)) {
    throw new SuitcaseClientError(
      ServiceErrorCode.PRECONDITION_FAILED,
      `The file type ${file.type} is not one this upload allows.`,
      { mimeTypes: limits.mimeTypes, mimeType: file.type },
    );
  }
}

/**
 * Runs one upload in the order the backend expects: check the kind's limits, claim what the file
 * is, let the backend reuse or hand out a target, send the bytes, and finalize. A reused upload
 * never sends bytes.
 *
 * A `signal` cancels the attempt: it is checked before anything is asked of the backend, and again
 * before hashing, before opening a session and before finalizing, and it is handed to the transfer
 * so the bytes in flight can stop. Aborting leaves nothing behind except a session the backend
 * expires on its own.
 */
export async function startUpload<
  TDefinition extends ClientDefinition,
  TKind extends ClientResourceKind<TDefinition>,
>(
  { file, intent, kind, metadata, signal }: UploadStart<TDefinition, TKind>,
  deps: UploadDependencies<TDefinition>,
): Promise<UploadStartResult> {
  signal?.throwIfAborted();
  assertWithinLimits(await deps.operations.uploads.constraints({ kind }), file);

  signal?.throwIfAborted();
  const bytes = await file.arrayBuffer();
  const hash = await deps.digest(bytes);

  signal?.throwIfAborted();
  const initialized = await deps.operations.uploads.initialize({
    claims: {
      ...hash,
      fileName: file.name,
      intent,
      metadata,
      mimeType: file.type,
      size: file.size,
    },
    kind,
  });

  if (initialized.reused) {
    return {
      resource: initialized.resource,
      reused: true,
      upload: initialized.upload,
    } as const;
  }

  await deps.transfer(initialized.target, bytes, signal);

  signal?.throwIfAborted();
  const finalized = await deps.operations.uploads.finalize({
    uploadId: initialized.upload.id,
  });

  return {
    ...finalized,
    reused: false,
  } as const;
}
