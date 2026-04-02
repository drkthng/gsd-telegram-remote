#!/usr/bin/env node
/**
 * reset-test-project.mjs
 * Resets a gsd-test-telegram project back to a clean M001-pending state.
 *
 * What it does:
 *   1. Deletes M002, M003, M004 milestone dirs
 *   2. Deletes all *-SUMMARY.md, *-UAT.md, *-ASSESSMENT.md, *-VALIDATION.md from M001
 *   3. Resets all [x] checkboxes to [ ] in S0*-PLAN.md and T0*-PLAN.md files
 *   3b. Restores T02-PLAN.md (colour question task)
 *   3c. Resets ROADMAP.md Done column (✅ → [ ])
 *   3d. Resets PROJECT.md to pending M001 only
 *   4. Wipes the GSD sqlite DB (gsd.db) and repopulates M001 planned state
 *      using GSD's own openDatabase() so the full current schema is applied
 *   5. Clears test-output/
 *   6. Rewrites STATE.md, clears event-log.jsonl, runtime/, state-manifest.json
 */

import { rmSync, readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [,, projectDir] = process.argv;
if (!projectDir) {
  console.error('Usage: node reset-test-project.mjs <projectDir>');
  process.exit(1);
}

const gsdDir = resolve(join(projectDir, '.gsd'));  // resolve symlink for DB path
const milestonesDir = join(gsdDir, 'milestones');
const dbPath = join(gsdDir, 'gsd.db');

// ── 1. Delete M002–M004 milestone dirs ───────────────────────────────────────
for (const m of ['M002', 'M003', 'M004']) {
  const d = join(milestonesDir, m);
  if (existsSync(d)) {
    rmSync(d, { recursive: true, force: true });
    console.log(`Deleted ${d}`);
  }
}

// ── 2. Delete completion artifacts from M001 ──────────────────────────────────
const COMPLETION_SUFFIXES = ['-SUMMARY.md', '-UAT.md', '-ASSESSMENT.md', '-VALIDATION.md'];

function deleteCompletionFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      deleteCompletionFiles(full);
    } else if (COMPLETION_SUFFIXES.some(s => entry.name.endsWith(s))) {
      rmSync(full);
      console.log(`Deleted ${full}`);
    }
  }
}
deleteCompletionFiles(join(milestonesDir, 'M001'));

// ── 3. Reset checkboxes in all PLAN.md files ──────────────────────────────────
function resetCheckboxes(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      resetCheckboxes(full);
    } else if (entry.name.endsWith('-PLAN.md')) {
      const original = readFileSync(full, 'utf-8');
      const reset = original.replace(/\[x\]/g, '[ ]');
      if (reset !== original) {
        writeFileSync(full, reset);
        console.log(`Reset checkboxes: ${full}`);
      }
    }
  }
}
resetCheckboxes(join(milestonesDir, 'M001'));

// ── 3b. Restore T02-PLAN.md in S01 (colour question task) ────────────────────
// This task uses ask_user_questions to test the Telegram bridge. The plan file
// is always written from source-of-truth here so resets don't lose it.
const t02Path = join(milestonesDir, 'M001', 'slices', 'S01', 'tasks', 'T02-PLAN.md');
writeFileSync(t02Path, `---
estimated_steps: 3
estimated_files: 1
skills_used: []
---

# T02: Ask user for favourite colour and write output

Steps:
1. Call ask_user_questions with id="colour_choice", question="What is your favourite colour?", options=[{label:"Red"},{label:"Green"},{label:"Blue"},{label:"Yellow"}]
2. Create the file test-output/m001-s1-t2.txt
3. Write the chosen colour into it (e.g. "favourite colour: Red")

## Inputs
- (none)

## Expected Output
- \`test-output/m001-s1-t2.txt\`

## Verification
test -f test-output/m001-s1-t2.txt
`);
console.log(`Restored T02-PLAN.md (colour question)`);

// ── 3c. Reset ROADMAP.md Done column (✅ → [ ]) ────────────────────────────────
const roadmapPath = join(milestonesDir, 'M001', 'M001-ROADMAP.md');
if (existsSync(roadmapPath)) {
  const original = readFileSync(roadmapPath, 'utf-8');
  const reset = original.replaceAll('| ✅ |', '| [ ] |');
  if (reset !== original) {
    writeFileSync(roadmapPath, reset);
    console.log(`Reset ROADMAP.md Done column: ${roadmapPath}`);
  }
}

// ── 3d. Reset PROJECT.md ───────────────────────────────────────────────────────
writeFileSync(join(gsdDir, 'PROJECT.md'), `# GSD Test Project

A minimal GSD test project used to verify end-to-end GSD auto-mode execution and Telegram notification delivery.

## Milestone Status

| Milestone | Title | Status |
|-----------|-------|--------|
| M001 | Alpha batch | ⏳ pending |

## Current State

M001 is queued and ready for auto-mode execution. 3 slices × 3 tasks = 9 tasks total.
Each task writes one file to test-output/ and verifies with test -f.
`);
console.log(`Reset PROJECT.md`);

// ── 4. Wipe GSD DB and repopulate M001 state via GSD's own openDatabase() ────
//
// IMPORTANT: Do NOT hand-craft the schema. GSD's openDatabase() initialises the
// DB with the full current schema + runs all migrations, ensuring schema_version
// matches reality. Hand-crafting the schema causes a version mismatch where GSD
// sees schema_version=14 and skips ~20 ALTER TABLE migrations silently.
//
if (existsSync(dbPath)) {
  try {
    rmSync(dbPath, { force: true });
    for (const ext of ['-shm', '-wal']) {
      const w = dbPath + ext;
      if (existsSync(w)) rmSync(w, { force: true });
    }
    console.log(`Deleted ${dbPath} (and WAL/SHM if present)`);
  } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EBUSY') {
      console.error(`\nERROR: Cannot delete ${dbPath}`);
      console.error(`The DB is locked — a GSD session for this project is still running.`);
      console.error(`Close all GSD sessions for this project, then re-run the reset.\n`);
      process.exit(1);
    }
    throw e;
  }
}

// Import GSD's own DB module so it initialises the schema correctly.
// The file:// prefix is required for Windows absolute paths in ESM imports.
const gsdDbUrl = new URL(
  'file:///' + 'C:/Users/Gordon/.gsd/agent/extensions/gsd/gsd-db.js'
    .replaceAll('\\', '/').replace(/^\//, '')
);
const { openDatabase, insertMilestone, insertSlice, insertTask } =
  await import(gsdDbUrl.href);

const opened = openDatabase(dbPath);
if (!opened) {
  console.error('ERROR: GSD openDatabase() returned false — cannot init DB');
  process.exit(1);
}

// Insert M001 as 'planned' (status: 'active' is what insertMilestone defaults to,
// but 'planned' is what the ROADMAP checker wants for "not yet started")
insertMilestone({ id: 'M001', title: 'Alpha batch', status: 'planned' });

// Slices
const sliceTitles = { S01: 'Alpha wave 1', S02: 'Alpha wave 2', S03: 'Alpha wave 3' };
for (const [sid, title] of Object.entries(sliceTitles)) {
  insertSlice({ id: sid, milestoneId: 'M001', title, status: 'planned' });
}

// Tasks
const taskDefs = {
  S01: ['Create m001-s1-t1 output', 'Ask user for favourite colour and write output', 'Create m001-s1-t3 output'],
  S02: ['Create m001-s2-t1 output', 'Create m001-s2-t2 output', 'Create m001-s2-t3 output'],
  S03: ['Create m001-s3-t1 output', 'Create m001-s3-t2 output', 'Create m001-s3-t3 output'],
};
for (const [sid, titles] of Object.entries(taskDefs)) {
  titles.forEach((title, i) => {
    insertTask({ id: `T0${i + 1}`, sliceId: sid, milestoneId: 'M001', title, status: 'pending' });
  });
}

console.log(`Recreated DB via GSD openDatabase() with M001 planned state`);

// ── 5. Clear test-output/ ────────────────────────────────────────────────────
const testOutputDir = join(projectDir, 'test-output');
if (existsSync(testOutputDir)) {
  rmSync(testOutputDir, { recursive: true, force: true });
  mkdirSync(testOutputDir);
  console.log(`Cleared test-output/`);
}

// ── 6. Reset STATE.md ─────────────────────────────────────────────────────────
writeFileSync(join(gsdDir, 'STATE.md'), `# GSD State

**Active Milestone:** M001: Alpha batch
**Active Slice:** None
**Phase:** planning

## Milestone Registry
- ⏳ **M001:** Alpha batch

## Recent Decisions
- None recorded

## Blockers
- None

## Next Action
Run /gsd auto to start executing M001.
`);
console.log(`Reset STATE.md`);

// ── 7. Clear event-log.jsonl ──────────────────────────────────────────────────
writeFileSync(join(gsdDir, 'event-log.jsonl'), '');
console.log(`Cleared event-log.jsonl`);

// ── 8. Clear state-manifest.json ─────────────────────────────────────────────
const manifestPath = join(gsdDir, 'state-manifest.json');
if (existsSync(manifestPath)) {
  rmSync(manifestPath);
  console.log(`Deleted state-manifest.json`);
}

// ── 9. Clear runtime/ ────────────────────────────────────────────────────────
const runtimeDir = join(gsdDir, 'runtime');
if (existsSync(runtimeDir)) {
  rmSync(runtimeDir, { recursive: true, force: true });
  mkdirSync(runtimeDir);
  console.log(`Cleared runtime/`);
}

// ── 10. Clear doctor-history.jsonl if present ─────────────────────────────────
const doctorHistory = join(gsdDir, 'doctor-history.jsonl');
if (existsSync(doctorHistory)) {
  writeFileSync(doctorHistory, '');
  console.log(`Cleared doctor-history.jsonl`);
}

console.log(`\n✅ Reset complete: ${projectDir}`);
