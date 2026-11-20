import type { SuitcaseClient } from "@softzweig/suitcase-client";
import { renderHook } from "@testing-library/react";
import { SuitcaseProvider } from "../../src/index.js";
import type { TestDefinition } from "./client.js";

export function renderWithClient<TResult, TProps>(
  client: SuitcaseClient<TestDefinition>,
  hook: (props: TProps) => TResult,
  initialProps?: TProps,
) {
  return renderHook(hook, {
    initialProps,
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <SuitcaseProvider client={client}>{children}</SuitcaseProvider>
    ),
  });
}
