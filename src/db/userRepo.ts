import { prisma } from "./client";
import { encrypt, decrypt } from "../utils/crypto";
import { BotState } from "../bot/states";
import type { User } from "@prisma/client";

/**
 * Foydalanuvchini telegramId bo'yicha topadi, topilmasa yaratadi.
 * Agar telegramId === adminId bo'lsa, admin va ruxsatli deb belgilanadi.
 */
export async function getOrCreateUser(telegramId: bigint, adminId: bigint): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { telegramId } });
  if (existing) return existing;

  const isAdmin = telegramId === adminId;
  return prisma.user.create({
    data: {
      telegramId,
      isAdmin,
      allowed: isAdmin,
      state: BotState.IDLE,
    },
  });
}

export async function findUser(telegramId: bigint): Promise<User | null> {
  return prisma.user.findUnique({ where: { telegramId } });
}

export async function setState(telegramId: bigint, state: BotState, stateData?: unknown): Promise<void> {
  await prisma.user.update({
    where: { telegramId },
    data: {
      state,
      stateData: stateData === undefined ? null : JSON.stringify(stateData),
    },
  });
}

export function getStateData<T>(user: User): T | null {
  if (!user.stateData) return null;
  try {
    return JSON.parse(user.stateData) as T;
  } catch {
    return null;
  }
}

export async function resetToIdle(telegramId: bigint): Promise<void> {
  await setState(telegramId, BotState.IDLE, undefined);
}

export async function setPhone(telegramId: bigint, phone: string): Promise<void> {
  await prisma.user.update({ where: { telegramId }, data: { phone } });
}

export async function saveSession(telegramId: bigint, sessionString: string): Promise<void> {
  await prisma.user.update({
    where: { telegramId },
    data: { encryptedSession: encrypt(sessionString) },
  });
}

export function decryptSession(user: User): string | null {
  if (!user.encryptedSession) return null;
  return decrypt(user.encryptedSession);
}

export async function clearSession(telegramId: bigint): Promise<void> {
  await prisma.user.update({
    where: { telegramId },
    data: { encryptedSession: null, phone: null },
  });
}

export async function setAllowed(telegramId: bigint, allowed: boolean): Promise<User> {
  return prisma.user.upsert({
    where: { telegramId },
    update: { allowed },
    create: { telegramId, allowed, isAdmin: false, state: BotState.IDLE },
  });
}

export async function deleteUser(telegramId: bigint): Promise<void> {
  await prisma.user.delete({ where: { telegramId } }).catch(() => undefined);
}

export async function listManagedUsers(): Promise<User[]> {
  return prisma.user.findMany({
    where: { isAdmin: false },
    orderBy: { createdAt: "asc" },
  });
}

export async function logAction(userId: number, action: string, detail?: string): Promise<void> {
  await prisma.actionLog.create({
    data: { userId, action, detail },
  });
}
