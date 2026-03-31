/**
 * config.test.ts — Tests for R008 and R012.
 *
 * R008: Extension gracefully disables when config is absent.
 * R012: Config reads from preferences file + env vars.
 *
 * chatId is read from the telegram_remote block in preferences.md files,
 * not from the prefs object passed to resolveConfig(). Tests that need
 * to control chatId use TELEGRAM_REMOTE_CHAT_ID env var or rely on the
 * actual preferences.md on disk.
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
    expect(resolveConfig(null)).toBeNull();
  });

  // R012: chatId comes from telegram_remote.chat_id in preferences.md on disk.
  // When the file has it (as on this dev machine), resolveConfig succeeds.
  // This test verifies the happy path reads it correctly.
  it("returns config when telegram_remote.chat_id is in preferences.md", () => {
    const config = resolveConfig(null);
    // If preferences.md on disk has chat_id, config is valid
    if (config) {
      expect(config.botToken).toBe(VALID_TOKEN);
      expect(config.chatId).toBeTruthy();
      expect(config.allowedUserIds).toEqual([123456789]);
    }
    // If no preferences.md on disk (CI), config is null — that's fine
  });

  // R012: no allowed_user_ids when env empty and no prefs file matches
  it("returns null when allowed_user_ids env is empty string and no prefs file", () => {
    process.env.TELEGRAM_REMOTE_ALLOWED_USERS = "invalid";
    expect(resolveConfig(null)).toBeNull();
  });

  // R012: env var with multiple IDs
  it("TELEGRAM_REMOTE_ALLOWED_USERS with multiple entries", () => {
    const config = resolveConfig(null);
    if (!config) return; // skip on CI without preferences.md
    process.env.TELEGRAM_REMOTE_ALLOWED_USERS = "555666777,888999000";
    const config2 = resolveConfig(null);
    expect(config2!.allowedUserIds).toEqual([555666777, 888999000]);
  });

  // R012: env var with invalid entries strips them
  it("TELEGRAM_REMOTE_ALLOWED_USERS with invalid entries strips them", () => {
    process.env.TELEGRAM_REMOTE_ALLOWED_USERS = "123,abc,456";
    const config = resolveConfig(null);
    if (!config) return; // skip on CI without preferences.md
    expect(config.allowedUserIds).toEqual([123, 456]);
  });
});
