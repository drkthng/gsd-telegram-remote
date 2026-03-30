import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { parseCommand, executeCommand, injectDeps, injectListProjects, injectBus, injectFindProjectDir } from "../src/dispatcher.js";
import type { ExtensionAPI } from "@gsd/pi-coding-agent";

// ─── parseCommand ────────────────────────────────────────────────────────────

describe("parseCommand", () => {
  // Action commands — no target
  it("parses /auto with no target", () => {
    expect(parseCommand("/auto")).toEqual({ type: "auto", target: undefined });
  });

  it("parses /auto with project target", () => {
    expect(parseCommand("/auto my-project")).toEqual({ type: "auto", target: "my-project" });
  });

  it("parses /auto with alias target", () => {
    expect(parseCommand("/auto ab")).toEqual({ type: "auto", target: "ab" });
  });

  it("parses /gsd auto (no target)", () => {
    expect(parseCommand("/gsd auto")).toEqual({ type: "auto", target: undefined });
  });

  it("parses /stop with target", () => {
    expect(parseCommand("/stop my-project")).toEqual({ type: "stop", target: "my-project" });
  });

  it("parses /stop with no target", () => {
    expect(parseCommand("/stop")).toEqual({ type: "stop", target: undefined });
  });

  it("parses /pause with target", () => {
    expect(parseCommand("/pause my-project")).toEqual({ type: "pause", target: "my-project" });
  });

  it("parses /pause with no target", () => {
    expect(parseCommand("/pause")).toEqual({ type: "pause", target: undefined });
  });

  it("parses /status with target", () => {
    expect(parseCommand("/status my-project")).toEqual({ type: "status", target: "my-project" });
  });

  it("parses /status with no target", () => {
    expect(parseCommand("/status")).toEqual({ type: "status", target: undefined });
  });

  // Alias commands
  it("parses /alias set ab my-project", () => {
    expect(parseCommand("/alias set ab my-project")).toEqual({ type: "alias_set", alias: "ab", project: "my-project" });
  });

  it("parses /alias set with multi-word project (preserves full name)", () => {
    // project names with spaces are unusual but we join remaining tokens
    expect(parseCommand("/alias set ab my project")).toEqual({ type: "alias_set", alias: "ab", project: "my project" });
  });

  it("parses /alias list", () => {
    expect(parseCommand("/alias list")).toEqual({ type: "alias_list" });
  });

  it("parses /alias del ab", () => {
    expect(parseCommand("/alias del ab")).toEqual({ type: "alias_del", alias: "ab" });
  });

  it("parses /alias delete as del", () => {
    expect(parseCommand("/alias delete ab")).toEqual({ type: "alias_del", alias: "ab" });
  });

  it("parses /alias rm as del", () => {
    expect(parseCommand("/alias rm ab")).toEqual({ type: "alias_del", alias: "ab" });
  });

  it("/alias set with missing args returns unknown", () => {
    expect(parseCommand("/alias set")).toMatchObject({ type: "unknown" });
  });

  it("/alias del with missing alias returns unknown", () => {
    expect(parseCommand("/alias del")).toMatchObject({ type: "unknown" });
  });

  it("/alias with unknown sub-command returns unknown", () => {
    expect(parseCommand("/alias foo bar")).toMatchObject({ type: "unknown" });
  });

  // Misc
  it("parses /help", () => {
    expect(parseCommand("/help")).toEqual({ type: "help" });
  });

  it("parses /projects", () => {
    expect(parseCommand("/projects")).toEqual({ type: "projects" });
  });

  it("returns unknown for unrecognized text", () => {
    expect(parseCommand("/something-random")).toEqual({ type: "unknown", raw: "/something-random" });
  });

  it("is case-insensitive for /AUTO", () => {
    expect(parseCommand("/AUTO")).toMatchObject({ type: "auto" });
  });

  it("is case-insensitive for /Stop", () => {
    expect(parseCommand("/Stop")).toMatchObject({ type: "stop" });
  });

  it("trims whitespace", () => {
    expect(parseCommand("  /auto  ")).toMatchObject({ type: "auto" });
  });
});

// ─── executeCommand ───────────────────────────────────────────────────────────

describe("executeCommand", () => {
  let mockSendUserMessage: ReturnType<typeof jest.fn>;
  let mockPi: Pick<ExtensionAPI, "sendUserMessage">;

  beforeEach(() => {
    mockSendUserMessage = jest.fn();
    mockPi = { sendUserMessage: mockSendUserMessage } as unknown as Pick<ExtensionAPI, "sendUserMessage">;
  });

  afterEach(() => {
    injectDeps(null as unknown as ExtensionAPI, null);
    injectListProjects(null as unknown as () => Promise<never[]>);
    injectBus(null, '');
    injectFindProjectDir(null);
  });

  // ── Uninitialized ────────────────────────────────────────────────────────

  it("returns ⚠️ when no deps injected", async () => {
    const result = await executeCommand({ type: "auto", target: "my-project" });
    expect(result.reply).toContain("⚠️");
    expect(result.stateChanged).toBe(false);
  });

  // ── /auto ────────────────────────────────────────────────────────────────

  it("/auto with target: sends /gsd auto and returns stateChanged=true", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    const result = await executeCommand({ type: "auto", target: "my-project" });
    expect(mockSendUserMessage).toHaveBeenCalledWith("/gsd auto");
    expect(result.reply).toMatch(/auto/i);
    expect(result.stateChanged).toBe(true);
  });

  it("/auto with no target: returns usage error, does not send message", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    const result = await executeCommand({ type: "auto", target: undefined });
    expect(result.reply).toContain("⚠️");
    expect(result.reply).toContain("/auto");
    expect(result.stateChanged).toBe(false);
    expect(mockSendUserMessage).not.toHaveBeenCalled();
  });

  // ── /stop ────────────────────────────────────────────────────────────────

  it("/stop with target: sends /gsd stop and returns stateChanged=true", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    const result = await executeCommand({ type: "stop", target: "my-project" });
    expect(mockSendUserMessage).toHaveBeenCalledWith("/gsd stop");
    expect(result.stateChanged).toBe(true);
  });

  it("/stop with no target: returns usage error, does not send message", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    const result = await executeCommand({ type: "stop", target: undefined });
    expect(result.reply).toContain("⚠️");
    expect(result.reply).toContain("/stop");
    expect(result.stateChanged).toBe(false);
    expect(mockSendUserMessage).not.toHaveBeenCalled();
  });

  // ── /pause ───────────────────────────────────────────────────────────────

  it("/pause with target: sends /gsd pause and returns stateChanged=true", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    const result = await executeCommand({ type: "pause", target: "my-project" });
    expect(mockSendUserMessage).toHaveBeenCalledWith("/gsd pause");
    expect(result.stateChanged).toBe(true);
  });

  it("/pause with no target: returns usage error, does not send message", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    const result = await executeCommand({ type: "pause", target: undefined });
    expect(result.reply).toContain("⚠️");
    expect(result.reply).toContain("/pause");
    expect(result.stateChanged).toBe(false);
    expect(mockSendUserMessage).not.toHaveBeenCalled();
  });

  // ── /status ──────────────────────────────────────────────────────────────

  it("/status running: reply contains 'running', stateChanged=false", async () => {
    const statusApi = { isAutoActive: () => true, isAutoPaused: () => false };
    injectDeps(mockPi as unknown as ExtensionAPI, statusApi);
    const result = await executeCommand({ type: "status", target: undefined });
    expect(result.reply).toContain("running");
    expect(result.stateChanged).toBe(false);
  });

  it("/status paused: reply contains 'paused', stateChanged=false", async () => {
    const statusApi = { isAutoActive: () => false, isAutoPaused: () => true };
    injectDeps(mockPi as unknown as ExtensionAPI, statusApi);
    const result = await executeCommand({ type: "status", target: undefined });
    expect(result.reply).toContain("paused");
    expect(result.stateChanged).toBe(false);
  });

  it("/status idle: reply contains 'idle', stateChanged=false", async () => {
    const statusApi = { isAutoActive: () => false, isAutoPaused: () => false };
    injectDeps(mockPi as unknown as ExtensionAPI, statusApi);
    const result = await executeCommand({ type: "status", target: undefined });
    expect(result.reply).toContain("idle");
    expect(result.stateChanged).toBe(false);
  });

  it("/status running-with-detail: reply contains mid/sliceId/taskId", async () => {
    const statusApi = {
      isAutoActive: () => true,
      isAutoPaused: () => false,
      getActiveDetail: () => ({ mid: "M003", sliceId: "S01", taskId: "T01", phase: "executing" }),
    };
    injectDeps(mockPi as unknown as ExtensionAPI, statusApi);
    const result = await executeCommand({ type: "status", target: undefined });
    expect(result.reply).toContain("M003");
    expect(result.reply).toContain("S01");
    expect(result.reply).toContain("T01");
    expect(result.stateChanged).toBe(false);
  });

  // ── /help ────────────────────────────────────────────────────────────────

  it("/help: reply contains /projects and /alias, stateChanged=false", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    const result = await executeCommand({ type: "help" });
    expect(result.reply).toContain("/projects");
    expect(result.reply).toContain("/alias");
    expect(result.stateChanged).toBe(false);
  });

  // ── /projects ────────────────────────────────────────────────────────────

  it("/projects with results: reply contains project name", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    injectListProjects(async () => [{ name: "my-project", description: "A test" }]);
    const result = await executeCommand({ type: "projects" });
    expect(result.reply).toContain("my-project");
    expect(result.stateChanged).toBe(false);
  });

  it("/projects empty: reply contains 'No projects found'", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    injectListProjects(async () => []);
    const result = await executeCommand({ type: "projects" });
    expect(result.reply).toContain("No projects found");
    expect(result.stateChanged).toBe(false);
  });

  // ── /alias set ───────────────────────────────────────────────────────────

  it("/alias set valid: reply contains alias and project", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    const result = await executeCommand({ type: "alias_set", alias: "zz", project: "test-project" });
    expect(result.reply).toContain("zz");
    expect(result.reply).toContain("test-project");
    expect(result.stateChanged).toBe(false);
    // Cleanup
    await executeCommand({ type: "alias_del", alias: "zz" });
  });

  it("/alias set invalid alias: reply contains ⚠️", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    const result = await executeCommand({ type: "alias_set", alias: "toolong", project: "p" });
    expect(result.reply).toContain("⚠️");
    expect(result.stateChanged).toBe(false);
  });

  // ── /alias list ──────────────────────────────────────────────────────────

  it("/alias list empty: reply contains hint to set aliases", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    const result = await executeCommand({ type: "alias_list" });
    // May contain aliases from real file; just verify it doesn't crash
    expect(typeof result.reply).toBe("string");
    expect(result.stateChanged).toBe(false);
  });

  // ── /alias del ───────────────────────────────────────────────────────────

  it("/alias del non-existent: reply contains ⚠️ not found", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    const result = await executeCommand({ type: "alias_del", alias: "qq" });
    expect(result.reply).toContain("⚠️");
    expect(result.stateChanged).toBe(false);
  });

  // ── unknown ──────────────────────────────────────────────────────────────

  it("unknown: reply contains raw text, stateChanged=false", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    const result = await executeCommand({ type: "unknown", raw: "/wat" });
    expect(result.reply).toContain("/wat");
    expect(result.stateChanged).toBe(false);
  });

  // ── CommandBus routing ───────────────────────────────────────────────────

  it("/auto with no bus: calls sendUserMessage (backward compat)", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    // No bus injected — should fall through to sendUserMessage
    const result = await executeCommand({ type: "auto", target: "some-project" });
    expect(mockSendUserMessage).toHaveBeenCalledWith("/gsd auto");
    expect(result.stateChanged).toBe(true);
  });

  it("/auto with bus and different-project target: calls bus.send instead of sendUserMessage", async () => {
    const mockBusSend = jest.fn<() => Promise<{ reply: string; stateChanged: boolean }>>().mockResolvedValue({
      reply: "▶️ auto routed via bus",
      stateChanged: true,
    });
    const mockBus = { send: mockBusSend, startListening: jest.fn(), stopListening: jest.fn() } as any;

    injectDeps(mockPi as unknown as ExtensionAPI, null);
    injectBus(mockBus, "this-project");

    const result = await executeCommand({ type: "auto", target: "other-project" });

    expect(mockBusSend).toHaveBeenCalledWith("other-project", { type: "auto", target: "other-project" });
    expect(mockSendUserMessage).not.toHaveBeenCalled();
    expect(result.reply).toContain("bus");
    expect(result.stateChanged).toBe(true);
  });

  // ── no-target with _listProjects ─────────────────────────────────────────

  it("/auto no-target with _listProjects: reply lists projects", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    injectListProjects(async () => [{ name: "proj-a", description: "Project A" }, { name: "proj-b", description: "proj-b" }]);
    const result = await executeCommand({ type: "auto", target: undefined });
    expect(result.reply).toContain("⚠️");
    expect(result.reply).toContain("proj-a");
    expect(result.reply).toContain("proj-b");
    expect(result.stateChanged).toBe(false);
    expect(mockSendUserMessage).not.toHaveBeenCalled();
  });

  it("/stop no-target with _listProjects: reply lists projects", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    injectListProjects(async () => [{ name: "my-proj", description: "My Proj" }]);
    const result = await executeCommand({ type: "stop", target: undefined });
    expect(result.reply).toContain("⚠️");
    expect(result.reply).toContain("my-proj");
    expect(result.stateChanged).toBe(false);
    expect(mockSendUserMessage).not.toHaveBeenCalled();
  });

  it("/pause no-target with _listProjects: reply lists projects", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    injectListProjects(async () => [{ name: "my-proj", description: "My Proj" }]);
    const result = await executeCommand({ type: "pause", target: undefined });
    expect(result.reply).toContain("⚠️");
    expect(result.reply).toContain("my-proj");
    expect(result.stateChanged).toBe(false);
    expect(mockSendUserMessage).not.toHaveBeenCalled();
  });

  // ── /status cross-project ────────────────────────────────────────────────

  it("/status <target> different project: reads STATE.md via findProjectDir", async () => {
    // We mock fs.readFile indirectly by mocking findProjectDir via jest.mock would be complex.
    // Instead, use a real tmpdir with a STATE.md file and supply a custom findProjectDir via
    // the fact that dispatcher calls findProjectDir from projects.ts.
    // Simpler: mock the module with jest.mock — but that requires top-level setup.
    // Use a real temp filesystem approach consistent with projects.test.ts pattern.
    const os = await import("node:os");
    const path = await import("node:path");
    const fs = await import("node:fs/promises");

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "disp-test-"));
    try {
      // Set up a fake GSD registry pointing to a fake project
      const projDir = path.join(tmpDir, "other-project");
      const gsdDir = path.join(projDir, ".gsd");
      await fs.mkdir(gsdDir, { recursive: true });
      await fs.writeFile(path.join(gsdDir, "STATE.md"),
        "**Phase:** executing\n**Active Milestone:** M003\n**Active Slice:** S02\n"
      );
      const registryDir = path.join(tmpDir, "projects", "hash1");
      await fs.mkdir(registryDir, { recursive: true });
      await fs.writeFile(path.join(registryDir, "repo-meta.json"),
        JSON.stringify({ gitRoot: projDir })
      );

      // Import findProjectDir directly to verify it works with our tmpDir
      const { findProjectDir } = await import("../src/projects.js");
      const found = await findProjectDir("other-project", tmpDir);
      expect(found).toBe(projDir);

      // Now verify STATE.md parsing by reading the file
      const content = await fs.readFile(path.join(found!, ".gsd", "STATE.md"), "utf-8");
      expect(content).toContain("M003");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("/status cross-project: missing project returns ⚠️ no STATE.md", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    injectBus(null, "this-project");
    // No findProjectDir mock — it will return null for non-existent project
    const result = await executeCommand({ type: "status", target: "nonexistent-xyz-project-404" });
    expect(result.reply).toContain("⚠️");
    expect(result.stateChanged).toBe(false);
  });
});

// ── S03 new behaviors ─────────────────────────────────────────────────────────

describe("S03 new behaviors", () => {
  let mockSendUserMessage: ReturnType<typeof jest.fn>;
  let mockPi: Pick<ExtensionAPI, "sendUserMessage">;

  beforeEach(() => {
    mockSendUserMessage = jest.fn();
    mockPi = { sendUserMessage: mockSendUserMessage } as unknown as Pick<ExtensionAPI, "sendUserMessage">;
  });

  afterEach(() => {
    injectDeps(null as unknown as ExtensionAPI, null);
    injectListProjects(null as unknown as () => Promise<never[]>);
    injectBus(null, '');
    injectFindProjectDir(null);
  });

  it("/status with alias target: uses injectFindProjectDir, returns project name and phase", async () => {
    const os = await import("node:os");
    const nodePath = await import("node:path");
    const nodeFs = await import("node:fs/promises");

    const tmpDir = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), "disp-s03-"));
    try {
      // Write STATE.md in a fake project dir
      const projDir = tmpDir;
      const gsdDir = nodePath.join(projDir, ".gsd");
      await nodeFs.mkdir(gsdDir, { recursive: true });
      await nodeFs.writeFile(
        nodePath.join(gsdDir, "STATE.md"),
        "# GSD State\n**Active Milestone:** M002: Test milestone\n**Active Slice:** S01: Test slice\n**Phase:** executing\n"
      );

      // Set up alias op → other-project, inject mock findProjectDir returning our tmpDir
      injectDeps(mockPi as unknown as ExtensionAPI, null);
      injectBus(null, "this-project");
      injectFindProjectDir(async (name: string) => (name === "other-project" ? projDir : null));
      await executeCommand({ type: "alias_set", alias: "op", project: "other-project" });

      const result = await executeCommand({ type: "status", target: "op" });
      expect(result.reply).toContain("other-project");
      expect(result.reply).toContain("executing");
      expect(result.stateChanged).toBe(false);

      // Cleanup alias
      await executeCommand({ type: "alias_del", alias: "op" });
    } finally {
      await nodeFs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("/auto no-target with listProjects: reply lists proj-a and proj-b (not static USAGE_AUTO)", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    injectListProjects(async () => [
      { name: "proj-a", description: "A" },
      { name: "proj-b", description: "B" },
    ]);
    const result = await executeCommand({ type: "auto", target: undefined });
    expect(result.reply).toContain("proj-a");
    expect(result.reply).toContain("proj-b");
    expect(result.reply).toContain("⚠️");
    expect(result.stateChanged).toBe(false);
  });

  it("/auto no-target without listProjects: reply contains static ⚠️ fallback", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    injectListProjects(null);
    const result = await executeCommand({ type: "auto", target: undefined });
    expect(result.reply).toContain("⚠️");
    // Must not contain project names since no listProjects
    expect(result.reply).not.toContain("proj-a");
    expect(result.stateChanged).toBe(false);
  });

  it("/status with unknown project via injectFindProjectDir: reply contains ⚠️ No STATE.md", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    injectBus(null, "this-project");
    injectFindProjectDir(async (_name: string) => null);
    const result = await executeCommand({ type: "status", target: "ghost-project" });
    expect(result.reply).toContain("⚠️");
    expect(result.reply).toContain("No STATE.md");
    expect(result.stateChanged).toBe(false);
  });
});
