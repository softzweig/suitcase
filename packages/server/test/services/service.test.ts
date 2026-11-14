import { ServiceErrorCode } from "@softzweig/suitcase-core";
import { describe, expect, it } from "vitest";

import type {
  AssetRepository,
  ResourceRepository,
  UploadSessionRepository,
} from "../../src/repository.js";
import { ServiceError } from "../../src/services/service.error.js";
import { SuitcaseService, type SuitcaseServiceContext } from "../../src/services/service.js";
import { StorageError, StorageErrorCode } from "../../src/storage/storage.errors.js";

type TestContext = SuitcaseServiceContext & { readonly scope: string };

/** The base service never touches repositories itself; the runner binds them. */
const createContext = (scope: string, isInTransaction = false): TestContext => ({
  scope,
  isInTransaction,
  assetRepo: {} as AssetRepository,
  resourceRepo: {} as ResourceRepository,
  uploadSessionRepo: {} as UploadSessionRepository,
});

class TestService extends SuitcaseService<TestContext> {
  get scope(): string {
    return this.context.scope;
  }
}

/** A context holding another service, so its rebinding is observable. */
type RootContext = TestContext & { readonly inner: TestService };

class RootService extends SuitcaseService<RootContext> {}

/** A service whose runner hands out a context flagged as transactional. */
const createService = (scope = "pool") => {
  const runs: string[] = [];

  const service = new TestService(createContext(scope), (context, work) => {
    runs.push(context.scope);

    return work(createContext("transaction", true));
  });

  return { service, runs };
};

describe("SuitcaseService", () => {
  it("runs the callback with the transactional context", async () => {
    const { service, runs } = createService();

    const result = await service.transaction((context) => Promise.resolve(context.isInTransaction));

    expect(result).toBe(true);
    expect(runs).toEqual(["pool"]);
  });

  it("hands the callback a copy of the same subclass, as `this`", async () => {
    const { service } = createService();

    const seen = await service.transaction(function (context) {
      return Promise.resolve({
        isCopy: this !== service,
        isInTransaction: context.isInTransaction,
      });
    });

    expect(seen).toEqual({ isCopy: true, isInTransaction: true });
    expect(service.getContext().isInTransaction).toBe(false);
  });

  it("binds another context without mutating the original service", () => {
    const { service } = createService();

    const copy = service.withContext(createContext("bound"));

    expect(copy.scope).toBe("bound");
    expect(copy).toBeInstanceOf(TestService);
    expect(service.scope).toBe("pool");
  });

  it("asserts whether the service is transactional", async () => {
    const { service } = createService();

    expect(() => service.assertNotTransaction()).not.toThrow();
    expect(() => service.assertTransaction()).toThrow("not bound to a transaction");

    await service.transaction(function () {
      expect(() => this.assertTransaction()).not.toThrow();
      expect(() => this.assertNotTransaction()).toThrow("is bound to a transaction");

      return Promise.resolve();
    });
  });

  it("binds the services held by the context to the transaction", async () => {
    const inner = new TestService(createContext("inner"), (_context, work) =>
      work(createContext("inner", true)),
    );
    const context: RootContext = { ...createContext("pool"), inner };
    const service = new RootService(context, (original, work) =>
      work({ ...original, isInTransaction: true }),
    );

    const seen = await service.transaction((bound) =>
      Promise.resolve({
        isCopy: bound.inner !== inner,
        isInTransaction: bound.inner.getContext().isInTransaction,
        scope: bound.inner.getContext().scope,
      }),
    );

    expect(seen).toEqual({ isCopy: true, isInTransaction: true, scope: "pool" });
    expect(inner.getContext().isInTransaction).toBe(false);
    expect(inner.getContext().scope).toBe("inner");
  });

  it("carries plain context values over as they are", async () => {
    const context = createContext("pool");
    const service = new TestService(context, (original, work) =>
      work({ ...original, isInTransaction: true }),
    );

    const assetRepo = await service.transaction((bound) => Promise.resolve(bound.assetRepo));

    expect(assetRepo).toBe(context.assetRepo);
  });

  it("wraps a use case result", async () => {
    const { service } = createService();

    await expect(service.execute(async (context) => context.scope)).resolves.toEqual({
      ok: true,
      data: "pool",
    });
  });

  it("folds a thrown storage error into the result", async () => {
    const { service } = createService();

    const result = await service.execute(async () => {
      throw new StorageError(StorageErrorCode.NOT_FOUND, "asset missing");
    });

    expect(result).toEqual({
      ok: false,
      code: ServiceErrorCode.NOT_FOUND,
      message: "asset missing",
      details: { type: "storageError", code: StorageErrorCode.NOT_FOUND },
    });
  });

  it("unwraps the data of a successful call", async () => {
    const { service } = createService();

    await expect(service.execute(async (context) => context.scope).unwrap()).resolves.toBe("pool");
  });

  it("folds a synchronous throw into the result", async () => {
    const { service } = createService();

    const result = await service.execute(() => {
      throw new Error("boom");
    });

    expect(result).toMatchObject({ ok: false, code: ServiceErrorCode.UNKNOWN });
  });

  it("throws the domain error when unwrapping a failure", async () => {
    const { service } = createService();

    const failure = service.execute(async () => {
      throw new StorageError(StorageErrorCode.FORBIDDEN, "denied");
    });

    await expect(failure.unwrap()).rejects.toMatchObject({
      name: "ServiceError",
      code: ServiceErrorCode.FORBIDDEN,
      message: "denied",
    });
  });

  it("round-trips a thrown domain error back into the same failure", async () => {
    const { service } = createService();

    const result = await service.execute(async () => {
      throw ServiceError.notFound("gone", { assetId: "a_1" });
    });

    expect(result).toEqual({
      ok: false,
      code: ServiceErrorCode.NOT_FOUND,
      message: "gone",
      details: { assetId: "a_1" },
    });
  });

  it("folds a guard failure raised inside a transaction", async () => {
    const { service } = createService();

    const result = await service.transaction(async function () {
      return await this.nontransactional(async () => "data");
    });

    expect(result).toMatchObject({ ok: false, code: ServiceErrorCode.PRECONDITION_FAILED });
  });

  it("fails when the runner does not mark the context transactional", async () => {
    const service = new TestService(createContext("pool"), (_context, work) =>
      work(createContext("bound")),
    );

    const result = await service.transactional(async () => "data");

    expect(result).toMatchObject({ ok: false, code: ServiceErrorCode.PRECONDITION_FAILED });
  });
});
