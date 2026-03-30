/**
 * config.ts — Resolve extension configuration from GSD preferences and env.
 *
 * Reads bot token from TELEGRAM_BOT_TOKEN env var, or hydrates it from GSD's
 * auth.json (same store remote-questions uses, keyed as "telegram_bot").
 * Reads chatId from preferences.remote_questions.channel_id.
 * Reads allowed_user_ids from our own parse of preferences.md because GSD's
 * validator strips unknown keys (telegram_remote isn't a known GSD pref).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { RemoteConfig } from "./types.js";

/**
 * Ensure TELEGRAM_BOT_TOKEN is populated from the GSD auth store if not
 * already set in the environment.
 */
function hydrateTokenFromAuth(): void {
  if (process.env.TELEGRAM_BOT_TOKEN) return;
  try {
    // Dynamic import to avoid breaking tests where @gsd/pi-coding-agent
    // doesn't export AuthStorage in the mock environment.
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
 * Read telegram_remote block directly from preferences.md YAML frontmatter.
 * GSD's preferences validator strips unknown keys, so we parse it ourselves.
 */
function readTelegramRemoteBlock(): { enabled?: boolean; allowed_user_ids?: number[] } | null {
  const paths = [
    join(process.cwd(), ".gsd", "preferences.md"),
    join(homedir(), ".gsd", "preferences.md"),
    join(homedir(), ".gsd", "agent", "preferences.md"),
  ];

  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, "utf-8");
      // Extract YAML frontmatter between --- delimiters
      const startMarker = raw.startsWith("---\r\n") ? "---\r\n" : "---\n";
      if (!raw.startsWith(startMarker)) continue;
      const endIdx = raw.indexOf("\n---", startMarker.length);
      if (endIdx === -1) continue;
      const yaml = raw.slice(startMarker.length, endIdx);

      // Simple extraction: find telegram_remote block
      const match = yaml.match(/^telegram_remote:\s*\n((?:\s+.+\n?)*)/m);
      if (!match) continue;

      const block = match[1];
      const enabledMatch = block.match(/enabled:\s*(true|false)/);
      const idsMatch = block.match(/allowed_user_ids:\s*\[([^\]]*)\]/);

      return {
        enabled: enabledMatch ? enabledMatch[1] === "true" : undefined,
        allowed_user_ids: idsMatch
          ? idsMatch[1].split(",").map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0)
          : undefined,
      };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Read allowed_user_ids from env var or preferences file.
 */
function resolveAllowedUserIds(): number[] {
  const envVal = process.env.TELEGRAM_REMOTE_ALLOWED_USERS;
  if (envVal) {
    return envVal
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  const block = readTelegramRemoteBlock();
  return block?.allowed_user_ids ?? [];
}

/**
 * Resolve the full extension config from preferences + env vars.
 * Returns null if bot token, chatId, or allowlist is missing.
 */
export function resolveConfig(prefs: Record<string, unknown> | null): RemoteConfig | null {
  hydrateTokenFromAuth();

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.warn("[gsd-telegram-remote] config: TELEGRAM_BOT_TOKEN not found in env or auth store");
    return null;
  }

  const rq = (prefs as { remote_questions?: { channel_id?: unknown } } | null)
    ?.remote_questions;
  const chatId = rq?.channel_id != null ? String(rq.channel_id) : null;
  if (!chatId) {
    console.warn("[gsd-telegram-remote] config: remote_questions.channel_id missing");
    return null;
  }

  const allowedUserIds = resolveAllowedUserIds();
  if (allowedUserIds.length === 0) {
    console.warn("[gsd-telegram-remote] config: no allowed_user_ids found in prefs or env");
    return null;
  }

  return { botToken, chatId, allowedUserIds };
}

export function isEnabled(prefs: Record<string, unknown> | null): boolean {
  const envEnabled = process.env.TELEGRAM_REMOTE_ENABLED;
  if (envEnabled === "0" || envEnabled === "false") return false;
  if (envEnabled === "1" || envEnabled === "true") return true;

  const block = readTelegramRemoteBlock();
  return block?.enabled !== false;
}
