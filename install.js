#!/usr/bin/env node
/**
 * install.js — Copy built extension to ~/.gsd/agent/extensions/gsd-telegram-remote/
 *
 * Usage:
 *   node install.js          — copies dist/ + package.json + extension-manifest.json
 *   node install.js --unlink — removes the installed extension directory
 *
 * Run after `npm run build`. Does not modify source files.
 */

import { copyFileSync, mkdirSync, readdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SRC_DIST = new URL("./dist/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const SRC_ROOT = new URL("./", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const DEST = join(homedir(), ".gsd", "agent", "extensions", "gsd-telegram-remote");

if (process.argv.includes("--unlink")) {
  if (existsSync(DEST)) {
    rmSync(DEST, { recursive: true });
    console.log(`✅ Removed ${DEST}`);
  } else {
    console.log(`ℹ️  Nothing to remove at ${DEST}`);
  }
  process.exit(0);
}

// Create dest dir
mkdirSync(join(DEST, "dist"), { recursive: true });

// Remove stale jiti-era files that would shadow index.js
for (const stale of ["index.ts", "src"]) {
  const stalePath = join(DEST, stale);
  if (existsSync(stalePath)) rmSync(stalePath, { recursive: true });
}

// Copy dist/ files
for (const file of readdirSync(SRC_DIST)) {
  copyFileSync(join(SRC_DIST, file), join(DEST, "dist", file));
}

// Copy root files
for (const file of ["package.json", "extension-manifest.json"]) {
  copyFileSync(join(SRC_ROOT, file), join(DEST, file));
}

// Write root index.js that re-exports from dist/index.js
// (GSD discovers index.js; index.ts is NOT present so index.js takes priority)
writeFileSync(
  join(DEST, "index.js"),
  `export { default } from "./dist/index.js";\n`,
  "utf-8"
);

console.log(`✅ Installed to ${DEST}`);
console.log(`   dist/ — ${readdirSync(join(DEST, "dist")).filter(f => f.endsWith(".js")).length} JS files`);
console.log(`   Restart GSD to load the updated extension.`);
