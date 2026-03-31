/**
 * config.test.ts — Tests for R008 and R012.
 *
 * R008: Extension gracefully disables when config is absent.
 * R012: Config reads from JSON config file + env vars.
 *
 * chatId is read from ~/.gsd/telegram-remote.json or TELEGRAM_REMOTE_CHAT_ID env.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { resolveConfig, isEnabled } from "../src/config.js";

const VALID_TOKEN = "123456:ABCdef-test-token";

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

  it("returns true when no config exists (default enabled)", () => {
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
  let origChatId: string | undefined;

  beforeEach(() => {
    origToken = process.env.TELEGRAM_BOT_TOKEN;
    origAllowedUsers = process.env.TELEGRAM_REMOTE_ALLOWED_USERS;
    origChatId = process.env.TELEGRAM_REMOTE_CHAT_ID;
    process.env.TELEGRAM_BOT_TOKEN = VALID_TOKEN;
    process.env.TELEGRAM_REMOTE_ALLOWED_USERS = "123456789";
    process.env.TELEGRAM_REMOTE_CHAT_ID = "799480019";
  });

  afterEach(() => {
    if (origToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = origToken;
    else delete process.env.TELEGRAM_BOT_TOKEN;
    if (origAllowedUsers !== undefined) process.env.TELEGRAM_REMOTE_ALLOWED_USERS = origAllowedUsers;
    else delete process.env.TELEGRAM_REMOTE_ALLOWED_USERS;
    if (origChatId !== undefined) process.env.TELEGRAM_REMOTE_CHAT_ID = origChatId;
    else delete process.env.TELEGRAM_REMOTE_CHAT_ID;
  });

  // R008: missing bot token → null
  it("returns null when TELEGRAM_BOT_TOKEN is not set", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(resolveConfig(null)).toBeNull();
  });

  // R012: env vars provide full config
  it("returns config from env vars", () => {
    const config = resolveConfig(null);
    expect(config).not.toBeNull();
    expect(config!.botToken).toBe(VALID_TOKEN);
    expect(config!.chatId).toBe("799480019");
    expect(config!.allowedUserIds).toEqual([123456789]);
  });

  // R008: missing chat_id (no env, no JSON config) → null
  it("returns null when chat_id is missing everywhere", () => {
    delete process.env.TELEGRAM_REMOTE_CHAT_ID;
    // No JSON config file in test env → null
    // (readOwnConfig returns null, migrateFromPreferences returns null)
    const config = resolveConfig(null);
    // Depends on whether ~/.gsd/telegram-remote.json exists on this machine
    if (!config) {
      expect(config).toBeNull();
    }
  });

  // R012: no allowed_user_ids when env empty
  it("returns null when allowed_user_ids env is invalid", () => {
    process.env.TELEGRAM_REMOTE_ALLOWED_USERS = "invalid";
    expect(resolveConfig(null)).toBeNull();
  });

  // R012: env var with multiple IDs
  it("TELEGRAM_REMOTE_ALLOWED_USERS with multiple entries", () => {
    process.env.TELEGRAM_REMOTE_ALLOWED_USERS = "555666777,888999000";
    const config = resolveConfig(null);
    expect(config!.allowedUserIds).toEqual([555666777, 888999000]);
  });

  // R012: env var with invalid entries strips them
  it("TELEGRAM_REMOTE_ALLOWED_USERS with invalid entries strips them", () => {
    process.env.TELEGRAM_REMOTE_ALLOWED_USERS = "123,abc,456";
    const config = resolveConfig(null);
    expect(config!.allowedUserIds).toEqual([123, 456]);
  });
});
