import { describe, it, expect } from "@jest/globals";
import { isAllowedUser, getSenderId } from "../src/auth.js";

describe("isAllowedUser", () => {
  it("returns true for a listed user ID", () => {
    expect(isAllowedUser(123456, [123456, 999999])).toBe(true);
  });

  it("returns false for an unlisted user ID", () => {
    expect(isAllowedUser(111111, [123456, 999999])).toBe(false);
  });

  it("returns false for empty allowlist", () => {
    expect(isAllowedUser(123456, [])).toBe(false);
  });
});

describe("getSenderId", () => {
  it("returns the user ID for a human sender", () => {
    const msg = { from: { id: 42, is_bot: false, first_name: "Gordon" } };
    expect(getSenderId(msg)).toBe(42);
  });

  it("returns null if from is absent (channel post)", () => {
    expect(getSenderId({})).toBe(null);
  });

  it("returns null for bot senders (including our own bot)", () => {
    const msg = { from: { id: 9999, is_bot: true, first_name: "MyBot" } };
    expect(getSenderId(msg)).toBe(null);
  });
});
