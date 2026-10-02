/**
 * Foydalanuvchi suhbat holatlari (Prisma'da User.state sifatida saqlanadi).
 */
export enum BotState {
  IDLE = "IDLE",
  AWAITING_PHONE = "AWAITING_PHONE",
  AWAITING_CODE = "AWAITING_CODE",
  AWAITING_PASSWORD = "AWAITING_PASSWORD",
  AWAITING_USERNAMES = "AWAITING_USERNAMES",
  AWAITING_CONFIRM = "AWAITING_CONFIRM",
  AWAITING_ADMIN_NEW_USER_ID = "AWAITING_ADMIN_NEW_USER_ID",
}

export type UsernameMode = "channel" | "group" | "self";

export interface UsernamesStateData {
  mode: UsernameMode;
}

export interface ConfirmStateData {
  mode: UsernameMode;
  freeUsernames: string[];
  selected?: string; // faqat "self" rejimi uchun
}
