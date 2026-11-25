"use client";

import {
  useDeleteResource,
  useResolveResources,
  useSuitcaseClient,
} from "@softzweig/suitcase-react";
import { useRouter } from "next/navigation";
import type { GalleryClient } from "@/suitcase/definition";
import { Controls } from "./controls";

/** A photo the page knows about before any link is asked for: its own row's facts. */
export type WallEntry = Readonly<{ id: string; owner: string; assetId: string }>;

/** The link the wall resolved for one photo, as its card renders it. */
type PhotoLink = Readonly<{ fileName: string; href: string; label: string | null }>;

/**
 * The wall, as the browser sees it: the entries come from the server component, the links come
 * from the resolve hook, which asks for them through the client's batcher.
 */
export function Gallery({ photos }: Readonly<{ photos: readonly WallEntry[] }>) {
  const client = useSuitcaseClient<GalleryClient>();
  const { entries, phase } = useResolveResources(client, { ids: photos.map(({ id }) => id) });

  // A failed id answers with a code instead of a link, so the wall shows what it could resolve.
  const links = new Map(
    (entries ?? []).flatMap((entry) => (entry.ok ? [[entry.id, entry] as const] : [])),
  );

  return (
    <>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Gallery</h1>
        <Controls />
      </header>

      <ul className="mb-8 list-disc space-y-1.5 rounded-2xl border border-neutral-200/80 bg-white/70 p-4 pl-8 text-sm text-neutral-600 shadow-sm marker:text-neutral-300 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400 dark:marker:text-neutral-700">
        <li>
          Upload the same image twice as the same user. The second one reuses the bytes stored.
        </li>
        <li>
          Upload it again as someone else. The two cards keep different owners but show the same
          asset id, because the bytes are stored once.
        </li>
        <li>
          Remove one of those two cards: the other keeps working, because the bytes are shared.
        </li>
        <li>Open the network tab. The file goes straight to S3, not through /api/suitcase.</li>
      </ul>

      {phase === "failed" ? (
        <p className="text-sm text-red-600 dark:text-red-400">The wall could not be loaded.</p>
      ) : null}

      {photos.length === 0 ? (
        <p className="text-neutral-500">Nothing here yet: pick an image to start the wall.</p>
      ) : (
        <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-5 p-0">
          {photos.map(({ assetId, id, owner }) => {
            const photo = links.get(id);
            if (!photo) return null;

            return (
              <PhotoCard
                assetId={assetId}
                key={id}
                link={{ fileName: photo.fileName, href: photo.url.url, label: photo.label }}
                owner={owner}
                resourceId={id}
              />
            );
          })}
        </ul>
      )}
    </>
  );
}

/**
 * One card: the link the wall resolved, its owner, and the call that removes the row behind it.
 *
 * Removing a card never deletes bytes. Suitcase marks the asset once no resource points at it and
 * purges it through the job queue `db.ts` wires, so a shared upload outlives the card that went.
 */
function PhotoCard({
  assetId,
  link,
  owner,
  resourceId,
}: Readonly<{ assetId: string; link: PhotoLink; owner: string; resourceId: string }>) {
  const router = useRouter();
  const { error, phase, remove } = useDeleteResource<GalleryClient>();

  async function removeCard() {
    // Settles with the row that went, or `undefined` when the backend refused. The wall is a server
    // render, so a removed card asks for it again.
    if (await remove(resourceId)) router.refresh();
  }

  return (
    <li className="group flex flex-col gap-2 rounded-2xl border border-neutral-200/80 bg-white p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900/60">
      {/* A plain img: the point is the signed URL, not image optimization. */}
      {/* biome-ignore lint/performance/noImgElement: next/image cannot cache a signed URL */}
      <img
        alt={link.label ?? link.fileName}
        className="h-44 w-full rounded-xl bg-neutral-100 object-cover ring-1 ring-black/5 dark:bg-neutral-800 dark:ring-white/10"
        src={link.href}
      />
      <div className="flex flex-col gap-1 px-1 pb-1">
        <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
          {link.label ?? link.fileName}
        </span>
        <div className="flex items-center justify-between gap-2 text-xs text-neutral-400">
          <span className="truncate">by {owner}</span>
          <span className="flex shrink-0 items-center gap-1">
            <span
              className="rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
              title={assetId}
            >
              {assetId.slice(0, 8)}
            </span>
            <button
              className="rounded-md px-1.5 py-0.5 font-medium transition hover:bg-neutral-100 hover:text-red-600 disabled:opacity-50 dark:hover:bg-neutral-800 dark:hover:text-red-400"
              disabled={phase === "deleting"}
              onClick={() => void removeCard()}
              type="button"
            >
              {phase === "deleting" ? "Removing…" : "Remove"}
            </button>
          </span>
        </div>
        {error ? (
          <span className="text-xs text-red-600 dark:text-red-400">{error.message}</span>
        ) : null}
      </div>
    </li>
  );
}
