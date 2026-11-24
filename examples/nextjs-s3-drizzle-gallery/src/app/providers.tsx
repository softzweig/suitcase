"use client";

import { SuitcaseProvider } from "@softzweig/suitcase-react";
import type { ReactNode } from "react";
import { client } from "@/suitcase/client";

/** The client is built outside React; the provider only hands it down and paces its uploads. */
export function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return <SuitcaseProvider client={client}>{children}</SuitcaseProvider>;
}
