import type { SuitcaseClient } from "@softzweig/suitcase-client";
import type { ClientDefinition } from "@softzweig/suitcase-core/contracts";
import { createUploadQueue, type UploadQueue } from "@softzweig/suitcase-upload-queue";
import { createContext, type ReactNode, useContext, useMemo } from "react";

const SuitcaseContext = createContext<{
  readonly client: SuitcaseClient;
  readonly uploads: UploadQueue;
} | null>(null);

export function SuitcaseProvider<TDefinition extends ClientDefinition>({
  client,
  children,
}: Readonly<{
  /** Build it once, outside React: it is not state, and a new one per render restarts every call. */
  client: SuitcaseClient<TDefinition>;
  children?: ReactNode;
}>) {
  const scope = useMemo(() => {
    const erased = client as unknown as SuitcaseClient; // <- Type-widened to erase the definition

    return {
      client: erased,
      uploads: createUploadQueue(erased.upload.start),
    };
  }, [client]);

  return <SuitcaseContext.Provider value={scope}>{children}</SuitcaseContext.Provider>;
}

function useScope(hookName: string) {
  const scope = useContext(SuitcaseContext);
  if (!scope) throw new Error(`${hookName} must be used inside a SuitcaseProvider`);
  return scope;
}

/** Returns the client the provider holds, typed with the definition. */
export const useSuitcaseClient = <TDefinition extends ClientDefinition = ClientDefinition>() =>
  useScope("useSuitcaseClient").client as unknown as SuitcaseClient<TDefinition>;

/** The upload queue the provider holds, so every upload under it is paced by the same queue. */
export const useUploadQueue = <TDefinition extends ClientDefinition = ClientDefinition>() =>
  useScope("useUploadQueue").uploads as unknown as UploadQueue<TDefinition>;
