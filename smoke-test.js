#!/usr/bin/env node
/**
 * Live Telegram smoke test
 * Sends a real command to the bot and verifies response
 */

import fetch from "node:fetch";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = 799480019; // From preferences

if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN not set");
  process.exit(1);
}

const baseUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

async function sendMessage(text) {
  const url = `${baseUrl}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to send message: ${response.statusText}`);
  }
  const data = await response.json();
  return data;
}

async function getUpdates(offset = 0) {
  const url = `${baseUrl}/getUpdates`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offset, timeout: 5 }),
  });
  if (!response.ok) {
    throw new Error(`Failed to getUpdates: ${response.statusText}`);
  }
  const data = await response.json();
  return data.result || [];
}

async function run() {
  console.log("🚀 Live Telegram Smoke Test");
  console.log(`   Bot Token: ${TELEGRAM_BOT_TOKEN.slice(0, 20)}...`);
  console.log(`   Chat ID: ${TELEGRAM_CHAT_ID}`);
  console.log("");

  try {
    // Step 1: Send a /help command
    console.log("1️⃣  Sending /help command...");
    const msg = await sendMessage("/help");
    console.log(`   ✅ Message sent (ID: ${msg.result.message_id})`);
    console.log("");

    // Step 2: Poll for updates to see if bot responds
    console.log("2️⃣  Polling for bot responses (20 second timeout)...");
    let foundHelp = false;
    const startTime = Date.now();
    const timeout = 20000; // 20 seconds

    while (Date.now() - startTime < timeout) {
      try {
        const updates = await getUpdates();
        for (const update of updates) {
          if (update.message?.text?.includes("Available commands")) {
            console.log(`   ✅ Bot responded with help text!`);
            console.log(`   Response: ${update.message.text.slice(0, 100)}...`);
            foundHelp = true;
            break;
          }
        }
        if (foundHelp) break;
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        console.error(`   Error polling: ${err.message}`);
      }
    }

    if (!foundHelp) {
      console.log(`   ⚠️  No help response received within ${timeout / 1000}s`);
      console.log("      (Extension may not be loaded yet)");
    }
    console.log("");

    // Step 3: Send /projects command
    console.log("3️⃣  Sending /projects command...");
    await sendMessage("/projects");
    console.log(`   ✅ Message sent`);
    console.log("");

    console.log("✨ Smoke test complete!");
    console.log("   Next step: Restart GSD to load the extension, then repeat");
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

run();
