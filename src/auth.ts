/**
 * auth.ts — User ID allowlist validation.
 *
 * Every incoming Telegram update is checked here before any command is
 * dispatched. Unknown users are silently dropped — no reply, which avoids
 * confirming the bot's existence to probers.
 */

export function isAllowedUser(userId: number, allowedUserIds: number[]): boolean {
  return allowedUserIds.includes(userId);
}

/**
 * Extract the sender user ID from a Telegram update.
 * Returns null for updates that have no identifiable sender (e.g. channel posts).
 */
export function getSenderId(message: { from?: { id: number; is_bot: boolean } }): number | null {
  if (!message.from) return null;
  if (message.from.is_bot) return null; // Never process bot messages (inc. our own)
  return message.from.id;
}
