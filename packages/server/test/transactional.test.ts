import { describe, expect, test } from "vitest";
import { BaseTransactional, FOLLOWS_CONTEXT, TRANSACTION_EXECUTOR } from "../src/transactional.js";

type Context = {
  readonly isInTransaction: boolean;
  readonly sibling?: Service;
  readonly [TRANSACTION_EXECUTOR]?: unknown;
};

/** A service that follows the context it is held in, the way the real ones do. */
class Service extends BaseTransactional<Context> {
  readonly [FOLLOWS_CONTEXT] = true;
}

const service = () =>
  new Service({ isInTransaction: false }, async (context, work) => work(context));

describe("rebinding a context", () => {
  test("keeps the executor an adapter recorded", () => {
    const bound = service().withContext({
      isInTransaction: true,
      [TRANSACTION_EXECUTOR]: "the handle",
    });

    // Symbol-keyed state is the adapter's, and a nested transaction reads it back.
    expect(bound.getContext()[TRANSACTION_EXECUTOR]).toBe("the handle");
  });

  test("still binds the services the context holds", () => {
    const sibling = service();
    const bound = service().withContext({ isInTransaction: true, sibling });

    const rebound = bound.getContext().sibling;

    expect(rebound).not.toBe(sibling);
    expect(rebound?.getContext().isInTransaction).toBe(true);
  });
});
