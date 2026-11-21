// jsdom replaces `EventTarget`, but `process` stays Node's, so p-queue asks the builtin
// `node:events` for `setMaxListeners` and hands it a jsdom `EventTarget`, which Node rejects.
// The call only silences a warning, so hiding that builtin is enough.
const getBuiltinModule = process.getBuiltinModule?.bind(process);

process.getBuiltinModule = ((id: string) =>
  id === "node:events" ? undefined : getBuiltinModule?.(id)) as typeof process.getBuiltinModule;
