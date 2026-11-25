---

title: React hooks
description: The provider, upload and mutation hooks, and batched resolves.
---

`@softzweig/suitcase-react` is headless. It renders nothing, so the picker, the grid, and the error
line stay yours. It provides one provider, one client accessor, and five workflows.

## Build the client once

```ts {2}
// suitcase/client.ts
import type { SuitcaseClient } from "./definition.js";
import { createSuitcaseClient } from "@softzweig/suitcase-client";

export const client = createSuitcaseClient<SuitcaseClient>({
  operations,
  transfer,
});
```

A client created inside a component restarts every batcher and queue behind it on each render. Build
it at module scope, or in a stable singleton outside React.

## Provide it

```tsx
import { SuitcaseProvider } from "@softzweig/suitcase-react";
import { client } from "./suitcase/client.js";

export function App() {
  return (
    <SuitcaseProvider client={client}>
      <YourScreens />
    </SuitcaseProvider>
  );
}
```

The provider also creates the upload queue that every upload under it shares.

## Hooks

| Hook                                        | Purpose                                                |
| ------------------------------------------- | ------------------------------------------------------ |
| `useSuitcaseClient<T>()`                    | The client the provider holds, typed by the definition |
| `useUploadQueue<T>()`                       | The provider's upload queue                            |
| `useUploadResource<T>()`                    | Upload one file, with phases and a queue               |
| `useResolveResource(client, kind?, input)`  | Resolve one id                                         |
| `useResolveResources(client, kind?, input)` | Resolve many ids                                       |
| `useUpdateResource<T>()`                    | Update a resource's label or metadata                  |
| `useDeleteResource<T>()`                    | Delete a resource                                      |

The resolve hooks take the client themselves, so they work with or without a provider and infer
kinds and claims from the client's definition.

## Upload

```tsx title="AvatarUploader.tsx" {3,6,13,20-25}
import type { ChangeEvent } from "react";
import { useUploadResource } from "@softzweig/suitcase-react";
import type { SuitcaseClient } from "./suitcase/definition.js";

export function AvatarUploader() {
  const state = useUploadResource<SuitcaseClient>();
  const { phase, result, error, upload } = state;

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    await upload({ kind: "avatar", file });
  }

  return (
    <div>
      <input type="file" accept="image/*" onChange={onChange} />
      {phase === "uploading" && <p>Uploading...</p>}
      {phase === "uploaded" && <p>Uploaded {result.resource.fileName}</p>}
      {phase === "failed" && (
        <p>
          {error.code}: {error.message}
          <button onClick={state.reset}>Try again</button>
        </p>
      )}
    </div>
  );
}
```

`phase` goes `idle`, `uploading`, `uploaded`, `failed`. `result` exists only on `uploaded`, `error`
only on `failed`. `upload()` settles with the result, or `undefined` on failure, so an event handler
can await it. Failures are state rather than thrown, because a screen usually shows the reason next
to the picker.

Uploads go through the provider's queue, so a burst of ten does not become ten parallel transfers.
Retries are not part of the hook.

Each `upload()` call settles with its own result while the state follows the most recent call.
Unmounting aborts whatever is still in flight, which drops a queued upload or stops a running one
inside `upload.start`. A signal you pass yourself keeps working alongside it.

## Update and delete

```tsx
const { update } = useUpdateResource<SuitcaseClient>();
const { remove } = useDeleteResource<SuitcaseClient>();

await update({ id, label: "Renamed" });
await remove(id);
```

`update` phases are `idle`, `updating`, `updated`, `failed`; `remove` phases are `idle`, `deleting`,
`deleted`, `failed`. Both settle with the stored or removed row, or `undefined` on failure.

Only `label` and `metadata` travel on an update. The id, kind, owner, and asset are what later
authorization is keyed on and cannot change. Whether the caller may change or remove the row is the
kind's owner authorizer's decision.

Neither hook keeps a cache. Drop the row from your own state, or refresh the query that produced the
ids.

## Resolve

```tsx
const { phase, entries } = useResolveResources(client, "companyDocument", {
  contexts: { companyId },
  ids,
});
```

- One kind: the context is taken bare, and is required when the kind declares a claim.
- Several kinds, or none: contexts are keyed by kind and optional, since a request may only touch
  kinds that ask for nothing.

Both hooks resolve again when their input changes. An empty list never reaches the backend. The
state is a union on `phase`, so `entries` exists only on `resolved`.

Contexts must be plain data. They are compared by stable serialization, both to decide whether to
re-resolve and to group a batch, so anything a serializer drops is invisible to that comparison.

## Batching

Lookups go through one batcher per client. A grid of avatars resolving their own id in the same tick
makes one call instead of one per cell. The singular hook is the plural one with one id, so a
component showing a single resource can share a call with the grid next to it.

The batcher caches nothing. It only groups calls inside one window.
