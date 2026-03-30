/**
 * dispatcher.ts — Parse incoming Telegram text into RemoteCommands and execute them.
 *
 * Commands are executed via pi.sendUserMessage(), which routes through the exact same
 * path as the user typing them in the terminal. This means:
 *  - All GSD edge-case handling (already running, no milestones, etc.) is inherited
 *  - The response appears in the GSD terminal so the user sees what happened
 *  - No direct dependency on GSD internal modules (startAuto, stopAuto, etc.)
 *  - pi is process-scoped and safe to store from activate()
 *
 * Status queries read GSD state functions directly (isAutoActive, isAutoPaused)
 * since those are pure reads with no session dependency.
 *
 * Command syntax (M005+):
 *   /auto <project|alias>   — start auto-mode in target project
 *   /stop <project|alias>   — stop auto-mode in target project
 *   /pause <project|alias>  — pause auto-mode in target project
 *   /status [project|alias] — show state (optional target; defaults to this session)
 *   /alias set <alias> <project>
 *   /alias list
 *   /alias del <alias>
 *   /projects               — list registered GSD projects
 *   /help                   — command reference
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@gsd/pi-coding-agent";
import type { RemoteCommand, DispatchResult } from "./types.js";
import type { ProjectEntry } from "./projects.js";
import { findProjectDir } from "./projects.js";
import type { CommandBus } from "./command-bus.js";
import { loadAliases, setAlias, deleteAlias, listAliases } from "./aliases.js";

export interface GsdStatusApi {
  isAutoActive: () => boolean;
  isAutoPaused: () => boolean;
  getActiveDetail?: () => { mid: string; sliceId: string; taskId: string; phase: string } | null;
}

type ListProjectsFn = () => Promise<ProjectEntry[]>;
type FindProjectDirFn = (name: string, gsdHome?: string) => Promise<string | null>;

let _pi: ExtensionAPI | null = null;
let _statusApi: GsdStatusApi | null = null;
let _listProjects: ListProjectsFn | null = null;
let _bus: CommandBus | null = null;
let _thisProject: string = '';
let _findProjectDir: FindProjectDirFn | null = null;

/**
 * Set to true when /auto is dispatched to the local session.
 * Consumed (reset to false) by index.ts after each agent_end check.
 */
let _localAutoDispatched = false;

export function consumeLocalAutoDispatched(): boolean {
  const val = _localAutoDispatched;
  _localAutoDispatched = false;
  return val;
}

export function injectDeps(pi: ExtensionAPI | null, statusApi: GsdStatusApi | null): void {
  _pi = pi;
  _statusApi = statusApi;
}

export function injectListProjects(fn: ListProjectsFn | null): void {
  _listProjects = fn;
}

export function injectBus(bus: CommandBus | null, thisProject: string): void {
  _bus = bus;
  _thisProject = thisProject;
}

/** Override findProjectDir for tests. Pass null to restore the default. */
export function injectFindProjectDir(fn: FindProjectDirFn | null): void {
  _findProjectDir = fn;
}

// ── parseCommand ─────────────────────────────────────────────────────────────

/** Parse the raw message text into a typed command. */
export function parseCommand(text: string): RemoteCommand {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Split into tokens for multi-word commands
  const tokens = trimmed.split(/\s+/);
  const cmd = tokens[0]?.toLowerCase() ?? "";
  const rest = tokens.slice(1);

  // /gsd <sub> forms — treat as the sub-command with rest as target tokens
  if (cmd === "/gsd") {
    const sub = rest[0]?.toLowerCase();
    const target = rest[1] || undefined;
    if (sub === "auto")  return { type: "auto",  target };
    if (sub === "stop")  return { type: "stop",  target };
    if (sub === "pause") return { type: "pause", target };
    if (sub === "status") return { type: "status", target };
    return { type: "unknown", raw: trimmed };
  }

  // /alias set <alias> <project> | /alias list | /alias del <alias>
  if (cmd === "/alias") {
    const sub = rest[0]?.toLowerCase();
    if (sub === "set") {
      const alias = rest[1];
      const project = rest.slice(2).join(" ");
      if (alias && project) return { type: "alias_set", alias, project };
      return { type: "unknown", raw: trimmed };
    }
    if (sub === "list") return { type: "alias_list" };
    if (sub === "del" || sub === "delete" || sub === "rm") {
      const alias = rest[1];
      if (alias) return { type: "alias_del", alias };
      return { type: "unknown", raw: trimmed };
    }
    return { type: "unknown", raw: trimmed };
  }

  // Action commands with optional target
  const target = rest[0] || undefined;

  if (cmd === "/auto" || lower === "auto")
    return { type: "auto", target };

  if (cmd === "/stop" || lower === "stop")
    return { type: "stop", target };

  if (cmd === "/pause" || lower === "pause")
    return { type: "pause", target };

  if (cmd === "/status" || lower === "status")
    return { type: "status", target };

  if (lower === "/help" || lower === "help") return { type: "help" };
  if (lower === "/projects" || lower === "projects") return { type: "projects" };

  return { type: "unknown", raw: trimmed };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const USAGE_AUTO  = "⚠️ Specify a project:\n<code>/auto &lt;project|alias&gt;</code>\n\nSee /alias list for shortcuts or /projects for names.";
const USAGE_STOP  = "⚠️ Specify a project:\n<code>/stop &lt;project|alias&gt;</code>\n\nSee /alias list for shortcuts or /projects for names.";
const USAGE_PAUSE = "⚠️ Specify a project:\n<code>/pause &lt;project|alias&gt;</code>\n\nSee /alias list for shortcuts or /projects for names.";

/**
 * Build a "specify a project" reply. When _listProjects is available, inline
 * the current project list so the user can pick one without a second round-trip.
 */
async function buildNoTargetReply(prefix: string): Promise<string> {
  if (_listProjects) {
    const projects = await _listProjects();
    const store = loadAliases();
    const aliasMap: Record<string, string[]> = {};
    for (const { alias, project } of listAliases(store)) {
      if (!aliasMap[project]) aliasMap[project] = [];
      aliasMap[project].push(alias);
    }
    if (projects.length === 0) {
      return `${prefix}\n\n📂 No projects found.`;
    }
    const lines = projects.map((p) => {
      const aliases = aliasMap[p.name]?.map((a) => `<code>${a}</code>`).join(" ") ?? "";
      const aliasStr = aliases ? ` [${aliases}]` : "";
      return p.description && p.description !== p.name
        ? `• <b>${p.name}</b>${aliasStr} — ${p.description}`
        : `• <b>${p.name}</b>${aliasStr}`;
    });
    return [prefix, "", ...lines].join("\n");
  }
  return prefix;
}

/**
 * Parse STATE.md content and extract Phase, Active Milestone, Active Slice values.
 * Returns null fields for any line that isn't found.
 */
function parseStateMd(content: string): { phase: string | null; milestone: string | null; slice: string | null } {
  let phase: string | null = null;
  let milestone: string | null = null;
  let slice: string | null = null;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("**Phase:**")) {
      phase = trimmed.replace(/^\*\*Phase:\*\*\s*/, "").trim();
    } else if (trimmed.startsWith("**Active Milestone:**")) {
      milestone = trimmed.replace(/^\*\*Active Milestone:\*\*\s*/, "").trim();
    } else if (trimmed.startsWith("**Active Slice:**")) {
      slice = trimmed.replace(/^\*\*Active Slice:\*\*\s*/, "").trim();
    }
  }
  return { phase, milestone, slice };
}

// ── executeCommand ────────────────────────────────────────────────────────────

/** Execute a parsed command. Returns a reply string for Telegram. */
export async function executeCommand(cmd: RemoteCommand): Promise<DispatchResult> {
  if (!_pi) {
    return { reply: "⚠️ Extension not initialized.", stateChanged: false };
  }

  switch (cmd.type) {
    case "auto": {
      if (!cmd.target) return { reply: await buildNoTargetReply(USAGE_AUTO), stateChanged: false };
      const project = resolveTarget(cmd.target);
      if (_bus && project !== _thisProject) {
        return await _bus.send(project, cmd);
      }
      _pi.sendUserMessage("/gsd auto");
      _localAutoDispatched = true;
      return { reply: `▶️ Sent <code>/gsd auto</code> → <b>${project}</b> — check terminal for progress.`, stateChanged: true };
    }

    case "stop": {
      if (!cmd.target) return { reply: await buildNoTargetReply(USAGE_STOP), stateChanged: false };
      const project = resolveTarget(cmd.target);
      if (_bus && project !== _thisProject) {
        return await _bus.send(project, cmd);
      }
      _pi.sendUserMessage("/gsd stop");
      return { reply: `⏹️ Sent <code>/gsd stop</code> → <b>${project}</b>.`, stateChanged: true };
    }

    case "pause": {
      if (!cmd.target) return { reply: await buildNoTargetReply(USAGE_PAUSE), stateChanged: false };
      const project = resolveTarget(cmd.target);
      if (_bus && project !== _thisProject) {
        return await _bus.send(project, cmd);
      }
      _pi.sendUserMessage("/gsd pause");
      return { reply: `⏸️ Sent <code>/gsd pause</code> → <b>${project}</b>. Send /auto ${cmd.target} to resume.`, stateChanged: true };
    }

    case "status": {
      const target = cmd.target ? resolveTarget(cmd.target) : undefined;

      // Cross-project status: target is set and is a different project
      if (target && target !== _thisProject && _thisProject !== "") {
        const lookupFn = _findProjectDir ?? findProjectDir;
        const gitRoot = await lookupFn(target);
        if (!gitRoot) {
          return { reply: `⚠️ No STATE.md found for ${target}`, stateChanged: false };
        }
        const statePath = path.join(gitRoot, ".gsd", "STATE.md");
        try {
          const content = await fs.readFile(statePath, "utf-8");
          const { phase, milestone, slice } = parseStateMd(content);
          const lines: string[] = [`📍 <b>${target}</b>`];
          if (phase) lines.push(`🔄 ${phase}`);
          if (milestone) lines.push(`🗂️ ${milestone}`);
          if (slice) lines.push(`📋 ${slice}`);
          return { reply: lines.join("\n"), stateChanged: false };
        } catch {
          return { reply: `⚠️ No STATE.md found for ${target}`, stateChanged: false };
        }
      }

      // Local status
      if (_statusApi) {
        const active = _statusApi.isAutoActive();
        const paused = _statusApi.isAutoPaused();
        if (active) {
          const detail = _statusApi.getActiveDetail?.();
          if (detail) {
            return {
              reply: `🟢 ${detail.mid}/${detail.sliceId}/${detail.taskId} (${detail.phase})`,
              stateChanged: false,
            };
          }
          return { reply: "🟢 Auto-mode: <b>running</b>", stateChanged: false };
        }
        if (paused) return { reply: "🟡 Auto-mode: <b>paused</b> — send /auto to resume", stateChanged: false };
        return { reply: "⚫ Auto-mode: <b>idle</b>", stateChanged: false };
      }
      _pi.sendUserMessage("/gsd auto status");
      return { reply: "ℹ️ Status requested — check terminal.", stateChanged: false };
    }

    case "help":
      return {
        reply: [
          "<b>GSD Remote Commands</b>",
          "",
          "/auto &lt;project|alias&gt; — Start or resume auto-mode",
          "/stop &lt;project|alias&gt; — Stop auto-mode",
          "/pause &lt;project|alias&gt; — Pause auto-mode",
          "/status [project|alias] — Show current state",
          "/projects — List GSD projects",
          "",
          "<b>Aliases</b>",
          "/alias set &lt;alias&gt; &lt;project&gt; — Create 2-3 char shortcut",
          "/alias list — Show all aliases",
          "/alias del &lt;alias&gt; — Remove alias",
          "",
          "/help — This message",
        ].join("\n"),
        stateChanged: false,
      };

    case "projects": {
      if (_listProjects) {
        const projects = await _listProjects();
        const store = loadAliases();
        const aliasMap: Record<string, string[]> = {};
        for (const { alias, project } of listAliases(store)) {
          if (!aliasMap[project]) aliasMap[project] = [];
          aliasMap[project].push(alias);
        }
        if (projects.length === 0) {
          return { reply: "📂 No projects found.", stateChanged: false };
        }
        const lines = projects.map((p) => {
          const aliases = aliasMap[p.name]?.map((a) => `<code>${a}</code>`).join(" ") ?? "";
          const aliasStr = aliases ? ` [${aliases}]` : "";
          return p.description && p.description !== p.name
            ? `• <b>${p.name}</b>${aliasStr} — ${p.description}`
            : `• <b>${p.name}</b>${aliasStr}`;
        });
        return {
          reply: ["<b>GSD Projects</b>", "", ...lines].join("\n"),
          stateChanged: false,
        };
      }
      return { reply: "⚠️ Projects listing not available.", stateChanged: false };
    }

    case "alias_set": {
      const result = setAlias(cmd.alias, cmd.project);
      if (result.ok) {
        return { reply: `✅ Alias <code>${cmd.alias.toLowerCase()}</code> → <b>${cmd.project}</b> set.`, stateChanged: false };
      }
      return { reply: `⚠️ ${result.error}`, stateChanged: false };
    }

    case "alias_list": {
      const store = loadAliases();
      const entries = listAliases(store);
      if (entries.length === 0) {
        return { reply: "📋 No aliases set. Use /alias set &lt;alias&gt; &lt;project&gt;.", stateChanged: false };
      }
      const lines = entries.map(({ alias, project }) => `<code>${alias}</code> → <b>${project}</b>`);
      return { reply: ["<b>Aliases</b>", "", ...lines].join("\n"), stateChanged: false };
    }

    case "alias_del": {
      const deleted = deleteAlias(cmd.alias);
      if (deleted) {
        return { reply: `🗑️ Alias <code>${cmd.alias.toLowerCase()}</code> removed.`, stateChanged: false };
      }
      return { reply: `⚠️ Alias <code>${cmd.alias.toLowerCase()}</code> not found.`, stateChanged: false };
    }

    case "unknown":
      return {
        reply: `❓ Unknown command: <code>${cmd.raw.slice(0, 50)}</code>\n\nSend /help for available commands.`,
        stateChanged: false,
      };
  }
}

/** Resolve alias → project name for display in replies. Pure passthrough if not an alias. */
function resolveTarget(input: string): string {
  const store = loadAliases();
  const lower = input.toLowerCase();
  return store[lower] ?? input;
}
