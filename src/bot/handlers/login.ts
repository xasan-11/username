import type { MyContext } from "../context";
import { BotState } from "../states";
import { setState, setPhone, resetToIdle } from "../../db/userRepo";
import { startLogin, submitCode, submitPassword, cancelPendingLogin } from "../../userbot/manager";
import { describeLoginError } from "../../userbot/errors";
import { cancelOnlyKeyboard, mainMenuKeyboard, phoneRequestKeyboard } from "../keyboards";

function normalizePhone(text: string): string | null {
  const cleaned = text.replace(/[\s\-()]/g, "");
  if (/^\+\d{9,15}$/.test(cleaned)) return cleaned;
  return null;
}

/**
 * Telefon raqam bosqichi: matn yoki kontakt orqali keladi.
 */
export async function handlePhoneInput(ctx: MyContext): Promise<void> {
  const user = ctx.dbUser;
  if (user.state !== BotState.AWAITING_PHONE) return;

  let phone: string | null = null;
  const contact = ctx.message?.contact;
  if (contact?.phone_number) {
    const raw = contact.phone_number;
    phone = raw.startsWith("+") ? raw : `+${raw}`;
  } else if (ctx.message?.text) {
    phone = normalizePhone(ctx.message.text);
  }

  if (!phone) {
    await ctx.reply("❌ Telefon raqam formati noto'g'ri. Masalan: +998901234567", {
      reply_markup: phoneRequestKeyboard(),
    });
    return;
  }

  const waitMsg = await ctx.reply("⏳ Kod yuborilmoqda...");
  try {
    await startLogin(user.telegramId, phone);
    await setPhone(user.telegramId, phone);
    await setState(user.telegramId, BotState.AWAITING_CODE);
    await ctx.reply(
      "📩 Telegram ilovangizga kod keldi. Kodni nuqtalar bilan ajratib yozing (masalan: 1.2.3.4.5).",
      { reply_markup: cancelOnlyKeyboard() }
    );
  } catch (e) {
    await ctx.reply(describeLoginError(e), { reply_markup: phoneRequestKeyboard() });
  } finally {
    await ctx.api.deleteMessage(waitMsg.chat.id, waitMsg.message_id).catch(() => undefined);
  }
}

/**
 * Kod bosqichi: xabar darhol o'chiriladi, faqat raqamlar olinadi.
 */
export async function handleCodeInput(ctx: MyContext): Promise<void> {
  const user = ctx.dbUser;
  if (user.state !== BotState.AWAITING_CODE) return;

  await ctx.deleteMessage().catch(() => undefined);

  const text = ctx.message?.text ?? "";
  const code = text.replace(/\D/g, "");
  if (!code) {
    await ctx.reply("❌ Kodni raqamlar bilan yuboring (masalan: 1.2.3.4.5).");
    return;
  }

  const result = await submitCode(user.telegramId, code);
  if (result.status === "success") {
    await setState(user.telegramId, BotState.IDLE);
    await ctx.reply("✅ Muvaffaqiyatli ulandi!", { reply_markup: mainMenuKeyboard(user.isAdmin) });
  } else if (result.status === "password_needed") {
    await setState(user.telegramId, BotState.AWAITING_PASSWORD);
    await ctx.reply("🔒 Hisobingizda 2 bosqichli parol (2FA) yoqilgan. Parolni kiriting:", {
      reply_markup: cancelOnlyKeyboard(),
    });
  } else {
    await ctx.reply(describeLoginError(result.error), { reply_markup: cancelOnlyKeyboard() });
  }
}

/**
 * 2FA parol bosqichi: xabar darhol o'chiriladi, parol hech qayerda saqlanmaydi/loglanmaydi.
 */
export async function handlePasswordInput(ctx: MyContext): Promise<void> {
  const user = ctx.dbUser;
  if (user.state !== BotState.AWAITING_PASSWORD) return;

  await ctx.deleteMessage().catch(() => undefined);

  const password = ctx.message?.text ?? "";
  if (!password) return;

  const result = await submitPassword(user.telegramId, password);
  if (result.status === "success") {
    await setState(user.telegramId, BotState.IDLE);
    await ctx.reply("✅ Muvaffaqiyatli ulandi!", { reply_markup: mainMenuKeyboard(user.isAdmin) });
  } else if (result.status === "error") {
    await ctx.reply(describeLoginError(result.error), { reply_markup: cancelOnlyKeyboard() });
  }
}

/**
 * "⬅️ Orqaga / Bekor" tugmasi — har qanday bosqichdan menyuga qaytaradi.
 */
export async function handleCancel(ctx: MyContext): Promise<void> {
  const user = ctx.dbUser;

  if (
    user.state === BotState.AWAITING_PHONE ||
    user.state === BotState.AWAITING_CODE ||
    user.state === BotState.AWAITING_PASSWORD
  ) {
    await cancelPendingLogin(user.telegramId);
  }

  await resetToIdle(user.telegramId);

  if (user.encryptedSession) {
    await ctx.reply("Bekor qilindi.", { reply_markup: mainMenuKeyboard(user.isAdmin) });
  } else {
    await setState(user.telegramId, BotState.AWAITING_PHONE);
    await ctx.reply("Bekor qilindi. Qayta ulash uchun telefon raqamingizni yuboring:", {
      reply_markup: phoneRequestKeyboard(),
    });
  }
}
