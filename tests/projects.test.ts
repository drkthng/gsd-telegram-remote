import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { listProjects } from "../src/projects.js";
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

async function makeProject(
  gsdHome: string,
  name: string,
  opts: {
    withMeta?: boolean;
    projectMdContent?: string;
    externalProjectDir?: string;
  } = {}
): Promise<void> {
  const entryDir = path.join(gsdHome, "projects", name);
  await fs.mkdir(entryDir, { recursive: true });

  if (opts.withMeta !== false) {
    // Default: write repo-meta.json pointing to the entry dir itself
    const projectDir = opts.externalProjectDir ?? entryDir;
    await fs.writeFile(
      path.join(entryDir, "repo-meta.json"),
      JSON.stringify({ projectDir })
    );
    if (opts.projectMdContent !== undefined) {
      await fs.writeFile(path.join(projectDir, "PROJECT.md"), opts.projectMdContent);
    }
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

  it("returns name and description for a project with H1 heading", async () => {
    await makeProject(tmpDir, "my-project", {
      projectMdContent: "# My Project\n\nSome details here.",
    });

    const result = await listProjects(tmpDir);
    expect(result).toEqual([{ name: "my-project", description: "My Project" }]);
  });

  it("returns name and description for a project with a non-heading first line", async () => {
    await makeProject(tmpDir, "alpha", {
      projectMdContent: "A plain description without a heading.",
    });

    const result = await listProjects(tmpDir);
    expect(result).toEqual([{ name: "alpha", description: "A plain description without a heading." }]);
  });

  it("skips an entry that has no repo-meta.json", async () => {
    // Entry dir exists but no repo-meta.json → no withMeta
    await makeProject(tmpDir, "no-meta", { withMeta: false });
    await makeProject(tmpDir, "has-meta", { projectMdContent: "# Has Meta" });

    const result = await listProjects(tmpDir);
    expect(result).toEqual([{ name: "has-meta", description: "Has Meta" }]);
  });

  it("returns empty description when PROJECT.md is absent (no throw)", async () => {
    // Write repo-meta.json but don't create PROJECT.md
    const entryDir = path.join(tmpDir, "projects", "no-readme");
    await fs.mkdir(entryDir, { recursive: true });
    await fs.writeFile(
      path.join(entryDir, "repo-meta.json"),
      JSON.stringify({ projectDir: entryDir })
    );
    // No PROJECT.md written

    const result = await listProjects(tmpDir);
    expect(result).toEqual([{ name: "no-readme", description: "" }]);
  });

  it("reads PROJECT.md from the projectDir recorded in repo-meta.json", async () => {
    // externalProjectDir simulates a project whose files live outside the gsd projects dir
    const externalDir = path.join(tmpDir, "workspace", "my-app");
    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(path.join(externalDir, "PROJECT.md"), "# External App\n\nDetails.");

    await makeProject(tmpDir, "my-app", { externalProjectDir: externalDir });

    const result = await listProjects(tmpDir);
    expect(result).toEqual([{ name: "my-app", description: "External App" }]);
  });

  it("returns results sorted by name", async () => {
    await makeProject(tmpDir, "zoo", { projectMdContent: "# Zoo" });
    await makeProject(tmpDir, "alpha", { projectMdContent: "# Alpha" });
    await makeProject(tmpDir, "middle", { projectMdContent: "# Middle" });

    const result = await listProjects(tmpDir);
    expect(result.map((p) => p.name)).toEqual(["alpha", "middle", "zoo"]);
  });

  it("handles malformed repo-meta.json gracefully (uses default path)", async () => {
    const entryDir = path.join(tmpDir, "projects", "broken-meta");
    await fs.mkdir(entryDir, { recursive: true });
    await fs.writeFile(path.join(entryDir, "repo-meta.json"), "NOT JSON {{{");
    // No PROJECT.md → empty description
    const result = await listProjects(tmpDir);
    expect(result).toEqual([{ name: "broken-meta", description: "" }]);
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
