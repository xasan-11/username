import type { MyContext } from "../context";
import { BotState } from "../states";
import { setState, clearSession, resetToIdle } from "../../db/userRepo";
import { logout } from "../../userbot/manager";
import { phoneRequestKeyboard } from "../keyboards";

export async function handleLogout(ctx: MyContext): Promise<void> {
  const user = ctx.dbUser;
  await ctx.reply("⏳ Hisobdan chiqilmoqda...");

  await logout(user.telegramId);
  await clearSession(user.telegramId);
  await resetToIdle(user.telegramId);
  await setState(user.telegramId, BotState.AWAITING_PHONE);

  await ctx.reply("✅ Hisob uzildi. Qayta ulash uchun telefon raqamingizni yuboring:", {
    reply_markup: phoneRequestKeyboard(),
  });
}
