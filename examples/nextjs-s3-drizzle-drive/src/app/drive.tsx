"use client";

import { ByteSize } from "@softzweig/suitcase-core/utils";
import { useResolveResources, useSuitcaseClient } from "@softzweig/suitcase-react";
import type { DriveClient } from "@/suitcase/definition";
import { Controls } from "./controls";
import { FileIcon } from "./file-icon";

/** A file the page knows about before any link is asked for: its row plus its asset's facts. */
export type DriveEntry = Readonly<{
  createdAt: string;
  id: string;
  mimeType: string;
  name: string;
  size: number;
}>;

const UPLOADED = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "FILE";
};

/**
 * The drive, as the browser sees it: the rows come from the server component, the links come from
 * the resolve hook, and a row the backend refuses simply never gets one.
 */
export function Drive({ files, user }: Readonly<{ files: readonly DriveEntry[]; user: string }>) {
  const client = useSuitcaseClient<DriveClient>();
  const { entries, phase } = useResolveResources(client, { ids: files.map(({ id }) => id) });

  // A refused id answers with a code instead of a link, so the row stays and the link does not.
  const links = new Map(
    (entries ?? []).flatMap((entry) => (entry.ok ? [[entry.id, entry.url.url] as const] : [])),
  );

  return (
    <>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Drive</h1>
        <Controls user={user} />
      </header>

      <ul className="mb-8 list-disc space-y-1.5 rounded-2xl border border-neutral-200/80 bg-white/70 p-4 pl-8 text-sm text-neutral-600 shadow-sm marker:text-neutral-300 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400 dark:marker:text-neutral-700">
        <li>
          Change the name above and the list changes with it: a file belongs to who uploaded it.
        </li>
        <li>Ask for another user&apos;s file id and it answers not-found, never a link.</li>
        <li>Open the network tab. The bytes go straight to S3, not through /api/suitcase.</li>
      </ul>

      {phase === "failed" ? (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400">The drive could not be read.</p>
      ) : null}

      {files.length === 0 ? (
        <p className="text-neutral-500">
          No files yet. Whatever you upload shows up here, and only for you.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200/80 overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-sm dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900/60">
          {files.map((file) => {
            const href = links.get(file.id);

            return (
              <li className="flex items-center gap-3 px-3 py-2.5" key={file.id}>
                {href && file.mimeType.startsWith("image/") ? (
                  // A plain img: the point is the signed URL, not image optimization.
                  // biome-ignore lint/performance/noImgElement: next/image cannot cache a signed URL
                  <img
                    alt={file.name}
                    className="size-10 shrink-0 rounded-lg bg-neutral-100 object-cover ring-1 ring-black/5 dark:bg-neutral-800 dark:ring-white/10"
                    src={href}
                  />
                ) : (
                  <FileIcon mimeType={file.mimeType} />
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                    {file.name}
                  </p>
                  <p className="truncate text-xs text-neutral-400">
                    {extensionOf(file.name)} · {ByteSize.fromBytes(file.size).format()} ·{" "}
                    {UPLOADED.format(new Date(file.createdAt))}
                  </p>
                </div>

                {href ? (
                  <a
                    className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                    href={href}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
