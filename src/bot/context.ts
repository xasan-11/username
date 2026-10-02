import type { Context } from "grammy";
import type { User } from "@prisma/client";

/**
 * Har bir yangilanishda authMiddleware tomonidan to'ldiriladigan
 * maxsus kontekst — joriy foydalanuvchining bazadagi yozuvini saqlaydi.
 */
export interface MyContext extends Context {
  dbUser: User;
}
