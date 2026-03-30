import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  loadAliases,
  saveAliases,
  setAlias,
  deleteAlias,
  resolveAlias,
  listAliases,
} from "../src/aliases.js";

let tmpFile: string;

beforeEach(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "alias-test-"));
  tmpFile = path.join(dir, "aliases.json");
});

afterEach(async () => {
  await fs.rm(path.dirname(tmpFile), { recursive: true, force: true });
});

// ── loadAliases ───────────────────────────────────────────────────────────────

describe("loadAliases", () => {
  it("returns {} when file does not exist", () => {
    expect(loadAliases(tmpFile)).toEqual({});
  });

  it("returns {} on corrupt JSON", async () => {
    await fs.writeFile(tmpFile, "not-json", "utf-8");
    expect(loadAliases(tmpFile)).toEqual({});
  });

  it("returns {} when file contains an array", async () => {
    await fs.writeFile(tmpFile, "[]", "utf-8");
    expect(loadAliases(tmpFile)).toEqual({});
  });

  it("returns stored aliases", async () => {
    await fs.writeFile(tmpFile, JSON.stringify({ ab: "my-project" }), "utf-8");
    expect(loadAliases(tmpFile)).toEqual({ ab: "my-project" });
  });
});

// ── saveAliases ───────────────────────────────────────────────────────────────

describe("saveAliases", () => {
  it("writes and reads back correctly", () => {
    saveAliases({ xy: "other-project" }, tmpFile);
    expect(loadAliases(tmpFile)).toEqual({ xy: "other-project" });
  });
});

// ── setAlias ──────────────────────────────────────────────────────────────────

describe("setAlias", () => {
  it("creates a new alias", () => {
    const result = setAlias("ab", "my-project", tmpFile);
    expect(result).toEqual({ ok: true });
    expect(loadAliases(tmpFile)).toEqual({ ab: "my-project" });
  });

  it("lowercases the alias", () => {
    setAlias("AB", "my-project", tmpFile);
    expect(loadAliases(tmpFile)).toEqual({ ab: "my-project" });
  });

  it("allows overwrite with same project", () => {
    setAlias("ab", "my-project", tmpFile);
    const result = setAlias("ab", "my-project", tmpFile);
    expect(result).toEqual({ ok: true });
  });

  it("rejects overwrite with different project", () => {
    setAlias("ab", "my-project", tmpFile);
    const result = setAlias("ab", "other-project", tmpFile);
    expect(result).toMatchObject({ ok: false });
    expect((result as { ok: false; error: string }).error).toContain("already maps to");
  });

  it("rejects alias shorter than 2 chars", () => {
    const result = setAlias("a", "my-project", tmpFile);
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects alias longer than 3 chars", () => {
    const result = setAlias("abcd", "my-project", tmpFile);
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects alias with special characters", () => {
    const result = setAlias("a-b", "my-project", tmpFile);
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects empty project name", () => {
    const result = setAlias("ab", "  ", tmpFile);
    expect(result).toMatchObject({ ok: false });
  });

  it("allows 3-char alias", () => {
    const result = setAlias("abc", "my-project", tmpFile);
    expect(result).toEqual({ ok: true });
  });
});

// ── deleteAlias ───────────────────────────────────────────────────────────────

describe("deleteAlias", () => {
  it("deletes an existing alias and returns true", () => {
    setAlias("ab", "my-project", tmpFile);
    expect(deleteAlias("ab", tmpFile)).toBe(true);
    expect(loadAliases(tmpFile)).toEqual({});
  });

  it("returns false when alias does not exist", () => {
    expect(deleteAlias("ab", tmpFile)).toBe(false);
  });

  it("is case-insensitive", () => {
    setAlias("ab", "my-project", tmpFile);
    expect(deleteAlias("AB", tmpFile)).toBe(true);
  });
});

// ── resolveAlias ──────────────────────────────────────────────────────────────

describe("resolveAlias", () => {
  it("returns project name for a known alias", () => {
    expect(resolveAlias("ab", { ab: "my-project" })).toBe("my-project");
  });

  it("passes through unknown input unchanged", () => {
    expect(resolveAlias("my-project", { ab: "other" })).toBe("my-project");
  });

  it("is case-insensitive for alias lookup", () => {
    expect(resolveAlias("AB", { ab: "my-project" })).toBe("my-project");
  });

  it("returns empty store passthrough", () => {
    expect(resolveAlias("ab", {})).toBe("ab");
  });
});

// ── listAliases ───────────────────────────────────────────────────────────────

describe("listAliases", () => {
  it("returns empty array for empty store", () => {
    expect(listAliases({})).toEqual([]);
  });

  it("returns sorted entries", () => {
    const store = { zz: "proj-z", aa: "proj-a", mm: "proj-m" };
    expect(listAliases(store)).toEqual([
      { alias: "aa", project: "proj-a" },
      { alias: "mm", project: "proj-m" },
      { alias: "zz", project: "proj-z" },
    ]);
  });
});
