import { Keyboard, InlineKeyboard } from "grammy";

export const PHONE_REQUEST_LABEL = "📱 Kontakt yuborish";
export const BACK_LABEL = "⬅️ Orqaga / Bekor";

export const MENU_CHANNEL = "📢 Kanal";
export const MENU_GROUP = "👥 Guruh";
export const MENU_SELF = "👤 Urself";
export const MENU_LOGOUT = "🚪 Akauntni uzish";
export const MENU_ADMIN_NEW_USER = "➕ Yangi foydalanuvchi";
export const MENU_ADMIN_USER_LIST = "👥 Foydalanuvchilar ro'yxati";

export function phoneRequestKeyboard() {
  return new Keyboard().requestContact(PHONE_REQUEST_LABEL).row().text(BACK_LABEL).resized();
}

export function cancelOnlyKeyboard() {
  return new Keyboard().text(BACK_LABEL).resized();
}

export function mainMenuKeyboard(isAdmin: boolean) {
  const kb = new Keyboard().text(MENU_CHANNEL).text(MENU_GROUP).row().text(MENU_SELF).row();
  if (isAdmin) {
    kb.text(MENU_ADMIN_NEW_USER).text(MENU_ADMIN_USER_LIST).row();
  }
  kb.text(MENU_LOGOUT);
  return kb.resized();
}

export function resendCodeKeyboard() {
  return new InlineKeyboard().text("📩 Kodni SMS bilan yuborish", "resend_code");
}

export function confirmCancelInlineKeyboard() {
  return new InlineKeyboard().text("✅ Tasdiqlash", "confirm").text("❌ Bekor qilish", "cancel");
}

export function selfUsernameChoiceKeyboard(usernames: string[]) {
  const kb = new InlineKeyboard();
  usernames.forEach((name, idx) => {
    kb.text(`@${name}`, `select:${idx}`).row();
  });
  kb.text("❌ Bekor qilish", "cancel");
  return kb;
}

export function userListInlineKeyboard(users: { telegramId: bigint }[]) {
  const kb = new InlineKeyboard();
  for (const u of users) {
    kb.text(`🗑 ${u.telegramId.toString()}`, `deluser:${u.telegramId.toString()}`).row();
  }
  return kb;
}
