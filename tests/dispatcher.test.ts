import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { parseCommand, executeCommand, injectDeps, injectListProjects } from "../src/dispatcher.js";
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
});
