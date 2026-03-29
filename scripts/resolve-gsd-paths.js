#!/usr/bin/env node
/**
 * resolve-gsd-paths.js
 *
 * Dynamically resolves the @gsd/pi-coding-agent package location from the global
 * npm prefix, then writes tsconfig.build.json with a paths mapping so tsc can
 * find the type declarations without any hardcoded paths.
 *
 * Usage (via npm run build):
 *   node scripts/resolve-gsd-paths.js && tsc -p tsconfig.build.json
 */

import { execSync } from "child_process";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// Resolve global npm prefix portably
let globalPrefix;
try {
  globalPrefix = execSync("npm prefix -g", { encoding: "utf8" }).trim();
} catch (err) {
  console.error("[resolve-gsd-paths] Failed to run `npm prefix -g`:", err.message);
  process.exit(1);
}

const piCodingAgentPath = join(
  globalPrefix,
  "node_modules",
  "gsd-pi",
  "packages",
  "pi-coding-agent"
);

if (!existsSync(piCodingAgentPath)) {
  console.error(
    `[resolve-gsd-paths] @gsd/pi-coding-agent not found at: ${piCodingAgentPath}\n` +
    `Install gsd-pi globally: npm install -g gsd-pi`
  );
  process.exit(1);
}

// tsconfig paths entries with absolute paths require the explicit .d.ts extension
// when the project is on a different drive from the global npm prefix (Windows).
// Using .d.ts extension works for cross-drive absolute paths.
const absoluteEntryPoint = join(piCodingAgentPath, "dist", "index.d.ts").replace(/\\/g, "/");

const tsconfigBuild = {
  extends: "./tsconfig.json",
  compilerOptions: {
    paths: {
      "@gsd/pi-coding-agent": [absoluteEntryPoint],
    },
  },
};

const outPath = join(projectRoot, "tsconfig.build.json");
writeFileSync(outPath, JSON.stringify(tsconfigBuild, null, 2) + "\n", "utf8");
console.log(`[resolve-gsd-paths] Wrote tsconfig.build.json with path: ${absoluteEntryPoint}`);
