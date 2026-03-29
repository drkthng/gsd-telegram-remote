import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { parseCommand, executeCommand, injectDeps, injectListProjects } from "../src/dispatcher.js";
import type { ExtensionAPI } from "@gsd/pi-coding-agent";

// ─── parseCommand ────────────────────────────────────────────────────────────

describe("parseCommand", () => {
  it("parses /auto", () => {
    expect(parseCommand("/auto")).toEqual({ type: "auto" });
  });

  it("parses /gsd auto", () => {
    expect(parseCommand("/gsd auto")).toEqual({ type: "auto" });
  });

  it("parses /stop", () => {
    expect(parseCommand("/stop")).toEqual({ type: "stop" });
  });

  it("parses /pause", () => {
    expect(parseCommand("/pause")).toEqual({ type: "pause" });
  });

  it("parses /status", () => {
    expect(parseCommand("/status")).toEqual({ type: "status" });
  });

  it("parses /help", () => {
    expect(parseCommand("/help")).toEqual({ type: "help" });
  });

  it("parses /projects", () => {
    expect(parseCommand("/projects")).toEqual({ type: "projects" });
  });

  it("returns unknown for unrecognized text", () => {
    const result = parseCommand("/something-random");
    expect(result).toEqual({ type: "unknown", raw: "/something-random" });
  });

  it("is case-insensitive", () => {
    expect(parseCommand("/AUTO")).toEqual({ type: "auto" });
    expect(parseCommand("/Stop")).toEqual({ type: "stop" });
  });

  it("trims whitespace", () => {
    expect(parseCommand("  /auto  ")).toEqual({ type: "auto" });
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
    // Reset injected deps so tests don't leak state into each other
    injectDeps(null as unknown as ExtensionAPI, null);
    injectListProjects(null as unknown as () => Promise<never[]>);
  });

  // ── Uninitialized ────────────────────────────────────────────────────────

  it("returns ⚠️ when no deps injected", async () => {
    const result = await executeCommand({ type: "auto" });
    expect(result.reply).toContain("⚠️");
    expect(result.stateChanged).toBe(false);
  });

  // ── /auto ────────────────────────────────────────────────────────────────

  it("/auto: sends /gsd auto and returns stateChanged=true", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    const result = await executeCommand({ type: "auto" });
    expect(mockSendUserMessage).toHaveBeenCalledWith("/gsd auto");
    expect(result.reply).toMatch(/auto/i);
    expect(result.stateChanged).toBe(true);
  });

  // ── /stop ────────────────────────────────────────────────────────────────

  it("/stop: sends /gsd stop and returns stateChanged=true", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    const result = await executeCommand({ type: "stop" });
    expect(mockSendUserMessage).toHaveBeenCalledWith("/gsd stop");
    expect(result.stateChanged).toBe(true);
  });

  // ── /pause ───────────────────────────────────────────────────────────────

  it("/pause: sends /gsd pause and returns stateChanged=true", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    const result = await executeCommand({ type: "pause" });
    expect(mockSendUserMessage).toHaveBeenCalledWith("/gsd pause");
    expect(result.stateChanged).toBe(true);
  });

  // ── /status ──────────────────────────────────────────────────────────────

  it("/status running: reply contains 'running', stateChanged=false", async () => {
    const statusApi = {
      isAutoActive: () => true,
      isAutoPaused: () => false,
    };
    injectDeps(mockPi as unknown as ExtensionAPI, statusApi);
    const result = await executeCommand({ type: "status" });
    expect(result.reply).toContain("running");
    expect(result.stateChanged).toBe(false);
  });

  it("/status paused: reply contains 'paused', stateChanged=false", async () => {
    const statusApi = {
      isAutoActive: () => false,
      isAutoPaused: () => true,
    };
    injectDeps(mockPi as unknown as ExtensionAPI, statusApi);
    const result = await executeCommand({ type: "status" });
    expect(result.reply).toContain("paused");
    expect(result.stateChanged).toBe(false);
  });

  it("/status idle: reply contains 'idle', stateChanged=false", async () => {
    const statusApi = {
      isAutoActive: () => false,
      isAutoPaused: () => false,
    };
    injectDeps(mockPi as unknown as ExtensionAPI, statusApi);
    const result = await executeCommand({ type: "status" });
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
    const result = await executeCommand({ type: "status" });
    expect(result.reply).toContain("M003");
    expect(result.reply).toContain("S01");
    expect(result.reply).toContain("T01");
    expect(result.stateChanged).toBe(false);
  });

  // ── /help ────────────────────────────────────────────────────────────────

  it("/help: reply contains /projects, stateChanged=false", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    const result = await executeCommand({ type: "help" });
    expect(result.reply).toContain("/projects");
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

  // ── unknown ──────────────────────────────────────────────────────────────

  it("unknown: reply contains raw text, stateChanged=false", async () => {
    injectDeps(mockPi as unknown as ExtensionAPI, null);
    const result = await executeCommand({ type: "unknown", raw: "/wat" });
    expect(result.reply).toContain("/wat");
    expect(result.stateChanged).toBe(false);
  });
});
