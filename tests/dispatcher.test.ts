import { describe, it, expect } from "@jest/globals";
import { parseCommand } from "../src/dispatcher.js";

describe("parseCommand", () => {
  it("parses /auto", () => {
    expect(parseCommand("/auto")).toEqual({ type: "auto" });
  });

  it("parses /gsd auto", () => {
    expect(parseCommand("/gsd auto")).toEqual({ type: "auto" });
  });

  it("parses /stop", () => {
    expect(parseCommand("/stop")).toEqual({ type: "stop" });
  });

  it("parses /pause", () => {
    expect(parseCommand("/pause")).toEqual({ type: "pause" });
  });

  it("parses /status", () => {
    expect(parseCommand("/status")).toEqual({ type: "status" });
  });

  it("parses /help", () => {
    expect(parseCommand("/help")).toEqual({ type: "help" });
  });

  it("returns unknown for unrecognized text", () => {
    const result = parseCommand("/something-random");
    expect(result).toEqual({ type: "unknown", raw: "/something-random" });
  });

  it("is case-insensitive", () => {
    expect(parseCommand("/AUTO")).toEqual({ type: "auto" });
    expect(parseCommand("/Stop")).toEqual({ type: "stop" });
  });

  it("trims whitespace", () => {
    expect(parseCommand("  /auto  ")).toEqual({ type: "auto" });
  });
});
