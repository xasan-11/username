import type { MyContext } from "../context";
import { BotState, type LoginStateData } from "../states";
import { setState, getStateData, resetToIdle } from "../../db/userRepo";
import {
  startLogin,
  submitCode,
  submitPassword,
  resendCode,
  cancelPendingLogin,
  LOGIN_TIMEOUT_MS,
} from "../../userbot/manager";
import { describeLoginError, isRecoverableLoginError } from "../../userbot/errors";
import { getFloodWaitSeconds } from "../../userbot/floodWait";
import { describeCodeDeliveryType } from "../../userbot/sentCode";
import {
  cancelOnlyKeyboard,
  mainMenuKeyboard,
  phoneRequestKeyboard,
  resendCodeKeyboard,
} from "../keyboards";

const RESEND_THROTTLE_MS = 60 * 1000;

function normalizePhone(text: string): string | null {
  const cleaned = text.replace(/[\s\-()]/g, "");
  if (/^\+\d{9,15}$/.test(cleaned)) return cleaned;
  return null;
}

async function backToPhoneStep(ctx: MyContext, telegramId: bigint, prefixMessage?: string): Promise<void> {
  await cancelPendingLogin(telegramId);
  await setState(telegramId, BotState.AWAITING_PHONE);
  const text = prefixMessage
    ? `${prefixMessage}\n\nTelefon raqamingizni qaytadan yuboring:`
    : "Telefon raqamingizni qaytadan yuboring:";
  await ctx.reply(text, { reply_markup: phoneRequestKeyboard() });
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

  try {
    const result = await startLogin(user.telegramId, phone);

    if (result.status === "already_authorized") {
      await setState(user.telegramId, BotState.IDLE);
      await ctx.reply("✅ Muvaffaqiyatli ulandi!", { reply_markup: mainMenuKeyboard(user.isAdmin) });
      return;
    }

    const now = Date.now();
    const loginData: LoginStateData = {
      phone,
      codeType: result.info.codeType,
      createdAt: now,
      lastSentAt: now,
    };
    await setState(user.telegramId, BotState.AWAITING_CODE, loginData);

    await ctx.reply(
      `${describeCodeDeliveryType(result.info.codeType)}\n\nKodni nuqtalar bilan ajratib yozing (masalan: 1.2.3.4.5).`,
      { reply_markup: resendCodeKeyboard() }
    );
  } catch (e) {
    await ctx.reply(describeLoginError(e), { reply_markup: phoneRequestKeyboard() });
  }
}

/**
 * Kod bosqichi: xabar darhol o'chiriladi, faqat raqamlar olinadi.
 */
export async function handleCodeInput(ctx: MyContext): Promise<void> {
  const user = ctx.dbUser;
  if (user.state !== BotState.AWAITING_CODE) return;

  await ctx.deleteMessage().catch(() => undefined);

  const loginData = getStateData<LoginStateData>(user);
  if (!loginData) {
    await backToPhoneStep(ctx, user.telegramId, "❌ Sessiya topilmadi.");
    return;
  }

  if (Date.now() - loginData.createdAt > LOGIN_TIMEOUT_MS) {
    await backToPhoneStep(ctx, user.telegramId, "⏰ Kod kiritish vaqti tugadi (5 daqiqa).");
    return;
  }

  const text = ctx.message?.text ?? "";
  const code = text.replace(/\D/g, "");
  if (!code) {
    await ctx.reply("❌ Kodni raqamlar bilan yuboring (masalan: 1.2.3.4.5).", {
      reply_markup: resendCodeKeyboard(),
    });
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
  } else if (isRecoverableLoginError(result.error)) {
    await ctx.reply(describeLoginError(result.error), { reply_markup: resendCodeKeyboard() });
  } else {
    await backToPhoneStep(ctx, user.telegramId, describeLoginError(result.error));
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
    if (isRecoverableLoginError(result.error)) {
      await ctx.reply(describeLoginError(result.error), { reply_markup: cancelOnlyKeyboard() });
    } else {
      await backToPhoneStep(ctx, user.telegramId, describeLoginError(result.error));
    }
  }
}

/**
 * "📩 Kodni SMS bilan yuborish" inline tugmasi.
 */
export async function handleResendCode(ctx: MyContext): Promise<void> {
  const user = ctx.dbUser;
  if (user.state !== BotState.AWAITING_CODE) {
    await ctx.answerCallbackQuery({ text: "Bu amal endi mavjud emas." }).catch(() => undefined);
    return;
  }

  const loginData = getStateData<LoginStateData>(user);
  if (!loginData) {
    await ctx.answerCallbackQuery({ text: "Sessiya topilmadi, /start bosing." }).catch(() => undefined);
    return;
  }

  const elapsed = Date.now() - loginData.lastSentAt;
  if (elapsed < RESEND_THROTTLE_MS) {
    const remaining = Math.ceil((RESEND_THROTTLE_MS - elapsed) / 1000);
    await ctx
      .answerCallbackQuery({ text: `⏳ Yana ${remaining} soniyadan keyin urinib ko'ring.`, show_alert: true })
      .catch(() => undefined);
    return;
  }

  const result = await resendCode(user.telegramId);

  if (result.status === "already_authorized") {
    await setState(user.telegramId, BotState.IDLE);
    await ctx.answerCallbackQuery().catch(() => undefined);
    await ctx.reply("✅ Muvaffaqiyatli ulandi!", { reply_markup: mainMenuKeyboard(user.isAdmin) });
    return;
  }

  if (result.status === "code_sent") {
    const now = Date.now();
    const updated: LoginStateData = {
      ...loginData,
      codeType: result.info.codeType,
      createdAt: now,
      lastSentAt: now,
    };
    await setState(user.telegramId, BotState.AWAITING_CODE, updated);
    await ctx.answerCallbackQuery({ text: "Kod qayta yuborildi." }).catch(() => undefined);
    await ctx.reply(
      `${describeCodeDeliveryType(result.info.codeType)}\n\nKodni nuqtalar bilan ajratib yozing (masalan: 1.2.3.4.5).`,
      { reply_markup: resendCodeKeyboard() }
    );
    return;
  }

  // result.status === "error"
  const waitSeconds = getFloodWaitSeconds(result.error);
  if (waitSeconds !== null) {
    await setState(user.telegramId, BotState.AWAITING_CODE, { ...loginData, lastSentAt: Date.now() });
    await ctx
      .answerCallbackQuery({ text: `⏳ Flood limit: ${waitSeconds} soniya kutish kerak.`, show_alert: true })
      .catch(() => undefined);
    return;
  }

  if (isRecoverableLoginError(result.error)) {
    await ctx
      .answerCallbackQuery({ text: describeLoginError(result.error), show_alert: true })
      .catch(() => undefined);
    return;
  }

  await ctx.answerCallbackQuery().catch(() => undefined);
  await backToPhoneStep(ctx, user.telegramId, describeLoginError(result.error));
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
