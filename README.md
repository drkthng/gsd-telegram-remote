# gsd-telegram-remote

A GSD extension that lets you control auto-mode from Telegram.

## What it does

When GSD auto-mode is running on your machine, you can send commands to your Telegram bot
to start, stop, pause, resume, and check status — without touching the terminal.

```
You → Telegram bot → gsd-telegram-remote extension → GSD auto-mode
                                ↓
                       Sends confirmations back to Telegram
```

Notifications already work in the other direction (GSD → you) via the built-in
`remote-questions` extension. This project adds the missing return path.

## Commands (once installed)

| Telegram message  | Action                                        |
|-------------------|-----------------------------------------------|
| `/auto`           | Start or resume auto-mode                     |
| `/stop`           | Stop auto-mode gracefully                     |
| `/pause`          | Pause auto-mode (resumable)                   |
| `/status`         | Reply with current auto-mode state            |
| `/help`           | List available commands                       |

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

## Setup

1. You need an existing GSD + Telegram bot configured (`/gsd remote telegram`)
2. Copy `dist/gsd-telegram-remote.js` to `~/.gsd/agent/extensions/gsd-telegram-remote/`
3. Copy `extension-manifest.json` to the same directory
4. Restart GSD

## Security

The extension validates every incoming message against a configured allowlist of
Telegram user IDs. Messages from any other user are silently ignored. See
`ARCHITECTURE.md#security` for the threat model.

## Development

```bash
npm install
npm run build
npm test
```
