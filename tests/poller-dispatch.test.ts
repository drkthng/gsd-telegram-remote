/**
 * poller-dispatch.test.ts — End-to-end integration tests for the PollLoop dispatch chain.
 *
 * These tests drive PollLoop with a mocked global fetch, exercising the full path:
 *   getUpdates → auth-check → parseCommand → executeCommand → sendMessage
 *
 * We mock at the global fetch level (jest.spyOn(globalThis, 'fetch')) so production
 * code is unchanged — no fetch injection, no module rewiring.
 *
 * NOTE: The mock MUST add a small delay on getUpdates responses (>0ms) to prevent
 * the poll loop from busy-spinning and starving Jest's timer/microtask queues.
 * Without a yield point, setInterval-based polling and test timeouts never fire.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { PollLoop } from "../src/poller.js";
import { injectDeps, injectListProjects } from "../src/dispatcher.js";
import type { ExtensionAPI } from "@gsd/pi-coding-agent";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal delay that yields to the event loop without blocking tests. */
const MOCK_DELAY_MS = 5;

/** Build a Telegram getUpdates response with one text message. */
function makeUpdateResponse(
  updateId: number,
  senderId: number,
  chatId: number,
  text: string,
  replyToMessage?: { message_id: number },
) {
  return JSON.stringify({
    ok: true,
    result: [
      {
        update_id: updateId,
        message: {
          message_id: 1,
          from: { id: senderId, is_bot: false, first_name: "Test" },
          chat: { id: chatId, type: "private" },
          text,
          date: 1000,
          ...(replyToMessage ? { reply_to_message: replyToMessage } : {}),
        },
      },
    ],
  });
}

/** Build a mock Response with a delay. */
async function delayedResponse(body: string): Promise<Response> {
  await new Promise<void>((r) => setTimeout(r, MOCK_DELAY_MS));
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Empty getUpdates — keep loop alive, nothing to dispatch. */
const EMPTY_UPDATES = JSON.stringify({ ok: true, result: [] });
/** Successful sendMessage. */
const SEND_OK = JSON.stringify({ ok: true });

/**
 * Wait for fetch to be called with a URL containing `pattern`.
 * Polls every 20ms up to `timeoutMs`.
 */
function waitForFetchCall(
  spy: jest.SpiedFunction<typeof fetch>,
  pattern: string,
  timeoutMs = 2000,
): Promise<{ url: string; body: string }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      for (const call of spy.mock.calls) {
        const url = String(call[0]);
        if (url.includes(pattern)) {
          const init = call[1] as RequestInit | undefined;
          clearInterval(interval);
          resolve({ url, body: String(init?.body ?? "") });
          return;
        }
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`fetch never called with "${pattern}" within ${timeoutMs}ms`));
      }
    }, 20);
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BOT_TOKEN = "test:token";
const CHAT_ID = "-999";
const CHAT_ID_NUM = -999;
const ALLOWED_USER = 42;

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("PollLoop dispatch integration", () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  let mockSendUserMessage: jest.Mock;
  let loop: PollLoop;

  beforeEach(() => {
    mockSendUserMessage = jest.fn();
    const mockPi = { sendUserMessage: mockSendUserMessage } as unknown as ExtensionAPI;
    const mockStatusApi = { isAutoActive: () => false, isAutoPaused: () => false };

    injectDeps(mockPi, mockStatusApi);
    injectListProjects(async () => []);

    fetchSpy = jest.spyOn(globalThis, "fetch") as jest.SpiedFunction<typeof fetch>;
  });

  afterEach(async () => {
    loop?.stop();
    // Give the loop one event-loop turn to observe the stop flag
    await new Promise<void>((r) => setTimeout(r, 50));
    fetchSpy.mockRestore();
    injectDeps(null, null);
    injectListProjects(null);
  });

  // ── Test 1: /help dispatches through the full chain ──────────────────────────

  it("dispatches /help and calls sendMessage with help text", async () => {
    let getUpdatesCallCount = 0;

    fetchSpy.mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("getUpdates")) {
        getUpdatesCallCount++;
        const body = getUpdatesCallCount === 1
          ? makeUpdateResponse(100, ALLOWED_USER, CHAT_ID_NUM, "/help")
          : EMPTY_UPDATES;
        return delayedResponse(body);
      }

      if (url.includes("sendMessage")) {
        return delayedResponse(SEND_OK);
      }

      return delayedResponse(JSON.stringify({ ok: false, description: "unexpected" }));
    });

    loop = new PollLoop({
      botToken: BOT_TOKEN,
      chatId: CHAT_ID,
      allowedUserIds: [ALLOWED_USER],
    });
    loop.start();

    const { url, body } = await waitForFetchCall(fetchSpy, "sendMessage");
    loop.stop();

    expect(url).toContain(`bot${BOT_TOKEN}/sendMessage`);
    // The help reply must include /auto and /projects
    expect(body).toContain("/auto");
    expect(body).toContain("/projects");
  }, 5000);

  // ── Test 2: Unauthorized sender — sendMessage must NOT be called ─────────────

  it("drops messages from unauthorized users without sending a reply", async () => {
    const UNAUTHORIZED_USER = 999;
    let getUpdatesCallCount = 0;

    fetchSpy.mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("getUpdates")) {
        getUpdatesCallCount++;
        // Only return a message on the first call; go empty after that
        const body = getUpdatesCallCount === 1
          ? makeUpdateResponse(200, UNAUTHORIZED_USER, CHAT_ID_NUM, "/help")
          : EMPTY_UPDATES;
        return delayedResponse(body);
      }

      // sendMessage should never be reached; return OK if it is (to surface the failure)
      return delayedResponse(SEND_OK);
    });

    loop = new PollLoop({
      botToken: BOT_TOKEN,
      chatId: CHAT_ID,
      allowedUserIds: [ALLOWED_USER], // 999 is NOT in the list
    });
    loop.start();

    // Wait long enough for at least one full getUpdates cycle to complete
    await new Promise<void>((r) => setTimeout(r, 300));
    loop.stop();

    // Verify sendMessage was never called
    const sendMessageCalls = fetchSpy.mock.calls.filter((call) =>
      String(call[0]).includes("sendMessage"),
    );
    expect(sendMessageCalls).toHaveLength(0);
  }, 5000);

  // ── Test 3: Loop paused — dispatch skipped ───────────────────────────────────

  it("skips dispatch while the loop is paused", async () => {
    let getUpdatesCallCount = 0;

    fetchSpy.mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("getUpdates")) {
        getUpdatesCallCount++;
        const body = getUpdatesCallCount === 1
          ? makeUpdateResponse(300, ALLOWED_USER, CHAT_ID_NUM, "/help")
          : EMPTY_UPDATES;
        return delayedResponse(body);
      }

      return delayedResponse(SEND_OK);
    });

    loop = new PollLoop({
      botToken: BOT_TOKEN,
      chatId: CHAT_ID,
      allowedUserIds: [ALLOWED_USER],
    });

    // Pause BEFORE starting — updates are received but dispatch is skipped
    loop.pause();
    loop.start();

    // Wait long enough for the first getUpdates cycle to complete
    await new Promise<void>((r) => setTimeout(r, 300));
    loop.stop();

    // sendMessage should never have been called
    const sendMessageCalls = fetchSpy.mock.calls.filter((call) =>
      String(call[0]).includes("sendMessage"),
    );
    expect(sendMessageCalls).toHaveLength(0);
  }, 5000);
});
