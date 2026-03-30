import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { listProjects, findProjectDir } from "../src/projects.js";
import { parseCommand } from "../src/dispatcher.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

async function mkTmpGsdHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gsd-test-"));
  await fs.mkdir(path.join(dir, "projects"), { recursive: true });
  return dir;
}

/**
 * Create a fake registry entry.
 *
 * - Registry dir: {gsdHome}/projects/{hash}/repo-meta.json  (uses `hash` param)
 * - repo-meta.json stores `gitRoot` pointing at `gitRoot` param
 * - PROJECT.md is written to {gitRoot}/.gsd/PROJECT.md when projectMdContent is given
 *
 * If `withMeta` is false, no repo-meta.json is written.
 */
async function makeProject(
  gsdHome: string,
  hash: string,
  opts: {
    withMeta?: boolean;
    gitRoot?: string;       // where the project actually lives
    projectMdContent?: string;
    createdAt?: string;
  } = {}
): Promise<void> {
  const entryDir = path.join(gsdHome, "projects", hash);
  await fs.mkdir(entryDir, { recursive: true });

  if (opts.withMeta === false) return;

  const gitRoot = opts.gitRoot ?? entryDir;
  const meta: Record<string, unknown> = { gitRoot };
  if (opts.createdAt) meta.createdAt = opts.createdAt;

  await fs.writeFile(path.join(entryDir, "repo-meta.json"), JSON.stringify(meta));

  if (opts.projectMdContent !== undefined) {
    const gsdDir = path.join(gitRoot, ".gsd");
    await fs.mkdir(gsdDir, { recursive: true });
    await fs.writeFile(path.join(gsdDir, "PROJECT.md"), opts.projectMdContent);
  }
}

async function rmrf(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(async () => {
  tmpDir = await mkTmpGsdHome();
});

afterEach(async () => {
  await rmrf(tmpDir);
});

describe("listProjects", () => {
  it("returns [] for an empty projects directory", async () => {
    const result = await listProjects(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns [] when the projects directory does not exist", async () => {
    const result = await listProjects(path.join(tmpDir, "nonexistent"));
    expect(result).toEqual([]);
  });

  it("returns name (folder basename) and description for a project with H1 heading", async () => {
    // Create an external dir that looks like a real project root
    const projectDir = path.join(tmpDir, "workspace", "my-project");
    await makeProject(tmpDir, "abc123", {
      gitRoot: projectDir,
      projectMdContent: "# My Project\n\nSome details here.",
    });

    const result = await listProjects(tmpDir);
    expect(result).toEqual([{ name: "my-project", description: "My Project" }]);
  });

  it("returns name and description for a project with a non-heading first line", async () => {
    const projectDir = path.join(tmpDir, "workspace", "alpha");
    await makeProject(tmpDir, "hash1", {
      gitRoot: projectDir,
      projectMdContent: "A plain description without a heading.",
    });

    const result = await listProjects(tmpDir);
    expect(result).toEqual([{ name: "alpha", description: "A plain description without a heading." }]);
  });

  it("skips an entry that has no repo-meta.json", async () => {
    const projectDir = path.join(tmpDir, "workspace", "has-meta");
    await makeProject(tmpDir, "no-meta-hash", { withMeta: false });
    await makeProject(tmpDir, "has-meta-hash", {
      gitRoot: projectDir,
      projectMdContent: "# Has Meta",
    });

    const result = await listProjects(tmpDir);
    expect(result).toEqual([{ name: "has-meta", description: "Has Meta" }]);
  });

  it("falls back to folder name when PROJECT.md is absent", async () => {
    const projectDir = path.join(tmpDir, "workspace", "no-readme");
    await makeProject(tmpDir, "hash1", { gitRoot: projectDir });
    // No .gsd/PROJECT.md written

    const result = await listProjects(tmpDir);
    expect(result).toEqual([{ name: "no-readme", description: "no-readme" }]);
  });

  it("falls back to folder name when PROJECT.md H1 is the template placeholder 'Project'", async () => {
    const projectDir = path.join(tmpDir, "workspace", "strategy-desk");
    await makeProject(tmpDir, "hash1", {
      gitRoot: projectDir,
      projectMdContent: "# Project\n\nActual content starts here.",
    });

    const result = await listProjects(tmpDir);
    expect(result).toEqual([{ name: "strategy-desk", description: "strategy-desk" }]);
  });

  it("reads .gsd/PROJECT.md from the gitRoot recorded in repo-meta.json", async () => {
    const externalDir = path.join(tmpDir, "workspace", "my-app");
    await makeProject(tmpDir, "some-hash", {
      gitRoot: externalDir,
      projectMdContent: "# External App\n\nDetails.",
    });

    const result = await listProjects(tmpDir);
    expect(result).toEqual([{ name: "my-app", description: "External App" }]);
  });

  it("returns results sorted by name", async () => {
    const ws = path.join(tmpDir, "workspace");
    for (const name of ["zoo", "alpha", "middle"]) {
      await makeProject(tmpDir, `hash-${name}`, {
        gitRoot: path.join(ws, name),
        projectMdContent: `# ${name.charAt(0).toUpperCase() + name.slice(1)}`,
      });
    }

    const result = await listProjects(tmpDir);
    expect(result.map((p) => p.name)).toEqual(["alpha", "middle", "zoo"]);
  });

  it("deduplicates entries with the same gitRoot, keeping the most recently created", async () => {
    const projectDir = path.join(tmpDir, "workspace", "deduped-app");
    // Two hash entries pointing at the same gitRoot — later createdAt wins
    await makeProject(tmpDir, "old-hash", {
      gitRoot: projectDir,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await makeProject(tmpDir, "new-hash", {
      gitRoot: projectDir,
      projectMdContent: "# Deduped App",
      createdAt: "2026-03-01T00:00:00.000Z",
    });

    const result = await listProjects(tmpDir);
    // Only one entry, and it has the description from the newer entry's PROJECT.md
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: "deduped-app", description: "Deduped App" });
  });

  it("skips entries with malformed repo-meta.json", async () => {
    const entryDir = path.join(tmpDir, "projects", "broken-hash");
    await fs.mkdir(entryDir, { recursive: true });
    await fs.writeFile(path.join(entryDir, "repo-meta.json"), "NOT JSON {{{");

    const result = await listProjects(tmpDir);
    expect(result).toEqual([]);
  });

  it("skips entries whose repo-meta.json has no gitRoot field", async () => {
    const entryDir = path.join(tmpDir, "projects", "no-root-hash");
    await fs.mkdir(entryDir, { recursive: true });
    await fs.writeFile(path.join(entryDir, "repo-meta.json"), JSON.stringify({ version: 1 }));

    const result = await listProjects(tmpDir);
    expect(result).toEqual([]);
  });

  it("falls back to projectDir field when gitRoot is absent (legacy compat)", async () => {
    const projectDir = path.join(tmpDir, "workspace", "legacy-app");
    await fs.mkdir(path.join(projectDir, ".gsd"), { recursive: true });
    await fs.writeFile(path.join(projectDir, ".gsd", "PROJECT.md"), "# Legacy App");
    const entryDir = path.join(tmpDir, "projects", "legacy-hash");
    await fs.mkdir(entryDir, { recursive: true });
    // Write meta with old `projectDir` field, no `gitRoot`
    await fs.writeFile(
      path.join(entryDir, "repo-meta.json"),
      JSON.stringify({ projectDir })
    );

    const result = await listProjects(tmpDir);
    expect(result).toEqual([{ name: "legacy-app", description: "Legacy App" }]);
  });
});

// ---------------------------------------------------------------------------
// parseCommand — /projects
// ---------------------------------------------------------------------------

describe("parseCommand /projects", () => {
  it("parses /projects", () => {
    expect(parseCommand("/projects")).toEqual({ type: "projects" });
  });

  it("parses bare 'projects'", () => {
    expect(parseCommand("projects")).toEqual({ type: "projects" });
  });

  it("parses /PROJECTS case-insensitively", () => {
    expect(parseCommand("/PROJECTS")).toEqual({ type: "projects" });
  });
});

// ---------------------------------------------------------------------------
// findProjectDir
// ---------------------------------------------------------------------------

describe("findProjectDir", () => {
  it("returns null for a non-existent gsdHome", async () => {
    const result = await findProjectDir("any-project", path.join(tmpDir, "no-such-dir"));
    expect(result).toBeNull();
  });

  it("returns null when no project matches the given name", async () => {
    const projectDir = path.join(tmpDir, "workspace", "alpha");
    await makeProject(tmpDir, "hash1", { gitRoot: projectDir });
    const result = await findProjectDir("beta", tmpDir);
    expect(result).toBeNull();
  });

  it("returns the gitRoot when the basename matches", async () => {
    const projectDir = path.join(tmpDir, "workspace", "my-project");
    await makeProject(tmpDir, "hash1", { gitRoot: projectDir });
    const result = await findProjectDir("my-project", tmpDir);
    expect(result).toBe(projectDir);
  });

  it("returns null for entries with no gitRoot field", async () => {
    const entryDir = path.join(tmpDir, "projects", "no-root");
    await fs.mkdir(entryDir, { recursive: true });
    await fs.writeFile(path.join(entryDir, "repo-meta.json"), JSON.stringify({ version: 1 }));
    const result = await findProjectDir("no-root", tmpDir);
    expect(result).toBeNull();
  });

  it("supports the legacy projectDir field", async () => {
    const projectDir = path.join(tmpDir, "workspace", "legacy-proj");
    const entryDir = path.join(tmpDir, "projects", "legacy-hash");
    await fs.mkdir(entryDir, { recursive: true });
    await fs.writeFile(path.join(entryDir, "repo-meta.json"), JSON.stringify({ projectDir }));
    const result = await findProjectDir("legacy-proj", tmpDir);
    expect(result).toBe(projectDir);
  });
});
