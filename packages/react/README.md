# @softzweig/suitcase-react

Headless React bindings for Suitcase: a provider and three hooks over the client. It renders nothing,
so the picker, the grid and the error line stay yours.

## Usage

Build the client once, outside React, then hand it to the provider.

```tsx
import { createSuitcaseClient } from "@softzweig/suitcase-client";
import { SuitcaseProvider, useResolveResource, useUploadResource } from "@softzweig/suitcase-react";

const client = createSuitcaseClient<MyDefinition>({ operations, digest, transfer });

const Avatar = ({ id }: { id: string }) => {
  const { phase, entry } = useResolveResource(client, "avatar", {
    contexts: { userId },
    id,
  });

  if (phase === "loading") return <p>Loading</p>;
  if (!entry?.ok) return <p>{entry?.code}</p>;

  return <img alt="" src={entry.url.url} />;
};

export const App = () => (
  <SuitcaseProvider client={client}>
    <Avatar id={id} />
  </SuitcaseProvider>
);
```

The resolve hooks take the client themselves, so they work with or without a provider and infer the
kinds and claims from it. Build that client once: a client created per render restarts every call
behind it.

## `useSuitcase`

The client the tree was given, typed by the definition you name. It throws outside a provider.

## `useUploadResource`

`phase` goes `idle`, `uploading`, `uploaded`, `failed`; `result` and `error` carry the outcome and
`reset()` forgets it. `upload(input)` queues one upload and settles with the result, or `undefined`
when it failed, so a handler can await it. The state is a union on `phase`, so `result` exists only
where the phase is `uploaded` and `error` only where it is `failed`.

Failures are state rather than thrown, because a screen usually renders the reason next to the
picker. Uploads go through the provider's `@softzweig/suitcase-upload-queue`, so a burst of ten does
not become ten parallel transfers; `useUploadQueue()` reaches it for `size()`, `pending()`,
`pause()`, `start()` and `onIdle()`. Retries are still nobody's business here.

Each `upload()` call settles with its own result while the state follows the most recent call, so
two in a row cannot blur together. Unmounting aborts whatever is still in flight, which drops a
queued upload or stops a running one inside `upload.start`; a signal you pass on the upload keeps
working alongside it.

## `useResolveResource` and `useResolveResources`

`useResolveResources` resolves the ids and reports `entries`, one per id in the order asked;
`useResolveResource` resolves one id and reports `entry`. Both take the client, then an optional kind
or list of kinds, then the input:

```ts
useResolveResources(client, { contexts: { avatar: { userId } }, ids });
useResolveResources(client, "avatar", { contexts: { userId }, ids });
useResolveResources(client, ["avatar", "invoice"], { contexts: { avatar: { userId } }, ids });
useResolveResource(client, "avatar", { contexts: { userId }, id });
```

A context is the claim its kind's `read` declares, which the contract calls a claim. Naming one kind
takes its context bare, and requires it when the kind declares one; naming several, or none, takes
contexts keyed by kind and optional, since a request may only touch kinds that ask for nothing. The
kinds themselves are for typing: the request is the ids plus the contexts. Both hooks resolve again
whenever their input changes, and an empty list never reaches the backend. The state is a union on
`phase`, so `entry` or `entries` exists only where the phase is `resolved`.

Contexts have to be plain data. The hooks compare them by their stable serialisation, both to decide
whether to re-resolve and to group a batch, so two contexts that serialise alike are one and the
same, and anything a serialiser drops (`undefined`, functions, class instances) is invisible to it.

The singular hook is the plural one with one id, so a component showing a single resource shares a
call with the grid next to it.

Lookups go through one `@yornaath/batshit` batcher per client, so a grid of avatars resolving their
own id in the same tick makes one call rather than one per cell. Contexts travel with each lookup,
and a window is split into one call per context, because a call carries a single set.
`createResourceBatcher(client)` builds one by hand when one is needed outside a hook.

## What it is not

- **Not Suspense.** Every hook reports through state. A suspending variant would need the batcher
  to publish its updates to the renderer, so it is not here yet.
- **Not styling.** Nothing here ships markup.
