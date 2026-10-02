import type { MyContext } from "../context";
import { BotState } from "../states";
import { setState, resetToIdle } from "../../db/userRepo";
import { mainMenuKeyboard, phoneRequestKeyboard } from "../keyboards";

export async function handleStart(ctx: MyContext): Promise<void> {
  const user = ctx.dbUser;
  await resetToIdle(user.telegramId);

  if (user.encryptedSession) {
    await ctx.reply("Xush kelibsiz! Kerakli bo'limni tanlang:", {
      reply_markup: mainMenuKeyboard(user.isAdmin),
    });
  } else {
    await setState(user.telegramId, BotState.AWAITING_PHONE);
    await ctx.reply(
      "Xush kelibsiz! Hisobingizni ulash uchun telefon raqamingizni yuboring (+998... formatda) yoki pastdagi tugma orqali kontakt yuboring.",
      { reply_markup: phoneRequestKeyboard() }
    );
  }
}
