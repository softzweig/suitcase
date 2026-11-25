import type { ResourceOwner } from "@softzweig/suitcase-core";
import type { UsageService } from "../services/usage.service.js";
import type {
  AnyDefinition,
  InferDefinitionExecutionContext,
  InferDefinitionUsageKinds,
} from "../suitcase.js";

/**
 * The usage endpoint, bound to one request's execution context.
 *
 * The caller names the kinds to add up and the owner they belong to; the owner's schema validates
 * it and its `authorize` answers for `action: "usage"`, so naming an owner is a request rather
 * than a permission. Only kinds whose owner reports usage can be named at all.
 *
 * Returns the service's result unchanged, as the other endpoints do.
 */
export class SuitcaseUsage<TDefinition extends AnyDefinition> {
  constructor(
    private readonly service: UsageService<TDefinition>,
    private readonly execution: InferDefinitionExecutionContext<TDefinition>,
  ) {}

  /**
   * What one owner currently holds across the given kinds, resources and uploads in flight added
   * up together.
   *
   * @see {@link UsageService.usage}
   * @human
   */
  total<const TKinds extends readonly InferDefinitionUsageKinds<TDefinition>[]>(input: {
    kinds: TKinds;
    owner: ResourceOwner;
  }) {
    return this.service.usage({ ...input, execution: this.execution });
  }
}
