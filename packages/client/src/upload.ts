import { type AssetHash, type ResourceMetadata, ServiceErrorCode } from "@softzweig/suitcase-core";
import type {
  ClientDefinition,
  ClientOperations,
  ClientResourceKind,
  UploadConstraintsResult,
  UploadFinalizeResult,
  UploadTarget,
} from "@softzweig/suitcase-core/contracts";
import { ByteSize, type DeclaredField } from "@softzweig/suitcase-core/utils";
import { SuitcaseClientError } from "./error.js";
import { type ProcessorRule, runFileProcessors } from "./processor.js";

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
  operations: ClientOperations<TDefinition>;
  digest: DigestFile;
  transfer: TransferFile;
  /** Applied to the file before it is claimed. Omitted means none, and the file goes as picked. */
  processors?: readonly ProcessorRule[];
}>;

/** Answers the limits a kind advertises, so a doomed upload is refused before it is hashed. */
function assertWithinLimits({ maxSize, mimeTypes }: UploadConstraintsResult, file: UploadFile) {
  if (maxSize !== null && file.size > maxSize) {
    throw new SuitcaseClientError(
      ServiceErrorCode.PRECONDITION_FAILED,
      `The file is larger than the ${ByteSize.fromBytes(maxSize).format()} this upload allows.`,
      { maxSize, size: file.size },
    );
  }

  if (mimeTypes !== null && !mimeTypes.includes(file.type)) {
    throw new SuitcaseClientError(
      ServiceErrorCode.PRECONDITION_FAILED,
      `The file type ${file.type} is not one this upload allows.`,
      { mimeTypes, mimeType: file.type },
    );
  }
}

/**
 * Runs one upload in the order the backend expects: learn the kind's limits, apply the
 * processors that ask for this file, check the result against those limits, claim what it is,
 * let the backend reuse or hand out a target, send the bytes, and finalize. A reused upload
 * never sends bytes.
 *
 * The limits are checked on what will actually be sent, never on the file as picked: a processor
 * may shrink it into range or turn it into an allowed type, and only the server's view of the
 * bytes decides.
 *
 * A `signal` cancels the attempt between every step and is handed to the processors and the
 * transfer, so the bytes in flight can stop. Aborting leaves nothing behind except a session the
 * backend expires on its own.
 */
export async function startUpload<
  TDefinition extends ClientDefinition,
  TKind extends ClientResourceKind<TDefinition>,
>(
  { file, intent, kind, metadata, signal }: UploadStart<TDefinition, TKind>,
  deps: UploadDependencies<TDefinition>,
): Promise<UploadStartResult> {
  signal?.throwIfAborted();
  const constraints = await deps.operations.uploads.constraints({ kind });

  signal?.throwIfAborted();
  const prepared = await runFileProcessors({
    constraints,
    file,
    kind,
    rules: deps.processors ?? [],
    signal,
  });
  assertWithinLimits(constraints, prepared);

  const bytes = await prepared.arrayBuffer();
  const hash = await deps.digest(bytes);

  signal?.throwIfAborted();
  const initialized = await deps.operations.uploads.initialize({
    claims: {
      ...hash,
      fileName: prepared.name,
      intent,
      metadata,
      mimeType: prepared.type,
      size: prepared.size,
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
