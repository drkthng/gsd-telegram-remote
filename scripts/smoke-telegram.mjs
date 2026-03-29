#!/usr/bin/env node
/**
 * smoke-telegram.mjs — Live transport smoke test for gsd-telegram-remote.
 *
 * Sends 4 representative Telegram notifications (task, slice, milestone, budget alert)
 * via the real Bot API to prove end-to-end transport with the M004 rich path format.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=<token> TELEGRAM_CHAT_ID=<chat_id> node scripts/smoke-telegram.mjs
 *
 * If TELEGRAM_CHAT_ID is not set, falls back to the preferences.md channel_id (799480019).
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '799480019';

if (!TOKEN) {
  console.error('[smoke] ERROR: TELEGRAM_BOT_TOKEN is not set. Export it before running.');
  process.exit(1);
}

if (!CHAT_ID) {
  console.error('[smoke] ERROR: TELEGRAM_CHAT_ID is not set (and no fallback available).');
  process.exit(1);
}

const API_BASE = `https://api.telegram.org/bot${TOKEN}`;

/**
 * Send a single HTML-formatted message to the configured chat.
 */
async function sendMessage(text) {
  const url = `${API_BASE}/sendMessage`;
  const body = JSON.stringify({
    chat_id: CHAT_ID,
    text,
    parse_mode: 'HTML',
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  const json = await res.json();
  return json;
}

// Representative messages matching M004 rich-path format
const messages = [
  { label: 'task',      text: '✅ Task <b>M004/S01/T01</b> complete' },
  { label: 'slice',     text: '🔷 Slice <b>M004/S01</b> complete' },
  { label: 'milestone', text: '🏁 Milestone <b>M004</b> complete!' },
  { label: 'budget',    text: '⚠️ Budget 80%: $4.00 / $5.00' },
];

let successCount = 0;

for (const { label, text } of messages) {
  try {
    const result = await sendMessage(text);
    const okFlag = result.ok ? '"ok":true' : '"ok":false';
    console.log(`[smoke] ${label}: ${okFlag} — ${JSON.stringify(result).slice(0, 120)}`);
    if (result.ok) successCount++;
  } catch (err) {
    console.error(`[smoke] ${label}: ERROR — ${err.message}`);
  }
}

console.log(`[smoke] Done: ${successCount}/${messages.length} messages sent successfully.`);

if (successCount < messages.length) {
  process.exit(1);
}
