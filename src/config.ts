/**
 * config.ts — Resolve extension configuration from env, own JSON config, and GSD auth.
 *
 * Config resolution order (first match wins per field):
 *   1. Environment variables (TELEGRAM_BOT_TOKEN, TELEGRAM_REMOTE_CHAT_ID, etc.)
 *   2. ~/.gsd/telegram-remote.json — our own config file, never touched by GSD
 *   3. GSD auth.json for TELEGRAM_BOT_TOKEN (same store /gsd keys uses)
 *
 * We no longer read from preferences.md — GSD's preferences validator strips
 * unknown keys like telegram_remote during rewrites, causing silent data loss.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { RemoteConfig } from "./types.js";

/** Path to our own config file — GSD never touches this. */
const CONFIG_PATH = join(homedir(), ".gsd", "telegram-remote.json");

export interface TelegramRemoteConfig {
  enabled?: boolean;
  chat_id?: string;
  allowed_user_ids?: number[];
}

/**
 * Read our own JSON config file. Returns null if absent or malformed.
 */
function readOwnConfig(): TelegramRemoteConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as TelegramRemoteConfig;
  } catch {
    return null;
  }
}

/**
 * Write config to our own JSON file.
 */
export function writeOwnConfig(config: TelegramRemoteConfig): void {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Migrate from preferences.md telegram_remote block to telegram-remote.json.
 * Reads preferences.md, extracts the block, writes JSON, and returns the config.
 * Only runs if telegram-remote.json doesn't exist yet.
 */
function migrateFromPreferences(): TelegramRemoteConfig | null {
  if (existsSync(CONFIG_PATH)) return null; // already migrated

  const prefsPaths = [
    join(process.cwd(), ".gsd", "preferences.md"),
    join(process.cwd(), ".gsd", "PREFERENCES.md"),
    join(homedir(), ".gsd", "preferences.md"),
    join(homedir(), ".gsd", "PREFERENCES.md"),
  ];

  for (const p of prefsPaths) {
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, "utf-8");
      const startMarker = raw.startsWith("---\r\n") ? "---\r\n" : "---\n";
      if (!raw.startsWith(startMarker)) continue;
      const endIdx = raw.indexOf("\n---", startMarker.length);
      if (endIdx === -1) continue;
      const yaml = raw.slice(startMarker.length, endIdx);

      const match = yaml.match(/^telegram_remote:\s*\n((?:\s+.+\n?)*)/m);
      if (!match) continue;

      const block = match[1];
      const enabledMatch = block.match(/enabled:\s*(true|false)/);
      const chatIdMatch = block.match(/chat_id:\s*(-?\d+)/);
      const idsMatch = block.match(/allowed_user_ids:\s*\[([^\]]*)\]/);

      if (!chatIdMatch) continue;

      const config: TelegramRemoteConfig = {
        enabled: enabledMatch ? enabledMatch[1] === "true" : true,
        chat_id: chatIdMatch[1],
        allowed_user_ids: idsMatch
          ? idsMatch[1].split(",").map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0)
          : undefined,
      };

      writeOwnConfig(config);
      console.log(`[gsd-telegram-remote] Migrated config from ${p} → ${CONFIG_PATH}`);
      return config;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Ensure TELEGRAM_BOT_TOKEN is populated from the GSD auth store if not
 * already set in the environment.
 */
function hydrateTokenFromAuth(): void {
  if (process.env.TELEGRAM_BOT_TOKEN) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AuthStorage } = require("@gsd/pi-coding-agent");
    if (!AuthStorage?.create) return;
    const auth = AuthStorage.create();
    const creds = auth.getCredentialsForProvider("telegram_bot");
    const apiKeyCred = creds.find(
      (c: { type: string; key?: string }) => c.type === "api_key" && !!c.key,
    ) as { type: "api_key"; key: string } | undefined;
    if (apiKeyCred?.key) {
      process.env.TELEGRAM_BOT_TOKEN = apiKeyCred.key;
    }
  } catch {
    // AuthStorage unavailable — skip silently.
  }
}

/**
 * Read allowed_user_ids from env var or config file.
 */
function resolveAllowedUserIds(ownConfig: TelegramRemoteConfig | null): number[] {
  const envVal = process.env.TELEGRAM_REMOTE_ALLOWED_USERS;
  if (envVal) {
    return envVal
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  return ownConfig?.allowed_user_ids ?? [];
}

/**
 * Resolve the full extension config from env vars + own JSON config.
 * Returns null if bot token, chatId, or allowlist is missing.
 */
export function resolveConfig(_prefs: Record<string, unknown> | null): RemoteConfig | null {
  hydrateTokenFromAuth();

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.warn("[gsd-telegram-remote] config: TELEGRAM_BOT_TOKEN not found in env or auth store");
    return null;
  }

  // Try own config, then migrate from preferences.md
  let ownConfig = readOwnConfig();
  if (!ownConfig) {
    ownConfig = migrateFromPreferences();
  }

  const chatId = process.env.TELEGRAM_REMOTE_CHAT_ID ?? ownConfig?.chat_id ?? null;
  if (!chatId) {
    console.warn(`[gsd-telegram-remote] config: chat_id not found. Create ${CONFIG_PATH} with {"chat_id":"<id>","allowed_user_ids":[<id>]}`);
    return null;
  }

  const allowedUserIds = resolveAllowedUserIds(ownConfig);
  if (allowedUserIds.length === 0) {
    console.warn(`[gsd-telegram-remote] config: no allowed_user_ids found. Add to ${CONFIG_PATH} or TELEGRAM_REMOTE_ALLOWED_USERS env`);
    return null;
  }

  return { botToken, chatId, allowedUserIds };
}

export function isEnabled(_prefs: Record<string, unknown> | null): boolean {
  const envEnabled = process.env.TELEGRAM_REMOTE_ENABLED;
  if (envEnabled === "0" || envEnabled === "false") return false;
  if (envEnabled === "1" || envEnabled === "true") return true;

  const ownConfig = readOwnConfig();
  return ownConfig?.enabled !== false;
}

/** Exposed for tests */
export function getConfigPath(): string {
  return CONFIG_PATH;
}
