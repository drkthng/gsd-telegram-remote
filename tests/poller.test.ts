import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { PollLoop } from "../src/poller.js";

/** Minimal delay that yields to the event loop. */
const MOCK_DELAY_MS = 5;

/** Empty getUpdates response. */
const EMPTY_UPDATES = JSON.stringify({ ok: true, result: [] });

/** Build a mock Response with a delay. */
async function delayedResponse(body: string): Promise<Response> {
  await new Promise<void>((r) => setTimeout(r, MOCK_DELAY_MS));
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

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

describe("PollLoop pause/resume", () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  let loop: PollLoop;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, "fetch") as jest.SpiedFunction<typeof fetch>;
    fetchSpy.mockImplementation(async () => delayedResponse(EMPTY_UPDATES));
  });

  afterEach(async () => {
    loop?.stop();
    await new Promise<void>((r) => setTimeout(r, 50));
    fetchSpy.mockRestore();
  });

  it("pause() returns a promise that resolves after in-flight getUpdates", async () => {
    loop = new PollLoop({
      botToken: "test:token",
      chatId: "-999",
      allowedUserIds: [42],
    });
    loop.start();

    // Wait for at least one getUpdates call
    await new Promise<void>((r) => setTimeout(r, 50));

    const pausePromise = loop.pause();
    // The promise should resolve (in-flight request completes)
    await expect(pausePromise).resolves.toBeUndefined();

    loop.resume();
    loop.stop();
  }, 5000);

  it("resume() after pause restarts polling", async () => {
    loop = new PollLoop({
      botToken: "test:token",
      chatId: "-999",
      allowedUserIds: [42],
    });
    loop.start();

    // Wait for polling to start
    await new Promise<void>((r) => setTimeout(r, 50));

    await loop.pause();
    const callsAfterPause = fetchSpy.mock.calls.length;

    // Wait — no new calls should happen while paused
    await new Promise<void>((r) => setTimeout(r, 100));
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(callsAfterPause + 1);

    // Resume and verify new calls happen
    loop.resume();
    await new Promise<void>((r) => setTimeout(r, 100));
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterPause + 1);

    loop.stop();
  }, 5000);

  it("double pause() is safe (no throw)", async () => {
    loop = new PollLoop({
      botToken: "test:token",
      chatId: "-999",
      allowedUserIds: [42],
    });
    loop.start();
    await new Promise<void>((r) => setTimeout(r, 50));

    const p1 = loop.pause();
    const p2 = loop.pause(); // second pause — should resolve immediately
    await expect(p2).resolves.toBeUndefined();
    await p1;

    loop.resume();
    loop.stop();
  }, 5000);

  it("resume() without prior pause is safe (no throw)", () => {
    loop = new PollLoop({
      botToken: "test:token",
      chatId: "-999",
      allowedUserIds: [42],
    });
    expect(() => loop.resume()).not.toThrow();
  });
});
