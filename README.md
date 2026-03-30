# gsd-telegram-remote

Remote control your GSD auto-mode from Telegram. Start, stop, pause, and monitor auto-mode execution with instant push notifications on task/slice/milestone completion.

**Status**: M001–M004 complete — rich `[project] M/S/T` path notifications, budget alerts, live transport validated. 99 tests, 7 suites.

## Why This Exists

GSD auto-mode enables hands-off milestone execution, but you can't easily control or monitor it from outside the terminal. This extension adds:

- **Remote control**: Start/stop/pause auto-mode from Telegram without SSH or terminal access
- **Visibility**: Check which milestone/slice/task is currently running
- **Proactive updates**: Get pinged when work completes, without polling — every notification prefixed with `[project-name]` for multi-project clarity
- **Budget alerts**: Warnings at 75%/80%/90%/100% of configured budget ceiling
- **Multi-project**: Manage multiple GSD projects from one Telegram chat

Designed for developers who want to kick off a long build/test/migration and check back later without opening a terminal.

## Installation

### 1. Clone and build

```bash
cd D:\AiProjects  # or wherever you keep projects
git clone https://github.com/drkthng/gsd-telegram-remote.git
cd gsd-telegram-remote
npm install --legacy-peer-deps
npm run install-ext   # builds + copies to ~/.pi/agent/extensions/
```

The `--legacy-peer-deps` flag is necessary because `@gsd/pi-coding-agent` is a GSD-injected peerDependency not published to the npm registry.

### 2. Configure your Telegram bot

If you haven't already set up `remote-questions`, create a Telegram bot first:

1. Chat with [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot`, choose a name and handle
3. Save the token via `/gsd remote telegram` in GSD (stores it in GSD's auth.json)

### 3. Set allowed user IDs

Add to `~/.gsd/preferences.md` (inside the YAML frontmatter):

```yaml
telegram_remote:
  enabled: true
  allowed_user_ids: [123456789]  # Your Telegram user ID(s)
```

To find your Telegram user ID: chat with [@userinfobot](https://t.me/userinfobot).

### 4. Restart GSD

```bash
gsd
```

Watch for:
```
[gsd-telegram-remote] activating for project: my-project, chatId: 123456789, allowedUsers: 123456789
[gsd-telegram-remote] Telegram remote control active.
```

## Usage

Send commands to your Telegram bot:

| Command | Action |
|---------|--------|
| `/auto` | Start or resume auto-mode |
| `/stop` | Stop auto-mode gracefully |
| `/pause` | Pause auto-mode (resumable with `/auto`) |
| `/status` | Show current milestone/slice/task and phase |
| `/projects` | List all GSD projects |
| `/help` | Show available commands |

## Notifications

Every auto-mode event sends a notification prefixed with the project name:

```
[gsd-telegram-remote] ✅ Task M001/S01/T01 complete
[gsd-telegram-remote] 🔷 Slice M001/S01 complete
[gsd-telegram-remote] 🏁 Milestone M001 complete!
[gsd-telegram-remote] ⏸️ Auto-mode paused — send /auto to resume.
[gsd-telegram-remote] ⏹️ Auto-mode stopped.
[gsd-telegram-remote] 🚫 Blocked: missing API key
[gsd-telegram-remote] ⚠️ Budget 80%: $4.00 / $5.00
```

### Budget Alerts

Configure a ceiling in `~/.gsd/preferences.md`:

```yaml
budget_ceiling: 5.00   # USD
```

Alerts fire at 75%, 80%, 90%, and 100% — each threshold once per session. Uses `⚠️` for warnings, `🚨` for 100%.

### User Interaction via Telegram

When the agent calls `ask_user_questions` during auto-mode (e.g., UAT acceptance, ambiguous task choices), the question is automatically routed to your Telegram chat via GSD's `remote-questions` extension. You answer in Telegram, and the agent continues. Our poll loop pauses during this to avoid message conflicts.

## How It Works

```
Telegram Bot API
    ↓ getUpdates (30s long-poll)
[Poll Loop] → [Auth] → [Dispatcher] → pi.sendUserMessage("/gsd auto")
                                      → sendReply(status/help/projects)

[agent_end hook] → deriveState() → computeNotifications(prev, curr) → loop.notify()
                                  → computeBudgetAlert(prevLevel, cost, ceiling) → loop.notify()
```

### Core Modules

| Module | Purpose |
|--------|---------|
| `src/index.ts` | Extension entry point — `activate()`, event hooks, notification dispatch |
| `src/config.ts` | Config from preferences.md + AuthStorage + env vars |
| `src/dispatcher.ts` | Command parsing and routing (all 6 commands) |
| `src/notifier.ts` | Pure state-transition notification logic — `computeNotifications()`, `computeBudgetAlert()` |
| `src/poller.ts` | Telegram long-poll loop with pause/resume/notify |
| `src/projects.ts` | Scan ~/.gsd/projects/ for project listing |
| `src/auth.ts` | User ID allowlist validation |
| `src/responder.ts` | Telegram sendMessage wrapper |

### Key Design Decisions

- **No cross-extension imports**: Config reads preferences.md directly and hydrates `TELEGRAM_BOT_TOKEN` from GSD's AuthStorage. The `remote-questions` module is TypeScript-only and unreachable from compiled extensions via `importExtensionModule`.
- **`importExtensionModule` specifiers use `.ts`**: GSD extensions are source `.ts` files loaded by jiti, not compiled `.js`. The path from `dist/index.js` is `../../gsd/*.ts`.
- **`telegram_remote` prefs parsed from raw YAML**: GSD's preferences validator strips unknown keys. Our extension reads its own config block directly from the preferences.md frontmatter.
- **Pure notification logic**: `computeNotifications()` and `computeBudgetAlert()` are side-effect-free functions tested without mocking GSD runtime.

## Testing

```bash
npm test          # 99 tests, 7 suites
npm run build     # TypeScript compile check
npm run install-ext  # Build + install to ~/.pi/agent/extensions/
```

### Test Projects

Two lightweight test projects for rapid end-to-end validation:

```bash
# Project 1 — notifications show as [gsd-test-telegram]
cd D:\AiProjects\gsd-test-telegram
gsd    # then /gsd auto

# Project 2 — notifications show as [gsd-test-telegram-2]
cd D:\AiProjects\gsd-test-telegram-2
gsd    # then /gsd auto
```

Each has M004 with 2 slices × 3 tasks. S01 tests notification flow (trivial tasks). S02 tests remote interaction (T02 asks the user a question via Telegram).

## Requirements

- Node.js 20+
- GSD with `remote-questions` Telegram bot configured
- `telegram_remote.allowed_user_ids` set in preferences.md

## Milestone History

- [x] **M001**: Same-process command control — 6 commands, notifications, poll loop
- [x] **M002**: Build pipeline — `npm run install-ext` produces loadable `dist/index.js`
- [x] **M003**: Rich `/status` — returns `🟢 M001/S02/T01 (executing)` with milestone/slice/task detail
- [x] **M004**: Rich notifications + budget alerts — `[project] M/S/T` path format, threshold alerts at 75/80/90/100%

## License

MIT
