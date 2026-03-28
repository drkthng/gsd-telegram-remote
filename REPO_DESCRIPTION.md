# gsd-telegram-remote — Remote Control GSD Auto-Mode from Telegram

Control GSD's auto-mode from Telegram. Send `/auto` to start auto-mode, `/stop` to pause, `/status` to check progress, and `/projects` to list available GSD projects. Receive proactive push notifications when tasks, slices, and milestones complete.

## What It Does

- **Remote command execution**: `/auto`, `/stop`, `/pause`, `/status`, `/help`, `/projects`
- **Proactive notifications**: Automatic Telegram messages on task ✅, slice 🔷, and milestone 🏁 completion
- **Multi-project support**: List all GSD projects and control them from Telegram
- **Long-polling architecture**: Works behind NAT/firewalls (no public HTTPS endpoint needed)
- **Zero setup**: Reuses existing Telegram bot token from `remote-questions` extension

## Installation

1. Clone into GSD extensions directory:
   ```bash
   git clone https://github.com/drkthng/gsd-telegram-remote.git ~/.gsd/agent/extensions/gsd-telegram-remote
   ```

2. Install dependencies:
   ```bash
   cd ~/.gsd/agent/extensions/gsd-telegram-remote
   npm install --legacy-peer-deps
   npm run build
   ```

3. Configure allowed users in `~/.gsd/agent/preferences.md`:
   ```yaml
   telegram_remote:
     allowed_user_ids: [123456789, 987654321]  # Your Telegram user IDs
   ```

4. Restart GSD. Extension loads automatically.

## Usage

From any Telegram chat with your bot:

```
/auto [project]           Start auto-mode on a project
/stop [project]           Stop auto-mode gracefully
/pause [project]          Pause auto-mode (resumable)
/status [project]         Check running milestone/slice/task
/projects                 List all available GSD projects
/help                     Show available commands
```

Example:
```
→ /auto gsd-telegram-remote
← 🟢 Auto-mode started: M001/S01
← ✅ T01 complete
← 🔷 S01 complete
← 🏁 M001 complete
```

## Architecture

- **Pure modules (S01)**: Auth, config, dispatcher, poller, responder, projects — no GSD dependency
- **Poll loop + dispatcher (S02)**: Integration with GSD auto-mode state, real-time command processing
- **Proactive notifications (S03)**: Event hooks for task/slice/milestone completion
- **Build & polish (S04)**: Production distribution, README, test project

## Requirements & Status

| ID | Capability | Status | Slice |
|---|---|---|---|
| R001 | `/auto` command | ✅ complete | S02 |
| R002 | `/stop` and `/pause` | ✅ complete | S02 |
| R003 | `/status` with current task | ✅ complete | S02 |
| R004 | `/help` command list | ✅ complete | S02 |
| R005 | `/projects` command | ✅ complete | S01 |
| R006 | User ID allowlist | ✅ complete | S01 |
| R007 | Poll pause during questions | ✅ complete | S02 |
| R008 | Graceful fallback outside GSD | ✅ complete | S01 |
| R009 | Proactive notifications | ✅ complete | S03 |
| R010 | Rich `/status` (M3 only) | 🔄 deferred | M003 |

## Quick Start Test

Use the bundled test project for rapid iteration:

```bash
cd D:/AiProjects/gsd-test-telegram
gsd auto
# Watch Telegram for notifications as tasks complete (30 seconds total)
```

## Requirements

- Node.js 20+
- Telegram bot token (from existing `remote-questions` setup)
- GSD 2.58.0+
- User ID allowlist in preferences

## License

MIT
