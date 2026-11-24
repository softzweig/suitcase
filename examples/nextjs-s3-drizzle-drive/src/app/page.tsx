import { cookies } from "next/headers";
import { adapters } from "@/db";
import { USER_COOKIE, userFromCookie } from "@/user";
import { Drive, type DriveEntry } from "./drive";

// The list is a read of the database, so it is rendered per request rather than at build time.
export const dynamic = "force-dynamic";

/** How many files the drive lists: there is no paging in this example. */
const NEWEST = 100;

/**
 * The app's own query over its own tables, scoped to one owner. Suitcase has no "list" operation
 * on purpose, so which rows are shown is the host's decision; the browser resolves the ids it was
 * given, and the definition's read authorizer decides which of them may become a link.
 */
async function filesOf(user: string): Promise<readonly DriveEntry[]> {
  const rows = await adapters.repositories.resources.findMany({ kind: "file" });
  const mine = rows.filter(({ owner }) => String(owner.userId) === user);

  // What a file *is* lives on the asset, not the resource: size and MIME type come from there.
  const assets = new Map(
    (await adapters.repositories.assets.findByIds(mine.map(({ assetId }) => assetId))).map(
      (asset) => [asset.id, asset],
    ),
  );

  return mine
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, NEWEST)
    .flatMap(({ assetId, createdAt, fileName, id }) => {
      const asset = assets.get(assetId);
      if (!asset) return [];

      return [{ createdAt, id, mimeType: asset.mimeType, name: fileName, size: asset.size }];
    });
}

export default async function Page() {
  const user = userFromCookie((await cookies()).get(USER_COOKIE)?.value);

  return (
    <main>
      <Drive files={await filesOf(user)} user={user} />
    </main>
  );
}
