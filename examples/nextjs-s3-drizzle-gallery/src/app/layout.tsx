import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  description: "Upload a photo, see it on the wall.",
  title: "Suitcase gallery",
};

export default function Root({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="mx-auto max-w-5xl bg-neutral-50 px-5 py-10 font-sans text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
