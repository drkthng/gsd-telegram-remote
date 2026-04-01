# How to Reset the Test Projects

## Overview

Both test projects (`gsd-test-telegram`, `gsd-test-telegram-2`) use a 3×3×3 fixture:
- 1 milestone (M001) × 3 slices × 3 tasks = 9 tasks total
- Each task writes one file to `test-output/` and verifies with `test -f`

After a full auto-mode run, everything is marked complete. This documents what needs to be wiped to get back to a clean M001-pending state.

---

## Where GSD State Actually Lives

The `.gsd/` directory in each project is a **symlink**:
- `D:/AiProjects/gsd-test-telegram/.gsd` → `C:/Users/Gordon/.gsd/projects/4f2f24a08231/`
- `D:/AiProjects/gsd-test-telegram-2/.gsd` → `C:/Users/Gordon/.gsd/projects/96382b3beb87/`

The reset script must be passed the project dir (e.g. `D:/AiProjects/gsd-test-telegram`) and it resolves `.gsd/` through the symlink automatically.

---

## What Needs to Be Reset

### 1. GSD Database (`gsd.db`)
- Delete `gsd.db`, `gsd.db-shm`, `gsd.db-wal`
- Recreate with schema + M001 milestone/slices/tasks in `planned`/`pending` status
- All of M002/M003/M004 rows must be absent

### 2. Milestone directories M002–M004
- Delete entirely from `.gsd/milestones/`

### 3. Completion artifacts in M001
Delete these file types (keep only PLAN files and ROADMAP):
- `*-SUMMARY.md` (task and slice summaries)
- `*-UAT.md` (slice UAT results)
- `*-ASSESSMENT.md` (post-slice roadmap assessments)
- `*-VALIDATION.md` (milestone validation)

### 4. Plan checkboxes — `S0*-PLAN.md` and `T0*-PLAN.md`
- Replace all `[x]` with `[ ]`

### 5. ROADMAP.md — Done column
- The Done column shows `✅` for completed slices
- Must be reset to `[ ]` for all slices
- Pattern: `| SXX | ... | ✅ |` → `| SXX | ... | [ ] |`
- The "After this" column content (UAT text) can stay — GSD doesn't use it for state

### 6. PROJECT.md
- Rewrite to show only M001 as pending
- Remove references to M002/M003/M004

### 7. STATE.md
- Rewrite: phase=planning, M001 active, no completed milestones

### 8. `event-log.jsonl`
- Truncate to empty

### 9. `state-manifest.json`
- Delete (GSD regenerates it)

### 10. `runtime/`
- Clear directory contents (GSD manages dispatch state here)

### 11. `doctor-history.jsonl` (if present)
- Truncate to empty

### 12. `test-output/`
- Delete all files (the task artifacts produced by auto-mode)

---

## Running the Reset

```sh
node D:/AiProjects/gsd-telegram-remote/scripts/reset-test-project.mjs D:/AiProjects/gsd-test-telegram
node D:/AiProjects/gsd-telegram-remote/scripts/reset-test-project.mjs D:/AiProjects/gsd-test-telegram-2
```

---

## Known Gotchas

### `.gsd` is a symlink — resolve it
Node's `fs` module follows symlinks by default, so paths like `join(projectDir, '.gsd', 'gsd.db')` work fine.

### ROADMAP.md Done column uses `✅` not `[x]`
The roadmap Done column uses a ✅ emoji (set by `gsd_slice_complete`/`gsd_complete_slice`), not markdown checkboxes. A `[x]` → `[ ]` replace won't catch it — need a separate regex: `| ✅ |` → `| [ ] |`.

### PROJECT.md is a living doc written by the agent
It gets updated at slice completion. After a full run it lists all milestones as complete. Must be rewritten manually (or by the reset script) to show only M001 as pending.

### DB schema must use GSD's own `openDatabase()` — never hand-craft the schema
The reset script **must not** create the DB schema manually. If you DELETE the DB and recreate it with hand-crafted `CREATE TABLE` statements, you'll produce a DB with an old partial schema but insert `schema_version=14`. GSD's migration guard sees v14 and skips all pending `ALTER TABLE` migrations silently — leaving ~20 columns missing. Symptom: auto-mode hits "no column named X" errors mid-run.

**Fix:** Delete the DB, then use GSD's own `openDatabase(path)` (exported from `~/.gsd/agent/extensions/gsd/gsd-db.js`) to initialise it. This runs the full migration chain and produces the correct schema. Then use `insertMilestone`/`insertSlice`/`insertTask` from the same module to seed the rows.

### DB file lock: close all GSD sessions before resetting
`rmSync(gsd.db)` throws `EPERM` if a GSD session for that project is still running (GSD holds an open file handle). Close all terminal tabs/windows running GSD for the target project before running the reset script. The script now exits with a clear error message if this happens.

### WAL files (`gsd.db-shm`, `gsd.db-wal`)
Must be deleted alongside `gsd.db` — leftover WAL files with a fresh DB cause corruption.
