import { ServiceError } from "@softzweig/spindle-core/service";
import type {
  UploadConstraintsResult,
  UploadFinalizeRequest,
  UploadInitializeRequest,
} from "@softzweig/suitcase-core/contracts";
import { ByteSize } from "@softzweig/suitcase-core/utils";
import type { UploadService } from "../services/upload.service.js";
import {
  type AnyDefinition,
  findDefinitionResource,
  type InferDefinitionExecutionContext,
  type InferDefinitionResourceKinds,
  type InferDefinitionUploadIntent,
} from "../suitcase.js";

/**
 * The upload endpoints, bound to one request's execution context.
 *
 * Each method stays generic over the kind and forwards that type argument to the service, so the
 * compiler checks the input against the service's own parameter list for every kind: a change
 * there breaks this file instead of drifting. `kind` and `payload` stay correlated, which is what
 * deriving a single input type from `Parameters<>` would lose.
 *
 * Methods return the service's execution unchanged: call `run()` for a `SpindleResult` to branch
 * on, or `unwrap()` it to throw at the edge. Mapping a code onto a transport's vocabulary is the
 * transport's job, not this layer's, so there is no error policy here to keep in sync.
 */
export class SuitcaseUploads<TDefinition extends AnyDefinition> {
  constructor(
    private readonly definition: TDefinition,
    private readonly service: UploadService<TDefinition>,
    private readonly execution: InferDefinitionExecutionContext<TDefinition>,
  ) {}

  /**
   * What a client has to send for a kind: the limits it will be held to, and whether an intent is
   * expected. Reads the definition only, so a transport can advertise it before any upload.
   *
   * `maxSize` comes back in bytes: the definition may state an operand, and a client comparing a
   * file against it should not have to parse one.
   *
   * @human
   */
  constraints<TKind extends InferDefinitionResourceKinds<TDefinition> & string>(
    kind: TKind,
  ): UploadConstraintsResult {
    const definition = findDefinitionResource(this.definition.resources, kind);
    ServiceError.assertFound(definition, "Resource definition not found", { kind });

    const upload = definition.upload;
    const maxSize = upload?.maxSize;

    return {
      hasIntent: Boolean(upload?.intent),
      maxSize: maxSize != null ? ByteSize.parse(maxSize).toBytes() : null,
      mimeTypes: upload?.mimeTypes ? [...upload.mimeTypes] : null,
    };
  }

  /**
   * Initializes a new upload session with given claims (user-defined).
   *
   * The claims are used to determine whether the upload session meets the constraints defined
   * for this resource, and the finalized uploaded file and claims will need to match the given
   * claims here exactly. The hash, size, and general asset-data that can be verified for
   * integrity, is verified for integrity. Thus, claims become a responsibility for a future
   * {@link finalize} call.
   *
   * Another advantage of the initialization step together with the verification claims is that
   * this function can also deduplicate the requested upload based on existing resources and
   * assets, possibly not requiring any further upload at all.
   *
   * This method does not actually upload the file; it only prepares a session that can be used
   * to perform the upload according to the defined constraints.
   *
   * @see {@link UploadService.initialize}
   * @human
   */
  initialize<TKind extends InferDefinitionResourceKinds<TDefinition>>(
    input: Omit<
      UploadInitializeRequest<InferDefinitionUploadIntent<TDefinition, TKind>>,
      "kind"
    > & {
      kind: TKind;
    },
  ) {
    return this.service.initialize<TKind>({ ...input, execution: this.execution });
  }

  /**
   * Finalizes an upload: claims the session, decides whether the bytes can be reused, then either
   * attaches the resource that already holds them or promotes the upload into a new one.
   *
   * Finalize is the actual verification step that ensures the upload meets all constraints,
   * the object is stored within the storage-layer correctly and its integrity is verified
   * against the initial upload constraints, and is re-evaluated against any deduplication,
   * reuse policies, and any other relevant authorizer defined in the Suitcase definition(s).
   *
   * This method ensures that the upload is either reused or promoted to a new resource,
   * depending on the deduplication and reuse policies.
   *
   * @see {@link initialize}
   * @see {@link UploadService.finalize}
   * @human
   */
  finalize(input: UploadFinalizeRequest) {
    return this.service.finalize({ ...input, execution: this.execution });
  }
}
