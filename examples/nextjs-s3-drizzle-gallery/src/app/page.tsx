import { adapters } from "@/db";
import { Gallery, type WallEntry } from "./gallery";

// The wall is a read of the database, so it is rendered per request rather than at build time.
export const dynamic = "force-dynamic";

/** How many of the newest photos the page shows. */
const NEWEST = 50;

/**
 * The app's own query over its own tables. Suitcase reads by id, never by list, so which photos
 * are on the wall is the host's decision; the links are resolved in the browser.
 */
async function newestPhotos(): Promise<readonly WallEntry[]> {
  const rows = await adapters.repositories.resources.findMany({ kind: "photo" });

  return rows
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, NEWEST)
    .map(({ id, owner, assetId }) => ({
      assetId,
      id,
      owner: String(owner.userId ?? "unknown"),
    }));
}

export default async function Page() {
  return (
    <main>
      <Gallery photos={await newestPhotos()} />
    </main>
  );
}
