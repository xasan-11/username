import type { NextFunction } from "grammy";
import type { MyContext } from "../context";
import { env } from "../../utils/env";
import { getOrCreateUser } from "../../db/userRepo";

/**
 * Har bir yangilanishda ishga tushadi: foydalanuvchini bazadan topadi/yaratadi
 * va ctx.dbUser ga joylaydi. Ruxsati yo'q foydalanuvchilar uchun to'xtatiladi.
 */
export async function authMiddleware(ctx: MyContext, next: NextFunction): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId === undefined) return;

  const user = await getOrCreateUser(BigInt(telegramId), env.ADMIN_ID);
  if (!user.allowed) {
    await ctx.reply("🚫 Sizda ruxsat yo'q.").catch(() => undefined);
    return;
  }

  ctx.dbUser = user;
  await next();
}
