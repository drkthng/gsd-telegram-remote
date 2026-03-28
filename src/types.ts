/**
 * gsd-telegram-remote — shared types
 */

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: unknown;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number; type: string };
  reply_to_message?: { message_id: number };
  text?: string;
  date: number;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

/** Resolved extension configuration. */
export interface RemoteConfig {
  botToken: string;
  chatId: string;
  allowedUserIds: number[];
}

/** Commands the dispatcher understands. */
export type RemoteCommand =
  | { type: "auto" }
  | { type: "stop" }
  | { type: "pause" }
  | { type: "status" }
  | { type: "help" }
  | { type: "unknown"; raw: string };

/** What the dispatcher returns after executing a command. */
export interface DispatchResult {
  reply: string;
  /** Whether GSD auto-mode state changed as a result. */
  stateChanged: boolean;
}
