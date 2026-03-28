# ROADMAP — gsd-telegram-remote

## What we're building

A GSD extension that lets you send `/auto`, `/stop`, `/pause`, `/status` to your
existing Telegram bot and have them take effect in GSD. Installs into
`~/.gsd/agent/extensions/gsd-telegram-remote/` — no code changes to GSD itself.

---

## Confirmed facts (from source research)

| Question | Answer |
|---|---|
| Extension factory signature | `(pi: ExtensionAPI) => void \| Promise<void>` — single arg, no `ctx` |
| How to trigger GSD commands | `pi.sendUserMessage("/gsd auto")` — routes through same path as typing |
| How to read auto-mode state | Dynamic import `../gsd/auto.js` → `isAutoActive()`, `isAutoPaused()` |
| How to load GSD preferences | Dynamic import `../gsd/preferences.js` → `loadEffectiveGSDPreferences()` |
| How to get bot token/chat ID | Dynamic import `../remote-questions/config.js` → `resolveRemoteConfig()` |
| Import mechanism | `importExtensionModule(import.meta.url, "../gsd/auto.js")` — URL-relative |
| Resolved paths (from `~/.gsd/agent/extensions/gsd-telegram-remote/`) | `../gsd/auto.js` ✓, `../gsd/preferences.js` ✓, `../remote-questions/config.js` ✓ |
| All three target files exist | Verified on disk |
| `@gsd/pi-coding-agent` available to extensions | Yes — virtual module, always available |
| `importExtensionModule` exported from it | Yes — confirmed in index.d.ts |
| Extension loading: TS or JS | jiti handles both; prefers sibling `.js` if mtime ≥ `.ts` |
| Extension discovery | `index.js` or `index.ts` in `~/.gsd/agent/extensions/<name>/` |
| Install path | Manually copy to `~/.gsd/agent/extensions/gsd-telegram-remote/` |
| `pi.on("tool_execution_start", ...)` available | Yes — typed on ExtensionAPI |

### The poll-loop conflict (resolved)

`TelegramAdapter.pollAnswer()` only runs while `ask_user_questions` is actively
waiting. Our poller runs continuously. If both call `getUpdates` simultaneously,
Telegram **can** return the same update to both callers.

**Risk**: our poller advances `lastUpdateId` past a question-answer message before
`TelegramAdapter` sees it → the user's question times out.

**Mitigation built into M1**: subscribe to `tool_execution_start` /
`tool_execution_end` for `ask_user_questions`. Pause our poll loop while that tool is
in flight. Gap is ≤ one poll cycle (30s worst case with long-poll). This is safe
because question answers always arrive as `reply_to_message` (which our poller already
skips), but the offset-advancement risk is real and worth guarding against.

---

## Milestones

### M1 — Working extension, same-process (this repo)

**Goal**: drop a folder into `~/.gsd/agent/extensions/`, restart GSD, send `/auto` from
Telegram, auto-mode starts. AND receive proactive push notifications for every
meaningful auto-mode event.

**Important context**: GSD's built-in `sendRemoteNotification()` is never called from
auto-mode. The only Telegram messages currently sent are `ask_user_questions` prompts.
This extension adds all the push notifications the user expects.

**Slices**:

- **S01 — Core plumbing** (no GSD dependency)
  - `types.ts`, `auth.ts`, `responder.ts`: pure functions, fully testable in isolation
  - `dispatcher.ts`: `parseCommand()` + `executeCommand()` using stored `pi`
  - Unit tests pass: `npm test`

- **S02 — Poll loop with conflict guard**
  - `poller.ts`: `PollLoop` class with `pause()` / `resume()` / `notify()` methods
  - `index.ts`: subscribe to `tool_execution_start` / `tool_execution_end` to
    pause/resume the loop around `ask_user_questions` calls
  - Dynamic imports with `.catch(() => null)` fallbacks for all GSD internal modules
  - Manual install test: copy to `~/.gsd/agent/extensions/gsd-telegram-remote/`,
    restart GSD, send `/help` from Telegram → get reply

- **S03 — Proactive push notifications**
  - Hook `agent_end` to read STATE.md via `deriveState()` and detect transitions:
    task complete, slice complete, milestone complete, blocked
  - Hook `agent_end` + `isAutoActive()`/`isAutoPaused()` to detect paused/stopped
  - Messages: `✅ Task T01 complete`, `🔷 Slice S01 complete`, `🏁 Milestone M001 complete!`,
    `⏸️ Auto-mode paused`, `⏹️ Auto-mode stopped`, `🚫 Blocked: <reason>`
  - Clean shutdown via `session_shutdown` event

- **S04 — Configuration & preferences**
  - `config.ts`: read `telegram_remote.allowed_user_ids` from GSD preferences
  - Setup instructions: add `telegram_remote:` block to `~/.gsd/agent/preferences.md`
  - End-to-end test: `/auto` starts auto-mode, `/status` returns correct state,
    `/stop` stops it, milestone completion sends push notification

**Definition of done**:
- `/help`, `/status`, `/auto`, `/stop`, `/pause` all work from Telegram
- Push notifications fire for task/slice/milestone complete, paused, stopped, blocked
- No question-answer interference (tested: send `/status` while GSD is mid-question)
- `npm test` passes
- README has accurate setup instructions

---

### M2 — Build pipeline & clean install

**Goal**: `npm run build` produces `dist/index.js` that GSD loads via native `import()`
(faster than jiti JIT). Documented install steps.

**Slices**:

- **S01 — TypeScript build**
  - `tsconfig.json` targets `NodeNext`, outputs to `dist/`
  - `package.json` has `"main": "dist/index.js"`
  - Extension discovery finds `dist/index.js` and loads it
  - Startup notification appears in GSD terminal

- **S02 — Install UX**
  - `scripts/install.sh` (and `.ps1` for Windows): copies `dist/` +
    `extension-manifest.json` to `~/.gsd/agent/extensions/gsd-telegram-remote/`
  - README: step-by-step setup (bot token already configured → add `allowed_user_ids`
    → copy files → restart GSD)

**Definition of done**:
- `npm run build && npm run install-ext` works in one shot
- GSD loads the compiled extension at startup with no jiti compilation step

---

### M3 — Rich status & notifications

**Goal**: `/status` returns useful information (not just idle/running/paused), and key
auto-mode events proactively push to Telegram without the user asking.

**Slices**:

- **S01 — Rich /status**
  - Read `STATE.md` from disk (no GSD API needed — it's a plain file)
  - Parse: active milestone, active slice/task, phase
  - `/status` reply: `🟢 Running — M003 / S02 / T04 (execute-task)`

- **S02 — Proactive push notifications**
  - Subscribe to `agent_end` events; after each unit completes, read STATE.md and
    detect transitions (task done, slice done, milestone done)
  - Push a Telegram message for milestone completions and auto-mode stops/pauses
  - This replaces/complements the existing one-way `sendRemoteNotification()` with
    richer context

**Definition of done**:
- `/status` shows milestone/slice/task
- Telegram message sent when milestone completes, when auto-mode pauses, when it stops

---

### M4 — Cross-process control (future / optional)

**Goal**: control auto-mode from Telegram even when a **different** GSD terminal
session started it (or when GSD is closed and you want to restart it remotely).

This is the hardest milestone and may not be needed if M1 covers the typical workflow
(you start GSD, leave it running, control via Telegram).

**Approach**: file-based trigger (`.gsd/remote-trigger`). The active GSD session's
auto-loop polls for this file in its pre-dispatch phase and acts on it. The extension
writes the trigger; the running GSD instance picks it up.

Alternatively: `stopAutoRemote()` already uses process signals. A similar
`startAutoRemote()` could be added to GSD proper — but that requires a GSD code change.

**Status**: deferred. M1–M3 cover 95% of the real use case.

---

## Open questions (none blocking M1)

1. **`session_shutdown` event firing on extension deactivate**: the `deactivate()`
   export pattern is conventional but not confirmed in GSD's loader. Fallback: subscribe
   to `pi.on("session_shutdown", ...)` inside `activate()` to trigger loop stop.
   Either way, the loop naturally exits on process kill.

2. **`pi.sendUserMessage` during auto-mode**: when auto-mode is running, the session
   is in a specific state. Sending a user message via `sendUserMessage` may or may not
   queue correctly. Testing will confirm. Fallback: `stopAutoRemote()` for `/stop` at
   least (it uses process signals, which always work).
