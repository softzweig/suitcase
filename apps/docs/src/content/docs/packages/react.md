---

title: react
description: The provider and the hooks.
---

`@softzweig/suitcase-react` is a headless binding over the client. It renders nothing.

## Provider

```tsx
import { SuitcaseProvider } from "@softzweig/suitcase-react";

<SuitcaseProvider client={client}>
  <App />
</SuitcaseProvider>;
```

The provider holds the client and creates the upload queue that every upload under it shares. Build
the client once, outside React.

## Hooks

```ts
useSuitcaseClient<T>();
useUploadQueue<T>();
useUploadResource<T>();
useResolveResource(client, kind?, input);
useResolveResources(client, kind?, input);
useUpdateResource<T>();
useDeleteResource<T>();
```

See [React hooks](/suitcase/guides/react/) for phases, inputs, and batching.

## What it does not do

- It does not style or render components.
- It does not cache resources between resolves.
- It does not decide what to render after a mutation. Drop the row from your state, or refresh the
  query that produced it.

## Peer requirement

React 19 or newer.
