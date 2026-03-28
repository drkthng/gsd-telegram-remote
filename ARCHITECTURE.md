# Architecture — gsd-telegram-remote

## Problem statement

GSD's `remote-questions` extension already handles the **question-answer loop**: when
auto-mode pauses asking the user something, it sends the question to Telegram and polls
for a reply. That path is fully implemented and works well.

The gap is **command initiation**: you cannot start, stop, pause, or resume auto-mode
from Telegram. To do that, you have to go back to the terminal. This extension closes
that gap with a lightweight command listener that runs inside GSD.

---

## How GSD extensions work

A GSD extension is a JavaScript module loaded from `~/.gsd/agent/extensions/<name>/`.
It must export an `activate(pi, ctx)` function. The `pi` object is the Extension API —
it lets the extension:

- Register slash commands (`pi.commands.register(...)`)
- Start timers / long-running async work (regular Node.js async)
- Access the GSD auto-mode API via dynamic import of `auto.ts` exports

The extension runs **inside the GSD process**. It shares the same Node.js event loop.
Long-running async loops (like a Telegram poll loop) are fine as long as they are
non-blocking and respect shutdown signals.

---

## Key insight: `stopAutoRemote` + process signals

When GSD auto-mode is running in a **separate GSD session** (e.g. started from another
terminal), you can't call `startAuto()` directly — you're in a different process. But
GSD already solves this for `/gsd stop`: `stopAutoRemote()` reads the session lock file,
finds the PID, and sends a signal.

This extension takes the same approach for all commands:

| Command    | Same-process path              | Cross-process path                     |
|------------|-------------------------------|----------------------------------------|
| `/auto`    | `startAuto(ctx, pi, root)`    | Write a `.gsd/remote-trigger` file;    |
|            |                               | the active session detects it in its   |
|            |                               | next loop iteration and resumes        |
| `/stop`    | `stopAuto(ctx, pi, reason)`   | `stopAutoRemote(root)` (signal)        |
| `/pause`   | `pauseAuto(ctx, pi)`          | `stopAutoRemote` variant or file flag  |
| `/status`  | `isAutoActive()` / `isAutoPaused()` | Read `STATE.md` from disk        |

For M1 (first milestone), we focus on the same-process path: the extension is loaded
by the same GSD instance that runs auto-mode. Cross-process is M2.

---

## Component map

```
gsd-telegram-remote/
  src/
    index.ts              Extension entry point — activate(), deactivate()
    poller.ts             Telegram getUpdates long-poll loop
    dispatcher.ts         Maps incoming commands to GSD API calls
    auth.ts               User ID allowlist validation
    responder.ts          Sends replies back to Telegram (sendMessage)
    state-reader.ts       Reads .gsd/STATE.md to report status without GSD API
    config.ts             Reads config from GSD preferences / env vars
    types.ts              Shared type definitions
  extension-manifest.json
  package.json
  tsconfig.json
  README.md
  ARCHITECTURE.md
  tests/
    auth.test.ts
    dispatcher.test.ts
    poller.test.ts
```

---

## Data flow

```
┌─────────────────────────────────────────────────────────────┐
│  GSD process (same Node.js instance)                        │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  gsd-telegram-remote extension                       │   │
│  │                                                       │   │
│  │  poller.ts                                            │   │
│  │    └─ getUpdates (long-poll, 30s timeout)             │   │
│  │         ↓ on new message                              │   │
│  │    auth.ts → validate from.id against allowlist       │   │
│  │         ↓ allowed                                     │   │
│  │    dispatcher.ts → parse command                      │   │
│  │         ↓                                             │   │
│  │    GSD API:                                           │   │
│  │      startAuto / stopAuto / pauseAuto                 │   │
│  │      isAutoActive / isAutoPaused                      │   │
│  │         ↓                                             │   │
│  │    responder.ts → sendMessage (confirmation)          │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  auto-mode loop (phases.ts, loop.ts)                        │
└─────────────────────────────────────────────────────────────┘
          ↑↓ Telegram Bot API (HTTPS polling)
    ┌─────────────────────────────────┐
    │  Your Telegram client (phone)   │
    └─────────────────────────────────┘
```

---

## Polling design

The extension uses **getUpdates long-polling** — the same mechanism as the existing
`TelegramAdapter.pollAnswer()`. No webhook, no separate server.

Key differences from `pollAnswer()`:
- Poll continuously (not just during a specific question-answer window)
- Match **any** message to the bot, not replies to a specific `message_id`
- Use a 30-second `timeout` parameter on `getUpdates` (Telegram server-side hold)
- Track `lastUpdateId` globally to avoid re-processing

The poll loop runs as a `while (active)` async loop with `await telegramApi("getUpdates",
{ timeout: 30, offset: lastUpdateId + 1 })`. If GSD shuts down, `deactivate()` sets
`active = false` and the loop exits on the next iteration.

**Why not webhooks?** Requires a public HTTPS endpoint and certificate management. Long-
polling works from behind NAT/firewalls, which is where dev machines typically are. Same
reason the existing `TelegramAdapter` uses polling.

---

## Security

### Threat: unauthorized command execution

Anyone who knows your bot token and sends a message to the bot can trigger commands.
Mitigation: **user ID allowlist**. The extension validates `update.message.from.id`
against a list of trusted numeric Telegram user IDs before dispatching any command.
Messages from unknown users are silently dropped (no reply — replying would confirm the
bot exists).

The allowlist is configured in `~/.gsd/agent/preferences.md` frontmatter:

```yaml
telegram_remote:
  allowed_user_ids: [123456789]
```

Or via `TELEGRAM_REMOTE_ALLOWED_USERS=123456789` env var.

### Threat: command injection via message text

Incoming message text is never executed as a shell command. The dispatcher matches
against a fixed command table (`/auto`, `/stop`, `/pause`, `/status`, `/help`).
Unknown commands get a "command not recognized" reply.

### Threat: token exposure

The bot token is already stored in GSD's `auth.json` (encrypted at rest by the existing
`AuthStorage` mechanism). This extension reads it from the same store via the standard
`resolveRemoteConfig()` path — no new credential surface.

---

## Configuration

Reads from the existing GSD preferences structure plus a new `telegram_remote` block:

```yaml
# ~/.gsd/agent/preferences.md frontmatter
remote_questions:
  channel: telegram
  channel_id: "-1001234567890"
  timeout_minutes: 5
  poll_interval_seconds: 5

telegram_remote:
  enabled: true
  allowed_user_ids: [123456789, 987654321]
```

The extension reuses `TELEGRAM_BOT_TOKEN` from the existing remote-questions setup.
No separate bot token needed.

---

## Integration with existing remote-questions

The existing `TelegramAdapter` owns question-answer polling while a prompt is active.
This extension runs its own poll loop **alongside** it. Two goroutines reading from the
same `getUpdates` stream is safe: Telegram delivers each update to exactly one call
(first call wins), and both loops advance `lastUpdateId` correctly.

The practical concern is interleaving: if a `/auto` command arrives while
`TelegramAdapter.pollAnswer()` is mid-poll, one of the two will see it. To avoid the
command poller eating a question answer (or vice versa), the dispatcher checks message
context: it only acts on messages sent **directly** to the bot (not replies to a
specific message). Question answers always arrive as replies to the prompt message_id,
which the command dispatcher explicitly ignores.

---

## Milestones

### M1 — Same-process command control (this repo, initial build)

- Poll loop + auth + dispatcher + responder
- `/auto` (start/resume), `/stop`, `/pause`, `/status`, `/help`
- Works when the extension is loaded by the same GSD instance running auto-mode
- Unit tests for auth, dispatcher, and config parsing

### M2 — Cross-process control (future)

- Resume a paused auto-mode from a different terminal / GSD instance
- Uses file-based signaling (`.gsd/remote-trigger`) or process signals
- Needed for the "I closed my laptop and want to resume" scenario

### M3 — Rich status (future)

- `/status` returns active milestone, current task, cost spent, estimated remaining
- Reads from `STATE.md` and the GSD metrics ledger

---

## Confirmed design decisions

### How commands are executed

`ExtensionAPI` has no `commands.execute()` method. Commands are dispatched via
`pi.sendUserMessage("/gsd auto")` — routes through the same path as the user typing,
inherits all GSD edge-case handling, process-scoped so safe from any async context.

`startAuto()` is not called directly. No `ctx` reference needs to be stored.

### Extension factory signature

GSD extension factories receive only `pi: ExtensionAPI`. No `ctx` at the factory level —
`ctx` only exists inside event handlers.

### Module resolution (verified on disk)

From `~/.gsd/agent/extensions/gsd-telegram-remote/index.js`:

```
importExtensionModule(import.meta.url, "../gsd/auto.js")
  → ~/.gsd/agent/extensions/gsd/auto.js  ✓ exists

importExtensionModule(import.meta.url, "../gsd/preferences.js")
  → ~/.gsd/agent/extensions/gsd/preferences.js  ✓ exists

importExtensionModule(import.meta.url, "../remote-questions/config.js")
  → ~/.gsd/agent/extensions/remote-questions/config.js  ✓ exists
```

All three export the expected functions (`isAutoActive`, `isAutoPaused`,
`loadEffectiveGSDPreferences`, `resolveRemoteConfig`).

### Poll-loop conflict (mitigated)

`TelegramAdapter.pollAnswer()` only runs while `ask_user_questions` is actively
waiting. Two simultaneous `getUpdates` calls can receive the same update from Telegram.

Mitigation: subscribe to `pi.on("tool_execution_start")` / `"tool_execution_end"` for
`ask_user_questions`. Pause our poll loop while that tool is in flight. Our poller also
skips `reply_to_message` messages (which is how question answers always arrive), so
even if there's a timing gap, we won't act on an answer — but we could advance
`lastUpdateId` past it, causing the existing adapter to miss it. The pause guard closes
that window.

## Remaining open questions (non-blocking)

1. **`pi.sendUserMessage` during auto-mode**: when auto-mode is running, sending a
   message may or may not queue correctly depending on GSD's session state. Needs a
   live test. Fallback for `/stop`: use `stopAutoRemote()` directly (process signals,
   always work regardless of session state).

2. **`deactivate()` export**: GSD's loader does not formally document a `deactivate()`
   hook. Safe fallback: subscribe to `pi.on("session_shutdown", ...)` inside `activate()`
   to stop the loop. Process kill also naturally terminates the loop.
