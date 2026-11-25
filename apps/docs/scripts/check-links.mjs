import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist", import.meta.url));
const repository = process.env.GITHUB_REPOSITORY ?? "softzweig/suitcase";
const repo = repository.split("/")[1] ?? "suitcase";
const base = `/${repo}`;

async function* filesOf(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* filesOf(path);
    else yield path;
  }
}

const pages = new Set();
const files = new Set();
for await (const file of filesOf(root)) {
  files.add(file);
  if (file.endsWith(".html")) pages.add(file);
}

const failures = [];

for (const file of pages) {
  const relativePath = relative(root, file).split(sep).join("/");
  const pageUrl = new URL(
    `${base}/${relativePath.replace(/index\.html$/, "")}`,
    "https://docs.local",
  );
  const html = await readFile(file, "utf8");

  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1];
    if (!href || href.startsWith("#") || /^[a-z]+:/i.test(href)) continue;

    const target = new URL(href, pageUrl);
    if (!target.pathname.startsWith(`${base}/`) && target.pathname !== base) continue;

    const pathname = decodeURIComponent(target.pathname).slice(base.length);
    const candidate = pathname.replace(/^\//, "");
    const exists =
      files.has(join(root, candidate)) || files.has(join(root, candidate, "index.html"));

    if (!exists) failures.push(`${relativePath}: ${href}`);
  }
}

if (failures.length > 0) {
  console.error(`Broken internal links:\n${failures.map((line) => `  ${line}`).join("\n")}`);
  process.exit(1);
}

console.log(`Checked ${pages.size} built pages, no broken internal links.`);
