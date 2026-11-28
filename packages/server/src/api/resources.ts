import type {
  ResourceDeleteRequest,
  ResourceResolveRequest,
} from "@softzweig/suitcase-core/contracts";
import type { ResourceService, ResourceUpdateInput } from "../services/resource.service.js";
import type {
  AnyDefinition,
  InferDefinitionExecutionContext,
  InferDefinitionResourceClaims,
} from "../suitcase.js";

/**
 * The resource endpoints, bound to one request's execution context.
 *
 * Inputs come from the service's own argument types, so the two cannot drift; each method only
 * adds the `execution` the transport closed over. Methods return the service's execution
 * unchanged: call `run()` for a `SpindleResult` to branch on, or `unwrap()` it to throw at the
 * edge, so the error policy stays with the transport.
 */
export class SuitcaseResources<TDefinition extends AnyDefinition> {
  constructor(
    private readonly service: ResourceService<TDefinition>,
    private readonly execution: InferDefinitionExecutionContext<TDefinition>,
  ) {}

  /**
   * Resolves the requested resources into a download list, one entry per requested ID.
   *
   * Every entry reports its own status: `ok` carries the resource's naming plus its link, `error`
   * carries the failure category, so a caller can render the list as it is. Ids that do not exist
   * and ids the caller may not read both report `NOT_FOUND`, because telling them apart would
   * reveal resources the caller cannot read.
   *
   * The call itself fails only when the request exceeds `resolveLimit`, or when the definition
   * cannot answer for a kind at all (through `listReadable`), which is configuration rather than a
   * per-resource outcome.
   *
   * @see {@link ResourceService.resolve}
   * @human
   */
  resolve(input: ResourceResolveRequest<Partial<InferDefinitionResourceClaims<TDefinition>>>) {
    return this.service.resolve({ ...input, execution: this.execution });
  }

  /**
   * Updates a resource by applying the specified delta within a transaction and ensures
   * authorization of the update afterwards, causing a rollback, if authorization fails.
   *
   * @see {@link ResourceService.update}
   * @human
   */
  update(input: ResourceUpdateInput) {
    return this.service.update({ ...input, execution: this.execution });
  }

  /**
   * Deletes a resource by its ID within a transaction and ensures authorization of the
   * deletion afterwards, causing a rollback, if authorization fails.
   *
   * @see {@link ResourceService.delete}
   * @human
   */
  delete(input: ResourceDeleteRequest) {
    return this.service.delete({ ...input, execution: this.execution });
  }
}
