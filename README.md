# gsd-telegram-remote

Remote control your GSD auto-mode from Telegram. Start, stop, pause, and monitor auto-mode execution with instant push notifications on task/slice/milestone completion.

**Status**: M001 complete — core plumbing, full command set, and proactive push notifications.

## Why This Exists

GSD auto-mode enables hands-off milestone execution, but you can't easily control or monitor it from outside the terminal. This extension adds:

- **Remote control**: Start/stop/pause auto-mode from Telegram without SSH or terminal access
- **Visibility**: Check which milestone/slice/task is currently running
- **Proactive updates**: Get pinged when work completes, without polling
- **Multi-project**: Manage multiple GSD projects from one Telegram chat

Designed for developers who want to kick off a long build/test/migration and check back later without opening a terminal.

## Installation

### 1. Clone into GSD extensions directory

```bash
git clone https://github.com/drkthng/gsd-telegram-remote.git ~/.gsd/agent/extensions/gsd-telegram-remote
```

### 2. Install dependencies

```bash
cd ~/.gsd/agent/extensions/gsd-telegram-remote
npm install --legacy-peer-deps  # Required: @gsd/pi-coding-agent is a peerDep not on npm
npm run build
```

The `--legacy-peer-deps` flag is necessary because `@gsd/pi-coding-agent` is a GSD-injected peerDependency not published to the npm registry.

### 3. Configure your Telegram bot

If you haven't already set up `remote-questions`, create a Telegram bot first:

1. Chat with [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot`, choose a name and handle
3. Save the token (format: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)

### 4. Set allowed user IDs

Edit or create `~/.gsd/agent/preferences.md`:

```yaml
telegram_remote:
  allowed_user_ids: [123456789, 987654321]  # Your Telegram user ID(s)
  # Leave blank to disable the extension safely
```

To find your Telegram user ID:
1. Chat with [@userinfobot](https://t.me/userinfobot)
2. It will reply with your numeric ID

### 5. Ensure TELEGRAM_BOT_TOKEN is set

The extension reuses the existing `TELEGRAM_BOT_TOKEN` environment variable from `remote-questions`:

```bash
export TELEGRAM_BOT_TOKEN="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
```

Alternatively, set it in your shell profile or GSD config.

### 6. Restart GSD

```bash
gsd
```

The extension loads automatically on startup. Watch the console for `[telegram-remote] poll loop started` message.

## Usage

Send commands to your Telegram bot from any chat:

### `/auto [project]` — Start auto-mode

```
→ /auto
← 🟢 Auto-mode started on gsd-telegram-remote
← Processing: M001/S01/T01...

→ /auto some-other-project
← 🟢 Auto-mode started on some-other-project
```

If you have multiple GSD projects, specify the project name (folder basename from `~/.gsd/projects/`).

### `/stop [project]` — Stop auto-mode gracefully

```
→ /stop
← ⏹ Auto-mode stopped. Last unit: M001/S01/T02
```

Waits for the current task to finish, then stops. To force-kill, use your terminal.

### `/pause [project]` — Pause auto-mode (resumable)

```
→ /pause
← ⏸ Auto-mode paused at M001/S01/T03. Resume with /auto
```

Resuming with `/auto` continues from where it paused without re-running completed units.

### `/status [project]` — Check current state

```
→ /status
← 🟡 M001/S02/T04 executing... (2m 15s elapsed)
```

Or if idle:

```
→ /status
← ⚪ Auto-mode idle
```

### `/projects` — List all GSD projects

```
→ /projects
← Available projects:
  • gsd-telegram-remote — Control auto-mode from Telegram
  • my-app — Production data processing pipeline
  • research-agent — Experiment runner with auto-mode
```

Shows folder basename (the actual project identifier) and one-line description from each project's `PROJECT.md`.

### `/help` — Show command reference

```
→ /help
← Available commands:
  /auto [project]        Start auto-mode
  /stop [project]        Stop gracefully
  /pause [project]       Pause (resumable)
  /status [project]      Check current task
  /projects              List GSD projects
  /help                  Show this message
```

## How It Works

### Architecture Overview

```
Telegram Bot
    ↓
[Poll Loop] ← getUpdates (long-poll, 30s timeout)
    ↓
[Command Parser] → /auto, /stop, /pause, /status, /projects
    ↓
[Dispatcher] → GSD auto-mode control + file system queries
    ↓
[Responder] → Format result, send Telegram reply
    ↓
[Proactive Notifier] ← Hooks: agent_end events → read STATE.md → send update
```

### Core Modules

| Module | Purpose | GSD-free? |
|--------|---------|-----------|
| `src/auth.ts` | Validate Telegram user ID against allowlist | ✅ Yes |
| `src/config.ts` | Load preferences + env vars | ✅ Yes |
| `src/notifier.ts` | Poll STATE.md and send proactive notifications | ✅ Yes |
| `src/poller.ts` | Long-poll Telegram getUpdates | ✅ Yes |
| `src/dispatcher.ts` | Parse commands + execute actions | ✅ Yes (injectable) |
| `src/responder.ts` | Format + send Telegram messages | ✅ Yes |
| `src/projects.ts` | Scan ~/.gsd/projects, read PROJECT.md | ✅ Yes |
| `src/index.ts` | GSD extension factory, hooks | ❌ No (GSD-only) |

All pure modules are tested independently and can run without GSD installed. The `index.ts` entry point is the only part that depends on GSD's ExtensionAPI.

### State Detection

The extension polls GSD's `.gsd/STATE.md` file to detect:

- Milestone/slice/task transitions
- Auto-mode start/stop/pause events
- Errors and blockers

No database queries; no tight coupling to GSD internals. STATE.md is the source of truth.

### Poll Pause During Questions

When GSD is asking a user a question via `ask_user_questions`, our poller temporarily pauses to avoid advancing the Telegram `lastUpdateId` past the question-answer message. This prevents message loss and ensures question replies are directed to the correct handler.

## Configuration

### Full preferences.md Example

```yaml
telegram_remote:
  # Comma-separated or array of Telegram user IDs allowed to control auto-mode
  allowed_user_ids: [123456789, 987654321]

  # Optional: override which Telegram bot token to use (defaults to TELEGRAM_BOT_TOKEN env var)
  bot_token_env_var: TELEGRAM_BOT_TOKEN

  # Optional: customize message formatting (emoji, text style)
  # Currently uses hardcoded defaults; future enhancement
```

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot API token (required) | None — must be set |
| `GSD_HOME` | Alternate GSD home directory | `~/.gsd` |
| `POLL_TIMEOUT_SECONDS` | Long-poll timeout | `30` |
| `POLL_INTERVAL_MS` | Retry delay on error | `5000` (5s) |

## Workflow: Start to Finish

### Scenario: Kick off a 30-minute milestone

1. **From Telegram**:
   ```
   /auto my-research-project
   ```

2. **Extension**:
   - Validates your user ID is in allowlist ✅
   - Calls GSD's `/gsd auto my-research-project` (same-process)
   - Auto-mode starts, executes M001

3. **You walk away** with your phone or laptop

4. **Extension monitors** `.gsd/STATE.md` for transitions:
   ```
   T01 complete ✅
   → Sends: "✅ T01: Research Data Pipeline complete (2m 30s)"

   S01 complete 🔷
   → Sends: "🔷 S01: Data Collection & Validation complete (15m)"
   ```

5. **You get notified in real-time** without checking the terminal

6. **To pause mid-way**:
   ```
   /pause my-research-project
   ```
   Extension sends signal; auto-mode pauses after current task.

7. **Later, resume**:
   ```
   /auto my-research-project
   ```
   Auto-mode continues from where it paused.

## Testing

### Unit Tests

```bash
npm test
```

Runs 61 tests across 6 suites covering:
- Telegram user ID validation
- Command parsing (case-insensitive, whitespace-tolerant)
- Dispatcher command routing
- Poll loop lifecycle and dispatch integration
- listProjects() with real filesystem fixtures
- Responder message formatting
- Proactive notifier (STATE.md polling, task/slice/milestone events)

All tests are pure-module (no GSD, no network calls).

### Manual Testing with Test Project

A lightweight test project is provided for rapid end-to-end verification:

```bash
cd D:/AiProjects/gsd-test-telegram
gsd auto
# Watch Telegram for notifications as 27 trivial tasks complete in ~30 seconds
```

The test project has 3 milestones × 3 slices × 3 tasks = 27 simple write-one-file tasks, each completing in seconds. Use it to verify the full notification pipeline without a real project.

### Integration Testing

After M003 (proactive notifications), run:

1. Start auto-mode in a real project
2. Watch Telegram for task/slice/milestone notifications
3. Send `/status` — verify it shows correct active unit
4. Send `/stop` — verify auto-mode stops cleanly
5. Send `/pause` then `/auto` — verify it resumes from paused point

## Limitations & Future Work

### M001 Complete
- ✅ `/auto`, `/stop`, `/pause` commands
- ✅ `/status` (basic: idle/running/paused)
- ✅ `/help` and `/projects` commands
- ✅ All core modules tested independently
- ✅ Proactive push notifications on task/slice/milestone completion
- ✅ STATE.md polling with configurable interval
- ✅ Full integration test project at `D:/AiProjects/gsd-test-telegram`

### Future (M002+)
- Rich `/status` showing remaining tasks and ETA
- Cross-process control (different terminal session)
- Project aliases (`/auto strategy` instead of folder name)
- Dashboard web UI (intentionally deferred)
- Webhook-based updates instead of polling (out of scope — added complexity, breaks NAT/firewall cases)

## Troubleshooting

### "No such user: 123456789"

**Problem**: User ID not in `allowed_user_ids` or improperly formatted.

**Solution**:
1. Get your ID from [@userinfobot](https://t.me/userinfobot)
2. Add it to `~/.gsd/agent/preferences.md` as a number (no quotes)
3. Restart GSD

### "TELEGRAM_BOT_TOKEN not set"

**Problem**: Environment variable not exported.

**Solution**:
```bash
export TELEGRAM_BOT_TOKEN="your_token_here"
gsd  # Now restart GSD
```

Or add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.) for persistence.

### "Poll loop failed: timeout waiting for updates"

**Problem**: Normal after idle periods (30s Telegram timeout).

**Solution**: Extension auto-retries. If it happens frequently, check your bot token and network connection.

### Extension doesn't load

**Problem**: Check logs.

**Solution**:
```bash
gsd /gsd logs --grep "telegram-remote"
```

Look for:
- ✅ `[telegram-remote] extension loaded` — extension started
- ✅ `poll loop started` — poller initialized
- ❌ `Error: Cannot find module` — missing dependencies
- ❌ `GSD internals unavailable` — running outside GSD (expected; extension disables gracefully)

## Development

### Project Structure

```
gsd-telegram-remote/
├── src/
│   ├── auth.ts           — Telegram user ID validation
│   ├── config.ts         — Load preferences + env vars
│   ├── notifier.ts        — Proactive push notifications (STATE.md polling)
│   ├── poller.ts         — Long-poll Telegram updates
│   ├── dispatcher.ts      — Command parsing + routing
│   ├── responder.ts       — Format + send messages
│   ├── projects.ts        — List GSD projects
│   ├── types.ts           — Shared TypeScript types
│   └── index.ts           — GSD extension entry point
├── tests/
│   ├── auth.test.ts
│   ├── dispatcher.test.ts
│   ├── notifier.test.ts
│   ├── poller.test.ts
│   ├── poller-dispatch.test.ts
│   ├── projects.test.ts
│   └── __mocks__/@gsd/pi-coding-agent.ts
├── jest.config.js         — Jest + ts-jest ESM config
├── package.json
├── tsconfig.json
├── .gsd/
│   ├── PROJECT.md
│   ├── REQUIREMENTS.md
│   ├── DECISIONS.md
│   ├── KNOWLEDGE.md
│   ├── milestones/M001/ROADMAP.md
│   └── milestones/M001/slices/S01-S04/
└── README.md
```

### Build & Distribution

```bash
# Development (ts-node, no build)
node --loader ts-node/esm src/index.ts

# Production (compile to dist/)
npm run build

# The extension loads from ~/.gsd/agent/extensions/gsd-telegram-remote/
# GSD uses jiti to JIT the .ts files directly; no build step required
```

### Adding a New Command

1. Update `src/types.ts` — add to `RemoteCommand` union:
   ```typescript
   | { type: "restart"; project?: string }
   ```

2. Update `src/dispatcher.ts`:
   - Add case in `parseCommand()`: `clean === '/restart'`
   - Add case in `executeCommand()` with implementation
   - Register injectable if needed: `injectRestartHandler(fn)`

3. Write tests in `tests/dispatcher.test.ts`

4. Update `/help` message in dispatcher

5. Run `npm test` to verify

### Running Tests Locally

```bash
# All tests
npm test

# Watch mode
npm test -- --watch

# Specific test file
npm test -- projects.test.ts

# With coverage
npm test -- --coverage
```

## Contributing

Contributions welcome. Start by:

1. Fork this repo
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Write tests first (TDD)
4. Update README if behavior changes
5. Submit PR

## License

MIT — See LICENSE file

## Support & Community

- **Issues**: [GitHub Issues](https://github.com/drkthng/gsd-telegram-remote/issues)
- **Discussions**: [GitHub Discussions](https://github.com/drkthng/gsd-telegram-remote/discussions)
- **GSD Community**: [GSD Docs](https://gsd-build.github.io)

---

**Built with ❤️ for makers who want their builds to work in the background.**
