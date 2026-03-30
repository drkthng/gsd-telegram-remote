import { DatabaseSync } from 'node:sqlite';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROJECTS = ['gsd-test-telegram', 'gsd-test-telegram-2'];
const BASE_DIR = 'D:/AiProjects';

const MILESTONES = [
  { id: 'M001', title: 'Alpha batch', prefix: 'Alpha' },
  { id: 'M002', title: 'Beta batch', prefix: 'Beta' },
  { id: 'M003', title: 'Gamma batch', prefix: 'Gamma' },
];

for (const proj of PROJECTS) {
  const base = join(BASE_DIR, proj);
  const db = new DatabaseSync(join(base, '.gsd', 'gsd.db'));

  // Wipe all data in FK order
  for (const table of ['verification_evidence', 'quality_gates', 'slice_dependencies', 'replan_history', 'assessments', 'artifacts', 'tasks', 'slices', 'milestones']) {
    db.exec(`DELETE FROM ${table}`);
  }

  // M001-M003: 3 slices × 3 trivial tasks each
  for (const m of MILESTONES) {
    db.exec(`INSERT INTO milestones (id, title, status) VALUES ('${m.id}', '${m.title}', 'active')`);
    for (let s = 1; s <= 3; s++) {
      db.exec(`INSERT INTO slices (id, milestone_id, title, status) VALUES ('S0${s}', '${m.id}', '${m.prefix} wave ${s}', 'pending')`);
      for (let t = 1; t <= 3; t++) {
        const fname = `${m.id.toLowerCase()}-s${s}-t${t}`;
        db.exec(`INSERT INTO tasks (id, slice_id, milestone_id, title, status) VALUES ('T0${t}', 'S0${s}', '${m.id}', 'Create ${fname} output', 'pending')`);
      }
    }
  }

  // M004: notification + interaction
  db.exec(`INSERT INTO milestones (id, title, status) VALUES ('M004', 'Notification + Interaction test', 'active')`);
  db.exec(`INSERT INTO slices (id, milestone_id, title, status) VALUES ('S01', 'M004', 'Notification flow', 'pending')`);
  db.exec(`INSERT INTO slices (id, milestone_id, title, status) VALUES ('S02', 'M004', 'Interaction flow', 'pending')`);
  for (let t = 1; t <= 3; t++) {
    db.exec(`INSERT INTO tasks (id, slice_id, milestone_id, title, status) VALUES ('T0${t}', 'S01', 'M004', 'Create m4-s1-t${t} output', 'pending')`);
  }
  db.exec(`INSERT INTO tasks (id, slice_id, milestone_id, title, status) VALUES ('T01', 'S02', 'M004', 'Create m4-s2-t1 output', 'pending')`);
  db.exec(`INSERT INTO tasks (id, slice_id, milestone_id, title, status) VALUES ('T02', 'S02', 'M004', 'Ask user preferred color', 'pending')`);
  db.exec(`INSERT INTO tasks (id, slice_id, milestone_id, title, status) VALUES ('T03', 'S02', 'M004', 'Write color choice to file', 'pending')`);

  console.log(`${proj}: DB reset — 4 milestones, 11 slices, 33 tasks`);
  db.close();

  // Wipe and recreate milestone files
  const milestonesDir = join(base, '.gsd', 'milestones');
  rmSync(milestonesDir, { recursive: true, force: true });

  // M001-M003 plan files
  for (const m of MILESTONES) {
    const mDir = join(milestonesDir, m.id);
    mkdirSync(mDir, { recursive: true });

    let sliceRows = '';
    for (let s = 1; s <= 3; s++) {
      const dep = s === 1 ? '—' : 'S0' + (s - 1);
      sliceRows += `| S0${s} | ${m.prefix} wave ${s} | low | ${dep} | \\u2B1C | test-output files created |\n`;
    }
    writeFileSync(join(mDir, `${m.id}-ROADMAP.md`),
      `# ${m.id}: ${m.title}\n\n## Vision\nTrivial test milestone for Telegram notification validation.\n\n## Slice Overview\n| ID | Slice | Risk | Depends | Done | After this |\n|----|-------|------|---------|------|------------|\n${sliceRows}`);

    for (let s = 1; s <= 3; s++) {
      const sid = `S0${s}`;
      const tDir = join(mDir, 'slices', sid, 'tasks');
      mkdirSync(tDir, { recursive: true });

      let taskList = '';
      for (let t = 1; t <= 3; t++) {
        taskList += `- [ ] **T0${t}: Create ${m.id.toLowerCase()}-s${s}-t${t} output** \`est:1min\`\n`;
      }
      writeFileSync(join(mDir, 'slices', sid, `${sid}-PLAN.md`),
        `---\nestimated_steps: 6\nestimated_files: 3\nskills_used: []\n---\n\n# ${sid}: ${m.prefix} wave ${s}\n\n**Goal:** Write three trivial output files.\n**Success Criteria:** Files exist.\n**Proof Level:** file-exists check\n**Integration Closure:** Notifications fire.\n**Observability Impact:** Telegram receives notifications.\n\n## Tasks\n${taskList}`);

      for (let t = 1; t <= 3; t++) {
        const fname = `${m.id.toLowerCase()}-s${s}-t${t}`;
        writeFileSync(join(tDir, `T0${t}-PLAN.md`),
          `---\nestimated_steps: 2\nestimated_files: 1\nskills_used: []\n---\n\n# T0${t}: Create ${fname} output\n\nSteps:\n1. Create the file test-output/${fname}.txt\n2. Write the line "${fname} complete" into it\n\n## Inputs\n- (none)\n\n## Expected Output\n- \`test-output/${fname}.txt\`\n\n## Verification\ntest -f test-output/${fname}.txt\n`);
      }
    }
  }

  // M004 plan files
  const m4Dir = join(milestonesDir, 'M004');
  mkdirSync(m4Dir, { recursive: true });
  writeFileSync(join(m4Dir, 'M004-ROADMAP.md'),
    '# M004: Notification + Interaction test\n\n## Vision\nValidate notification delivery and remote user interaction via Telegram.\n\n## Slice Overview\n| ID | Slice | Risk | Depends | Done | After this |\n|----|-------|------|---------|------|------------|\n| S01 | Notification flow | low | — | ⬜ | 3 task + 1 slice notifications fire |\n| S02 | Interaction flow | low | S01 | ⬜ | ask_user_questions sent to Telegram, user answers |\n');

  // S01
  const s01Dir = join(m4Dir, 'slices', 'S01');
  mkdirSync(join(s01Dir, 'tasks'), { recursive: true });
  writeFileSync(join(s01Dir, 'S01-PLAN.md'),
    '---\nestimated_steps: 6\nestimated_files: 3\nskills_used: []\n---\n\n# S01: Notification flow\n\n**Goal:** Write three trivial output files.\n**Success Criteria:** test-output/m4-s1-t1/t2/t3.txt exist.\n**Proof Level:** file-exists check\n**Integration Closure:** 3 task + 1 slice notifications fire.\n**Observability Impact:** Telegram receives notifications.\n\n## Tasks\n- [ ] **T01: Create m4-s1-t1 output** `est:1min`\n- [ ] **T02: Create m4-s1-t2 output** `est:1min`\n- [ ] **T03: Create m4-s1-t3 output** `est:1min`\n');
  for (let t = 1; t <= 3; t++) {
    writeFileSync(join(s01Dir, 'tasks', `T0${t}-PLAN.md`),
      `---\nestimated_steps: 2\nestimated_files: 1\nskills_used: []\n---\n\n# T0${t}: Create m4-s1-t${t} output\n\nSteps:\n1. Create the file test-output/m4-s1-t${t}.txt\n2. Write the line "m4-s1-t${t} complete" into it\n\n## Inputs\n- (none)\n\n## Expected Output\n- \`test-output/m4-s1-t${t}.txt\`\n\n## Verification\ntest -f test-output/m4-s1-t${t}.txt\n`);
  }

  // S02
  const s02Dir = join(m4Dir, 'slices', 'S02');
  mkdirSync(join(s02Dir, 'tasks'), { recursive: true });
  writeFileSync(join(s02Dir, 'S02-PLAN.md'),
    '---\nestimated_steps: 6\nestimated_files: 3\nskills_used: []\n---\n\n# S02: Interaction flow\n\n**Goal:** Exercise remote ask_user_questions by asking user a question via Telegram.\n**Success Criteria:** test-output/m4-s2-t1.txt exists, test-output/m4-s2-color.txt contains user chosen color.\n**Proof Level:** file-exists + content check\n**Integration Closure:** ask_user_questions routes through Telegram.\n**Observability Impact:** Telegram receives question prompt and task notifications.\n\n## Tasks\n- [ ] **T01: Create m4-s2-t1 output** `est:1min`\n- [ ] **T02: Ask user preferred color** `est:2min`\n- [ ] **T03: Write color choice to file** `est:1min`\n');

  writeFileSync(join(s02Dir, 'tasks', 'T01-PLAN.md'),
    '---\nestimated_steps: 2\nestimated_files: 1\nskills_used: []\n---\n\n# T01: Create m4-s2-t1 output\n\nSteps:\n1. Create the file test-output/m4-s2-t1.txt\n2. Write the line "m4-s2-t1 complete" into it\n\n## Inputs\n- (none)\n\n## Expected Output\n- `test-output/m4-s2-t1.txt`\n\n## Verification\ntest -f test-output/m4-s2-t1.txt\n');

  writeFileSync(join(s02Dir, 'tasks', 'T02-PLAN.md'),
    '---\nestimated_steps: 2\nestimated_files: 1\nskills_used: []\n---\n\n# T02: Ask user preferred color\n\nSteps:\n1. Use the ask_user_questions tool to ask the user: "What is your preferred color?" with options: "Blue", "Red", "Green"\n2. Write their answer to test-output/m4-s2-color.txt\n\n## Inputs\n- (none — user provides the answer via Telegram)\n\n## Expected Output\n- `test-output/m4-s2-color.txt` containing the user chosen color\n\n## Verification\ntest -f test-output/m4-s2-color.txt\n');

  writeFileSync(join(s02Dir, 'tasks', 'T03-PLAN.md'),
    '---\nestimated_steps: 2\nestimated_files: 1\nskills_used: []\n---\n\n# T03: Write color choice to file\n\nSteps:\n1. Read the color from test-output/m4-s2-color.txt\n2. Write "Color confirmed: <color>" to test-output/m4-s2-t3.txt\n\n## Inputs\n- `test-output/m4-s2-color.txt`\n\n## Expected Output\n- `test-output/m4-s2-t3.txt`\n\n## Verification\ntest -f test-output/m4-s2-t3.txt\n');

  // Clean test-output
  rmSync(join(base, 'test-output'), { recursive: true, force: true });
  mkdirSync(join(base, 'test-output'), { recursive: true });

  // Clean worktrees
  rmSync(join(base, '.gsd', 'worktrees'), { recursive: true, force: true });

  console.log(`${proj}: all plan files + dirs created`);
}
