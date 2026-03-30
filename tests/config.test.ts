/**
 * config.test.ts — Tests for R008 and R012.
 *
 * R008: Extension gracefully disables when config is absent.
 * R012: Config reads from preferences file + env vars.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { resolveConfig, isEnabled } from "../src/config.js";

const VALID_TOKEN = "123456:ABCdef-test-token";
const VALID_CHANNEL_ID = "799480019";

function makePrefs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    remote_questions: { channel: "telegram", channel_id: VALID_CHANNEL_ID, ...overrides },
  };
}

// ─── isEnabled ───────────────────────────────────────────────────────────────

describe("isEnabled (R012)", () => {
  let origEnabled: string | undefined;

  beforeEach(() => {
    origEnabled = process.env.TELEGRAM_REMOTE_ENABLED;
    delete process.env.TELEGRAM_REMOTE_ENABLED;
  });

  afterEach(() => {
    if (origEnabled !== undefined) process.env.TELEGRAM_REMOTE_ENABLED = origEnabled;
    else delete process.env.TELEGRAM_REMOTE_ENABLED;
  });

  it("returns true when prefs is null (default enabled)", () => {
    expect(isEnabled(null)).toBe(true);
  });

  it("env TELEGRAM_REMOTE_ENABLED=0 disables", () => {
    process.env.TELEGRAM_REMOTE_ENABLED = "0";
    expect(isEnabled(null)).toBe(false);
  });

  it("env TELEGRAM_REMOTE_ENABLED=false disables", () => {
    process.env.TELEGRAM_REMOTE_ENABLED = "false";
    expect(isEnabled(null)).toBe(false);
  });

  it("env TELEGRAM_REMOTE_ENABLED=1 enables", () => {
    process.env.TELEGRAM_REMOTE_ENABLED = "1";
    expect(isEnabled(null)).toBe(true);
  });

  it("env TELEGRAM_REMOTE_ENABLED=true enables", () => {
    process.env.TELEGRAM_REMOTE_ENABLED = "true";
    expect(isEnabled(null)).toBe(true);
  });
});

// ─── resolveConfig ───────────────────────────────────────────────────────────

describe("resolveConfig (R008 + R012)", () => {
  let origToken: string | undefined;
  let origAllowedUsers: string | undefined;

  beforeEach(() => {
    origToken = process.env.TELEGRAM_BOT_TOKEN;
    origAllowedUsers = process.env.TELEGRAM_REMOTE_ALLOWED_USERS;
    process.env.TELEGRAM_BOT_TOKEN = VALID_TOKEN;
    // Use env var for allowed users so tests don't depend on preferences.md existing
    process.env.TELEGRAM_REMOTE_ALLOWED_USERS = "123456789";
  });

  afterEach(() => {
    if (origToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = origToken;
    else delete process.env.TELEGRAM_BOT_TOKEN;
    if (origAllowedUsers !== undefined) process.env.TELEGRAM_REMOTE_ALLOWED_USERS = origAllowedUsers;
    else delete process.env.TELEGRAM_REMOTE_ALLOWED_USERS;
  });

  // R008: missing bot token → null
  it("returns null when TELEGRAM_BOT_TOKEN is not set", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(resolveConfig(makePrefs())).toBeNull();
  });

  // R008: missing channel_id → null
  it("returns null when remote_questions.channel_id is absent", () => {
    expect(resolveConfig({})).toBeNull();
  });

  // R008: null prefs → null
  it("returns null when prefs is null", () => {
    expect(resolveConfig(null)).toBeNull();
  });

  // R012: no allowed_user_ids when env empty and no prefs file matches
  it("returns null when allowed_user_ids env is empty string and no prefs file", () => {
    process.env.TELEGRAM_REMOTE_ALLOWED_USERS = "invalid";
    expect(resolveConfig(makePrefs())).toBeNull();
  });

  // R012: valid config
  it("returns config with token, chatId, and allowedUserIds", () => {
    const config = resolveConfig(makePrefs());
    expect(config).not.toBeNull();
    expect(config!.botToken).toBe(VALID_TOKEN);
    expect(config!.chatId).toBe(VALID_CHANNEL_ID);
    expect(config!.allowedUserIds).toEqual([123456789]);
  });

  // R012: numeric channel_id is stringified
  it("stringifies numeric channel_id", () => {
    const config = resolveConfig({ remote_questions: { channel_id: 799480019 } });
    expect(config!.chatId).toBe("799480019");
  });

  // R012: env var with multiple IDs
  it("TELEGRAM_REMOTE_ALLOWED_USERS with multiple entries", () => {
    process.env.TELEGRAM_REMOTE_ALLOWED_USERS = "555666777,888999000";
    const config = resolveConfig(makePrefs());
    expect(config!.allowedUserIds).toEqual([555666777, 888999000]);
  });

  // R012: env var with invalid entries strips them
  it("TELEGRAM_REMOTE_ALLOWED_USERS with invalid entries strips them", () => {
    process.env.TELEGRAM_REMOTE_ALLOWED_USERS = "123,abc,456";
    const config = resolveConfig(makePrefs());
    expect(config!.allowedUserIds).toEqual([123, 456]);
  });
});
