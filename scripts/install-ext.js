#!/usr/bin/env node
/**
 * install-ext.js — Install the compiled dist/ into the GSD community extension directory (~/.pi).
 *
 * Usage:
 *   node scripts/install-ext.js           — install
 *   node scripts/install-ext.js --unlink  — remove installed extension dir
 *
 * Windows-compatible: uses os.homedir() for cross-drive path resolution.
 * No shell commands or Unix path expansion (~) is used.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const EXT_ID = 'gsd-telegram-remote';
// Community extensions must live in ~/.pi, NOT ~/.gsd.
// ~/.gsd is reserved for bundled extensions synced from the gsd-pi package;
// anything placed there is silently ignored by the loader. See gsd-build/gsd-2#3133.
const EXT_DIR = path.join(os.homedir(), '.pi', 'agent', 'extensions', EXT_ID);
const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const DIST_SRC = path.join(PROJECT_ROOT, 'dist');
const DIST_DEST = path.join(EXT_DIR, 'dist');

const args = process.argv.slice(2);
const unlink = args.includes('--unlink');

if (unlink) {
  if (fs.existsSync(EXT_DIR)) {
    fs.rmSync(EXT_DIR, { recursive: true, force: true });
    console.log(`[uninstall-ext] Removed ${EXT_DIR}`);
  } else {
    console.log(`[uninstall-ext] Nothing to remove at ${EXT_DIR}`);
  }
  process.exit(0);
}

// --- Install ---

// Clean up stale copy in ~/.gsd/agent/extensions/ if it exists.
// ~/.gsd is reserved for bundled extensions — a copy there shadows the ~/.pi
// copy and causes the loader to skip it entirely (treated as bundled key). See gsd-build/gsd-2#3133.
const staleGsdDir = path.join(os.homedir(), '.gsd', 'agent', 'extensions', EXT_ID);
if (fs.existsSync(staleGsdDir)) {
  fs.rmSync(staleGsdDir, { recursive: true, force: true });
  console.log(`[install-ext] Removed stale ~/.gsd copy at ${staleGsdDir}`);
}

// Ensure extension root exists
fs.mkdirSync(EXT_DIR, { recursive: true });

// Wipe and recreate dist/ subdir
if (fs.existsSync(DIST_DEST)) {
  fs.rmSync(DIST_DEST, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DEST, { recursive: true });

// Copy all files from project dist/
console.log(`[install-ext] Copying dist/ → ${DIST_DEST}`);
fs.cpSync(DIST_SRC, DIST_DEST, { recursive: true });

// Copy extension-manifest.json
const manifestSrc = path.join(PROJECT_ROOT, 'extension-manifest.json');
const manifestDest = path.join(EXT_DIR, 'extension-manifest.json');
if (fs.existsSync(manifestSrc)) {
  fs.copyFileSync(manifestSrc, manifestDest);
  console.log('[install-ext] Copied extension-manifest.json');
}

// Copy package.json
const pkgSrc = path.join(PROJECT_ROOT, 'package.json');
const pkgDest = path.join(EXT_DIR, 'package.json');
if (fs.existsSync(pkgSrc)) {
  fs.copyFileSync(pkgSrc, pkgDest);
  console.log('[install-ext] Copied package.json');
}

// Write index.js proxy (or overwrite if stale)
const indexDest = path.join(EXT_DIR, 'index.js');
const indexContent = 'export { default } from "./dist/index.js";\n';
const existingIndex = fs.existsSync(indexDest) ? fs.readFileSync(indexDest, 'utf8') : '';
if (existingIndex.trim() !== indexContent.trim()) {
  fs.writeFileSync(indexDest, indexContent, 'utf8');
  console.log('[install-ext] Wrote index.js proxy');
} else {
  console.log('[install-ext] index.js proxy already correct');
}

// Verify installed paths
const installedIndex = path.join(DIST_DEST, 'index.js');
if (fs.existsSync(installedIndex)) {
  const content = fs.readFileSync(installedIndex, 'utf8');
  if (content.includes('../../gsd')) {
    console.error('[install-ext] ERROR: installed dist/index.js still has stale ../../gsd paths!');
    process.exit(1);
  }
  const jsFiles = fs.readdirSync(DIST_DEST).filter(f => f.endsWith('.js'));
  console.log(`[install-ext] Installed ${jsFiles.length} JS files`);
  console.log(`[install-ext] Path check: OK (no stale ../../gsd paths)`);
}

console.log(`[install-ext] Done. Extension installed at: ${EXT_DIR}`);
