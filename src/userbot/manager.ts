import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { computeCheck } from "telegram/Password";
import { env } from "../utils/env";
import { decryptSession, saveSession, findUser } from "../db/userRepo";

/**
 * Har bir foydalanuvchi uchun alohida TelegramClient instansiyasi.
 * Hech qachon bitta client bir nechta telegramId orasida ulashilmaydi.
 */
interface PendingLogin {
  client: TelegramClient;
  phone: string;
  phoneCodeHash: string;
}

// Muvaffaqiyatli login qilingan, hozir xotirada ushlab turilgan klientlar
const activeClients = new Map<string, TelegramClient>();
// Login jarayoni ketayotgan (hali tasdiqlanmagan) klientlar
const pendingLogins = new Map<string, PendingLogin>();

function createClient(sessionString: string): TelegramClient {
  return new TelegramClient(new StringSession(sessionString), env.API_ID, env.API_HASH, {
    connectionRetries: 5,
  });
}

/**
 * Agar foydalanuvchi allaqachon login qilgan bo'lsa, uning klientini qaytaradi
 * (kerak bo'lsa bazadan lazy-load qiladi). Login qilinmagan bo'lsa null.
 */
export async function getActiveClient(telegramId: bigint): Promise<TelegramClient | null> {
  const key = telegramId.toString();
  const cached = activeClients.get(key);
  if (cached) return cached;

  const user = await findUser(telegramId);
  if (!user) return null;
  const sessionString = decryptSession(user);
  if (!sessionString) return null;

  const client = createClient(sessionString);
  await client.connect();
  activeClients.set(key, client);
  return client;
}

/**
 * Login jarayonini boshlaydi: yangi klient, yangi ulanish, sendCode.
 */
export async function startLogin(telegramId: bigint, phone: string): Promise<void> {
  const key = telegramId.toString();
  await cancelPendingLogin(telegramId);

  const client = createClient("");
  await client.connect();
  try {
    const result = await client.sendCode({ apiId: env.API_ID, apiHash: env.API_HASH }, phone);
    pendingLogins.set(key, { client, phone, phoneCodeHash: result.phoneCodeHash });
  } catch (e) {
    await client.destroy().catch(() => undefined);
    throw e;
  }
}

export type LoginStepResult =
  | { status: "success" }
  | { status: "password_needed" }
  | { status: "error"; error: unknown };

export async function submitCode(telegramId: bigint, code: string): Promise<LoginStepResult> {
  const key = telegramId.toString();
  const pending = pendingLogins.get(key);
  if (!pending) {
    return { status: "error", error: new Error("Login sessiyasi topilmadi, /start bosib qaytadan boshlang.") };
  }

  try {
    await pending.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: pending.phone,
        phoneCodeHash: pending.phoneCodeHash,
        phoneCode: code,
      })
    );
    await finalizeLogin(telegramId, pending.client);
    return { status: "success" };
  } catch (e) {
    const anyErr = e as { errorMessage?: string; message?: string };
    const text = anyErr?.errorMessage ?? anyErr?.message ?? "";
    if (text.includes("SESSION_PASSWORD_NEEDED")) {
      return { status: "password_needed" };
    }
    return { status: "error", error: e };
  }
}

export async function submitPassword(telegramId: bigint, password: string): Promise<LoginStepResult> {
  const key = telegramId.toString();
  const pending = pendingLogins.get(key);
  if (!pending) {
    return { status: "error", error: new Error("Login sessiyasi topilmadi, /start bosib qaytadan boshlang.") };
  }

  try {
    const passwordInfo = await pending.client.invoke(new Api.account.GetPassword());
    const passwordSrpCheck = await computeCheck(passwordInfo, password);
    await pending.client.invoke(new Api.auth.CheckPassword({ password: passwordSrpCheck }));
    await finalizeLogin(telegramId, pending.client);
    return { status: "success" };
  } catch (e) {
    return { status: "error", error: e };
  }
}

async function finalizeLogin(telegramId: bigint, client: TelegramClient): Promise<void> {
  const key = telegramId.toString();
  const sessionString = client.session.save() as unknown as string;
  await saveSession(telegramId, sessionString);
  pendingLogins.delete(key);
  activeClients.set(key, client);
}

/**
 * Hisobdan Telegram tomonida chiqadi (auth.LogOut) va xotiradagi klientni tozalaydi.
 * Bazadan sessiyani o'chirish chaqiruvchi tomonda (userRepo.clearSession) amalga oshiriladi.
 */
export async function logout(telegramId: bigint): Promise<void> {
  const key = telegramId.toString();
  const client = activeClients.get(key) ?? (await getActiveClient(telegramId));
  if (client) {
    try {
      await client.invoke(new Api.auth.LogOut());
    } catch {
      // E'tiborsiz qoldiramiz — baribir sessiyani bazadan o'chiramiz
    }
    await client.destroy().catch(() => undefined);
    activeClients.delete(key);
  }
}

export async function cancelPendingLogin(telegramId: bigint): Promise<void> {
  const key = telegramId.toString();
  const pending = pendingLogins.get(key);
  if (pending) {
    await pending.client.destroy().catch(() => undefined);
    pendingLogins.delete(key);
  }
}

export function dropActiveClient(telegramId: bigint): void {
  activeClients.delete(telegramId.toString());
}
