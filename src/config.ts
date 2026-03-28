/**
 * config.ts — Resolve extension configuration from GSD preferences and env.
 *
 * Reuses the existing remote-questions bot token (TELEGRAM_BOT_TOKEN) so no
 * additional credential setup is needed.
 *
 * telegram_remote block in ~/.gsd/agent/preferences.md:
 *   telegram_remote:
 *     enabled: true
 *     allowed_user_ids: [123456789]
 */

import type { RemoteConfig } from "./types.js";

/** Loaded lazily — will be populated once GSD internals are accessible. */
let _resolveRemoteConfig: (() => { token: string; channelId: string } | null) | null = null;

/**
 * Inject the GSD resolveRemoteConfig function at activation time.
 * Called from index.ts after dynamic-importing the remote-questions module.
 */
export function injectGsdConfigResolver(
  fn: () => { token: string; channelId: string } | null,
): void {
  _resolveRemoteConfig = fn;
}

/**
 * Read allowed_user_ids from preferences frontmatter or env var.
 *
 * Env var format: TELEGRAM_REMOTE_ALLOWED_USERS=123456789,987654321
 */
function resolveAllowedUserIds(prefs: Record<string, unknown> | null): number[] {
  // Env var takes priority
  const envVal = process.env.TELEGRAM_REMOTE_ALLOWED_USERS;
  if (envVal) {
    return envVal
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  // Fall back to preferences block
  const block = (prefs as { telegram_remote?: { allowed_user_ids?: unknown } } | null)
    ?.telegram_remote?.allowed_user_ids;

  if (Array.isArray(block)) {
    return block
      .map((v: unknown) => Number(v))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  return [];
}

/**
 * Resolve the full extension config. Returns null if the bot token or
 * channel ID is not configured (graceful no-op — extension stays dormant).
 */
export function resolveConfig(prefs: Record<string, unknown> | null): RemoteConfig | null {
  if (!_resolveRemoteConfig) return null;

  const gsdCfg = _resolveRemoteConfig();
  if (!gsdCfg) return null;

  const allowedUserIds = resolveAllowedUserIds(prefs);
  if (allowedUserIds.length === 0) {
    // No allowlist → refuse to run (would be an open relay)
    return null;
  }

  return {
    botToken: gsdCfg.token,
    chatId: gsdCfg.channelId,
    allowedUserIds,
  };
}

export function isEnabled(prefs: Record<string, unknown> | null): boolean {
  const envEnabled = process.env.TELEGRAM_REMOTE_ENABLED;
  if (envEnabled === "0" || envEnabled === "false") return false;
  if (envEnabled === "1" || envEnabled === "true") return true;

  const block = (prefs as { telegram_remote?: { enabled?: unknown } } | null)
    ?.telegram_remote?.enabled;

  // Default: enabled if configured
  return block !== false;
}
