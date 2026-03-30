import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";

import { CommandBus } from "../src/command-bus.js";
import type { RemoteCommand, DispatchResult } from "../src/types.js";

let busRoot: string;
let busA: CommandBus;
let busB: CommandBus;

const PROJECT_A = "session-a";
const PROJECT_B = "session-b";

const FIXED_RESULT: DispatchResult = { reply: "✅ auto mode started", stateChanged: true };

beforeEach(async () => {
  busRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gsd-bus-test-"));
  busA = new CommandBus({ projectName: PROJECT_A, busRoot, pollIntervalMs: 50, ackTimeoutMs: 2000 });
  busB = new CommandBus({ projectName: PROJECT_B, busRoot, pollIntervalMs: 50, ackTimeoutMs: 2000 });
});

afterEach(async () => {
  busA.stopListening();
  busB.stopListening();
  await fs.rm(busRoot, { recursive: true, force: true });
});

// ── Happy path ─────────────────────────────────────────────────────────────────

describe("CommandBus happy path", () => {
  it("routes a command from A to B, returns DispatchResult, cleans up files", async () => {
    const executor = jest.fn<(cmd: RemoteCommand) => Promise<DispatchResult>>()
      .mockResolvedValue(FIXED_RESULT);

    busB.startListening(executor);

    const cmd: RemoteCommand = { type: "auto", target: PROJECT_B };
    const result = await busA.send(PROJECT_B, cmd);

    // A receives the correct DispatchResult
    expect(result.reply).toBe(FIXED_RESULT.reply);
    expect(result.stateChanged).toBe(FIXED_RESULT.stateChanged);

    // B's executor was called exactly once with the correct command
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith(cmd);

    // All cmd and ack files cleaned up
    const bDir = path.join(busRoot, PROJECT_B);
    const files = fsSync.readdirSync(bDir).filter(
      (f) => f.startsWith("cmd-") || f.startsWith("ack-"),
    );
    expect(files).toHaveLength(0);
  });

  it("only B's executor fires — A's bus directory receives nothing", async () => {
    const executorA = jest.fn<(cmd: RemoteCommand) => Promise<DispatchResult>>()
      .mockResolvedValue({ reply: "should not be called", stateChanged: false });
    const executorB = jest.fn<(cmd: RemoteCommand) => Promise<DispatchResult>>()
      .mockResolvedValue(FIXED_RESULT);

    busA.startListening(executorA);
    busB.startListening(executorB);

    const cmd: RemoteCommand = { type: "stop", target: PROJECT_B };
    await busA.send(PROJECT_B, cmd);

    expect(executorB).toHaveBeenCalledTimes(1);
    expect(executorA).not.toHaveBeenCalled();
  });
});

// ── Timeout path ───────────────────────────────────────────────────────────────

describe("CommandBus timeout", () => {
  it("returns timeout error reply when no listener is running", async () => {
    // busB listener is NOT started — send should time out
    const busTimeout = new CommandBus({
      projectName: PROJECT_A,
      busRoot,
      pollIntervalMs: 50,
      ackTimeoutMs: 300, // short for test speed
    });

    const result = await busTimeout.send(PROJECT_B, { type: "auto" });

    expect(result.stateChanged).toBe(false);
    expect(result.reply).toContain(PROJECT_B);
    expect(result.reply).toContain("did not respond");
  });
});

// ── Malformed file handling ────────────────────────────────────────────────────

describe("CommandBus malformed file handling", () => {
  it("skips and deletes malformed cmd files without crashing", async () => {
    const bDir = path.join(busRoot, PROJECT_B);
    await fs.mkdir(bDir, { recursive: true });

    // Write a malformed command file
    const malformedPath = path.join(bDir, "cmd-bad.json");
    fsSync.writeFileSync(malformedPath, "{ not valid json }", "utf-8");

    const executor = jest.fn<(cmd: RemoteCommand) => Promise<DispatchResult>>()
      .mockResolvedValue(FIXED_RESULT);
    busB.startListening(executor);

    // Give the listener time to process (and discard) the malformed file
    await sleep(200);

    // Executor should not have been called for the malformed file
    expect(executor).not.toHaveBeenCalled();
    // Malformed file should be gone
    expect(fsSync.existsSync(malformedPath)).toBe(false);
  });

  it("skips cmd file with missing required fields", async () => {
    const bDir = path.join(busRoot, PROJECT_B);
    await fs.mkdir(bDir, { recursive: true });

    // Write a structurally incomplete envelope (missing `command`)
    const badPath = path.join(bDir, "cmd-incomplete.json");
    fsSync.writeFileSync(badPath, JSON.stringify({ id: "abc", sentAt: Date.now() }), "utf-8");

    const executor = jest.fn<(cmd: RemoteCommand) => Promise<DispatchResult>>()
      .mockResolvedValue(FIXED_RESULT);
    busB.startListening(executor);

    await sleep(200);

    expect(executor).not.toHaveBeenCalled();
    expect(fsSync.existsSync(badPath)).toBe(false);
  });
});

// ── Multiple sends ─────────────────────────────────────────────────────────────

describe("CommandBus multiple sequential sends", () => {
  it("handles two sequential commands correctly", async () => {
    const results: DispatchResult[] = [
      { reply: "✅ auto started", stateChanged: true },
      { reply: "🛑 stopped", stateChanged: true },
    ];
    let callCount = 0;
    const executor = jest.fn<(cmd: RemoteCommand) => Promise<DispatchResult>>()
      .mockImplementation(async () => results[callCount++] ?? FIXED_RESULT);

    busB.startListening(executor);

    const r1 = await busA.send(PROJECT_B, { type: "auto" });
    const r2 = await busA.send(PROJECT_B, { type: "stop" });

    expect(r1.reply).toBe("✅ auto started");
    expect(r2.reply).toBe("🛑 stopped");
    expect(executor).toHaveBeenCalledTimes(2);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
