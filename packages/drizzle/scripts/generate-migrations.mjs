import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(import.meta.dirname, "..");

// drizzle-kit exposes no `bin` subpath, so derive the CLI from its resolved entry
// point. Resolving through node (not PATH) keeps this working without pnpm's
// node_modules/.bin shims, e.g. when a CI step calls `node scripts/...` directly.
const drizzleKitBin = fileURLToPath(new URL("bin.cjs", import.meta.resolve("drizzle-kit")));

if (!existsSync(drizzleKitBin)) {
  console.error(`drizzle-kit CLI is not at ${drizzleKitBin}; recheck after upgrading drizzle-kit`);
  process.exit(1);
}

const configs = readdirSync(packageRoot)
  .filter((file) => file.startsWith("drizzle.") && file.endsWith(".config.ts"))
  .sort();

if (configs.length === 0) {
  console.error(`no drizzle.*.config.ts found in ${packageRoot}`);
  process.exit(1);
}

// Every dialect gets generated even if an earlier one fails, so a broken config
// never hides drift in the others; the exit code still fails the run.
const failed = configs.filter((config) => {
  console.log(`\n> ${config}`);
  const { status } = spawnSync(process.execPath, [drizzleKitBin, "generate", "--config", config], {
    cwd: packageRoot,
    stdio: "inherit",
  });

  return status !== 0;
});

if (failed.length > 0) {
  console.error(`\nmigration generation failed: ${failed.join(", ")}`);
  process.exit(1);
}
