import { describe, it, expect } from "@jest/globals";
import { PollLoop } from "../src/poller.js";

describe("PollLoop", () => {
  it("can be instantiated without starting", () => {
    const loop = new PollLoop({
      botToken: "test:token",
      chatId: "-100123456789",
      allowedUserIds: [42],
    });
    expect(loop).toBeDefined();
  });

  it("stop() before start() is a no-op", () => {
    const loop = new PollLoop({
      botToken: "test:token",
      chatId: "-100123456789",
      allowedUserIds: [42],
    });
    expect(() => loop.stop()).not.toThrow();
  });

  it("double start() is a no-op (no second loop)", async () => {
    // We can't easily test the full loop without mocking fetch, but we can
    // verify that calling start() twice doesn't throw.
    // Full integration test with mocked getUpdates is in poller.integration.test.ts (TODO).
    const loop = new PollLoop({
      botToken: "invalid",
      chatId: "-100123456789",
      allowedUserIds: [42],
      onError: () => { /* suppress */ },
    });
    loop.start();
    loop.start(); // second call should be a no-op
    loop.stop();  // clean up immediately
  });
});
