/**
 * command-bus.ts — filesystem-based IPC between GSD sessions.
 *
 * Each session owns a bus directory: <busRoot>/<projectName>/
 * Default busRoot: ~/.gsd/telegram-remote-bus/
 *
 * Protocol:
 *   Sender writes  cmd-<uuid>.json  → { id, command, sentAt }
 *   Listener reads cmd-*, calls executor, writes ack-<uuid>.json → { id, reply, stateChanged }
 *   Listener deletes cmd-* after processing
 *   Sender polls for ack-*, reads it, deletes it, returns DispatchResult
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

import type { RemoteCommand, DispatchResult } from "./types.js";

// ── Public types ──────────────────────────────────────────────────────────────

export interface CommandBusOptions {
  /** The project name this bus instance belongs to. */
  projectName: string;
  /** Root directory for all bus dirs. Defaults to ~/.gsd/telegram-remote-bus */
  busRoot?: string;
  /** How often to poll for incoming cmd files (ms). Default: 200 */
  pollIntervalMs?: number;
  /** How long to wait for an ack before declaring timeout (ms). Default: 5000 */
  ackTimeoutMs?: number;
}

// ── Internal envelope types ───────────────────────────────────────────────────

interface CmdEnvelope {
  id: string;
  command: RemoteCommand;
  sentAt: number;
}

interface AckEnvelope {
  id: string;
  reply: string;
  stateChanged: boolean;
}

// ── CommandBus ────────────────────────────────────────────────────────────────

export class CommandBus {
  private readonly projectName: string;
  private readonly busRoot: string;
  private readonly busDir: string;
  private readonly pollIntervalMs: number;
  private readonly ackTimeoutMs: number;

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: CommandBusOptions) {
    this.projectName = opts.projectName;
    this.busRoot = opts.busRoot ?? join(homedir(), ".gsd", "telegram-remote-bus");
    this.busDir = join(this.busRoot, this.projectName);
    this.pollIntervalMs = opts.pollIntervalMs ?? 200;
    this.ackTimeoutMs = opts.ackTimeoutMs ?? 5000;
  }

  // ── Listener side ───────────────────────────────────────────────────────────

  /**
   * Start polling for inbound commands and execute them via the provided executor.
   * Safe to call multiple times — will not create duplicate timers.
   */
  startListening(executor: (cmd: RemoteCommand) => Promise<DispatchResult>): void {
    if (this.pollTimer !== null) return;

    ensureDir(this.busDir);

    this.pollTimer = setInterval(() => {
      this.processPending(executor).catch(() => {
        // swallow per-tick errors to keep the poll running
      });
    }, this.pollIntervalMs);

    // Allow Node to exit even if the timer is still active
    if (typeof this.pollTimer.unref === "function") {
      this.pollTimer.unref();
    }
  }

  /** Stop polling. Safe to call even if not listening. */
  stopListening(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ── Sender side ─────────────────────────────────────────────────────────────

  /**
   * Send a command to another project's bus and wait for acknowledgement.
   * Resolves with the DispatchResult from the target session, or a timeout
   * error if no ack arrives within ackTimeoutMs.
   */
  async send(targetProjectName: string, cmd: RemoteCommand): Promise<DispatchResult> {
    const targetDir = join(this.busRoot, targetProjectName);
    ensureDir(targetDir);

    const id = randomUUID();
    const envelope: CmdEnvelope = { id, command: cmd, sentAt: Date.now() };
    const cmdFile = join(targetDir, `cmd-${id}.json`);
    writeJsonAtomic(cmdFile, envelope);

    const ackFile = join(targetDir, `ack-${id}.json`);
    const deadline = Date.now() + this.ackTimeoutMs;

    while (Date.now() < deadline) {
      await sleep(this.pollIntervalMs);
      if (!existsSync(ackFile)) continue;

      try {
        const raw = readFileSync(ackFile, "utf-8");
        const ack = JSON.parse(raw) as AckEnvelope;
        safeUnlink(ackFile);
        return { reply: ack.reply, stateChanged: ack.stateChanged };
      } catch {
        // ack file may be mid-write; try again next tick
      }
    }

    // Timeout — clean up the cmd file if still present (no listener picked it up)
    safeUnlink(cmdFile);
    return {
      reply: `⚠️ Project ${targetProjectName} did not respond within ${this.ackTimeoutMs / 1000}s — is that session running?`,
      stateChanged: false,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async processPending(
    executor: (cmd: RemoteCommand) => Promise<DispatchResult>,
  ): Promise<void> {
    let entries: string[];
    try {
      entries = readdirSync(this.busDir);
    } catch {
      return;
    }

    const cmdFiles = entries.filter((f) => f.startsWith("cmd-") && f.endsWith(".json"));

    for (const filename of cmdFiles) {
      const cmdFile = join(this.busDir, filename);
      let envelope: CmdEnvelope;

      try {
        const raw = readFileSync(cmdFile, "utf-8");
        const parsed = JSON.parse(raw);
        if (!isValidCmdEnvelope(parsed)) {
          // Malformed — discard so it doesn't loop forever
          safeUnlink(cmdFile);
          continue;
        }
        envelope = parsed as CmdEnvelope;
      } catch {
        // Malformed JSON or file disappeared; delete so it doesn't loop forever
        safeUnlink(cmdFile);
        continue;
      }

      // Delete cmd file before executing so another instance won't pick it up
      safeUnlink(cmdFile);

      let result: DispatchResult;
      try {
        result = await executor(envelope.command);
      } catch (err) {
        result = {
          reply: `⚠️ Executor error: ${err instanceof Error ? err.message : String(err)}`,
          stateChanged: false,
        };
      }

      const ackFile = join(this.busDir, `ack-${envelope.id}.json`);
      const ack: AckEnvelope = {
        id: envelope.id,
        reply: result.reply,
        stateChanged: result.stateChanged,
      };
      writeJsonAtomic(ackFile, ack);
    }
  }
}

// ── Utility functions ─────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmp = filePath + ".tmp";
  writeFileSync(tmp, JSON.stringify(data), "utf-8");
  renameSync(tmp, filePath);
}

function safeUnlink(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // already gone — fine
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidCmdEnvelope(v: unknown): v is CmdEnvelope {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj["id"] === "string" &&
    typeof obj["sentAt"] === "number" &&
    obj["command"] !== null &&
    typeof obj["command"] === "object"
  );
}
