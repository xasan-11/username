import { Bot } from "grammy";
import type { MyContext } from "./context";
import { env } from "../utils/env";
import { logger } from "../utils/logger";
import { authMiddleware } from "./middleware/auth";
import { BotState } from "./states";
import {
  MENU_CHANNEL,
  MENU_GROUP,
  MENU_SELF,
  MENU_LOGOUT,
  MENU_ADMIN_NEW_USER,
  MENU_ADMIN_USER_LIST,
  BACK_LABEL,
} from "./keyboards";

import { handleStart } from "./handlers/start";
import { handlePhoneInput, handleCodeInput, handlePasswordInput, handleCancel } from "./handlers/login";
import { handleLogout } from "./handlers/logout";
import { handleModeEntry, handleUsernamesInput, handleMenuCallbackQuery } from "./handlers/menu";
import {
  handleAdminNewUserButton,
  handleAdminNewUserIdInput,
  handleAdminUserListButton,
  handleDeleteUserCallback,
} from "./handlers/admin";

export function createBot(): Bot<MyContext> {
  const bot = new Bot<MyContext>(env.BOT_TOKEN);

  bot.use(authMiddleware);

  bot.command("start", handleStart);

  // Asosiy menyu tugmalari
  bot.hears(MENU_CHANNEL, (ctx) => handleModeEntry(ctx, "channel"));
  bot.hears(MENU_GROUP, (ctx) => handleModeEntry(ctx, "group"));
  bot.hears(MENU_SELF, (ctx) => handleModeEntry(ctx, "self"));
  bot.hears(MENU_LOGOUT, handleLogout);
  bot.hears(MENU_ADMIN_NEW_USER, handleAdminNewUserButton);
  bot.hears(MENU_ADMIN_USER_LIST, handleAdminUserListButton);
  bot.hears(BACK_LABEL, handleCancel);

  // Kontakt orqali telefon raqam
  bot.on("message:contact", handlePhoneInput);

  // Holatga qarab matnli xabarlarni yo'naltirish
  bot.on("message:text", async (ctx) => {
    switch (ctx.dbUser.state) {
      case BotState.AWAITING_PHONE:
        return handlePhoneInput(ctx);
      case BotState.AWAITING_CODE:
        return handleCodeInput(ctx);
      case BotState.AWAITING_PASSWORD:
        return handlePasswordInput(ctx);
      case BotState.AWAITING_USERNAMES:
        return handleUsernamesInput(ctx);
      case BotState.AWAITING_ADMIN_NEW_USER_ID:
        return handleAdminNewUserIdInput(ctx);
      default:
        return; // IDLE / AWAITING_CONFIRM — matnni e'tiborsiz qoldiramiz
    }
  });

  // Inline tugmalar (Tasdiqlash / Bekor qilish / tanlash / foydalanuvchi o'chirish)
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery().catch(() => undefined);

    if (data.startsWith("deluser:")) {
      return handleDeleteUserCallback(ctx, data);
    }
    return handleMenuCallbackQuery(ctx);
  });

  bot.catch((err) => {
    logger.error("Bot xatoligi", { error: err.message, update: err.ctx.update.update_id });
  });

  return bot;
}
