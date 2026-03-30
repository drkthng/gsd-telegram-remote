/**
 * aliases.ts — 2-3 char project alias store.
 *
 * Aliases are stored in ~/.gsd/telegram-remote-aliases.json as a flat
 * Record<alias, projectName>. Writes are atomic (write to .tmp, rename)
 * to avoid corrupt reads across concurrent sessions.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const ALIAS_FILE = join(homedir(), ".gsd", "telegram-remote-aliases.json");

/** alias → project name */
export type AliasStore = Record<string, string>;

const ALIAS_RE = /^[a-z0-9]{2,3}$/;

// ── I/O ──────────────────────────────────────────────────────────────────────

export function loadAliases(file = ALIAS_FILE): AliasStore {
  if (!existsSync(file)) return {};
  try {
    const raw = readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as AliasStore;
    }
    return {};
  } catch {
    return {};
  }
}

export function saveAliases(store: AliasStore, file = ALIAS_FILE): void {
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
  renameSync(tmp, file);
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Set an alias. Validates format (2-3 lowercase alphanumeric chars).
 * Overwrites silently if the alias already maps to the same project.
 * Returns an error if the alias already maps to a different project.
 */
export function setAlias(
  alias: string,
  project: string,
  file = ALIAS_FILE,
): { ok: true } | { ok: false; error: string } {
  const a = alias.toLowerCase();
  if (!ALIAS_RE.test(a)) {
    return { ok: false, error: `Alias must be 2-3 lowercase alphanumeric characters (got "${alias}").` };
  }
  if (!project.trim()) {
    return { ok: false, error: "Project name cannot be empty." };
  }
  const store = loadAliases(file);
  if (store[a] && store[a] !== project) {
    return {
      ok: false,
      error: `Alias "${a}" already maps to "${store[a]}". Use /alias del ${a} first.`,
    };
  }
  store[a] = project;
  saveAliases(store, file);
  return { ok: true };
}

/**
 * Delete an alias. Returns false if the alias was not found.
 */
export function deleteAlias(alias: string, file = ALIAS_FILE): boolean {
  const a = alias.toLowerCase();
  const store = loadAliases(file);
  if (!(a in store)) return false;
  delete store[a];
  saveAliases(store, file);
  return true;
}

/**
 * Resolve an alias or passthrough. If the input matches a known alias,
 * returns the mapped project name. Otherwise returns input unchanged
 * (allows full project names to pass through transparently).
 */
export function resolveAlias(input: string, store: AliasStore): string {
  const lower = input.toLowerCase();
  return store[lower] ?? input;
}

/**
 * List all aliases sorted alphabetically.
 */
export function listAliases(store: AliasStore): Array<{ alias: string; project: string }> {
  return Object.entries(store)
    .map(([alias, project]) => ({ alias, project }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
}
