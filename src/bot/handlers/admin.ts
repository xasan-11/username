import type { MyContext } from "../context";
import { BotState } from "../states";
import { setState, resetToIdle, setAllowed, deleteUser, listManagedUsers } from "../../db/userRepo";
import { logout } from "../../userbot/manager";
import { cancelOnlyKeyboard, mainMenuKeyboard, userListInlineKeyboard } from "../keyboards";

export async function handleAdminNewUserButton(ctx: MyContext): Promise<void> {
  const user = ctx.dbUser;
  if (!user.isAdmin) return;

  await setState(user.telegramId, BotState.AWAITING_ADMIN_NEW_USER_ID);
  await ctx.reply("Yangi foydalanuvchining Telegram ID raqamini yuboring:", {
    reply_markup: cancelOnlyKeyboard(),
  });
}

export async function handleAdminNewUserIdInput(ctx: MyContext): Promise<void> {
  const user = ctx.dbUser;
  if (user.state !== BotState.AWAITING_ADMIN_NEW_USER_ID) return;

  const text = ctx.message?.text?.trim() ?? "";
  if (!/^\d+$/.test(text)) {
    await ctx.reply("❌ ID faqat raqamlardan iborat bo'lishi kerak. Qaytadan yuboring:", {
      reply_markup: cancelOnlyKeyboard(),
    });
    return;
  }

  const newId = BigInt(text);
  await setAllowed(newId, true);
  await resetToIdle(user.telegramId);
  await ctx.reply(`✅ Foydalanuvchi qo'shildi: ${text}`, {
    reply_markup: mainMenuKeyboard(user.isAdmin),
  });
}

export async function handleAdminUserListButton(ctx: MyContext): Promise<void> {
  const user = ctx.dbUser;
  if (!user.isAdmin) return;

  const users = await listManagedUsers();
  if (users.length === 0) {
    await ctx.reply("Ro'yxat bo'sh.");
    return;
  }

  await ctx.reply("👥 Foydalanuvchilar ro'yxati (o'chirish uchun bosing):", {
    reply_markup: userListInlineKeyboard(users),
  });
}

export async function handleDeleteUserCallback(ctx: MyContext, data: string): Promise<void> {
  const user = ctx.dbUser;
  if (!user.isAdmin) return;

  const idStr = data.split(":")[1];
  if (!idStr || !/^\d+$/.test(idStr)) return;
  const targetId = BigInt(idStr);

  await logout(targetId).catch(() => undefined);
  await deleteUser(targetId);
  await ctx.editMessageText(`🗑 Foydalanuvchi o'chirildi: ${idStr}`).catch(() => undefined);
}
