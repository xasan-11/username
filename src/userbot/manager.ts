import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { computeCheck } from "telegram/Password";
import { env } from "../utils/env";
import { logger } from "../utils/logger";
import { decryptSession, saveSession, findUser, setState } from "../db/userRepo";
import { BotState } from "../bot/states";
import { classifySentCodeType, type CodeDeliveryType } from "./sentCode";

/**
 * Har bir foydalanuvchi uchun alohida TelegramClient instansiyasi.
 * Hech qachon bitta client bir nechta telegramId orasida ulashilmaydi.
 */
export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 daqiqa

interface PendingLogin {
  client: TelegramClient;
  phone: string;
  phoneCodeHash: string;
  expiryTimer: NodeJS.Timeout;
}

// Muvaffaqiyatli login qilingan, hozir xotirada ushlab turilgan klientlar
const activeClients = new Map<string, TelegramClient>();
// Login jarayoni ketayotgan (hali tasdiqlanmagan) klientlar
const pendingLogins = new Map<string, PendingLogin>();

type ExpiryNotifier = (telegramId: bigint) => Promise<void> | void;
let onLoginExpired: ExpiryNotifier | null = null;

/**
 * Bot qatlami (grammY) bu orqali "kod 5 daqiqada kiritilmadi" holatida
 * foydalanuvchiga xabar yuborish funksiyasini ulaydi (dependency injection —
 * userbot qatlami grammY haqida bilmasligi kerak).
 */
export function setLoginExpiredNotifier(fn: ExpiryNotifier): void {
  onLoginExpired = fn;
}

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

function clearExpiryTimer(telegramId: bigint): void {
  const pending = pendingLogins.get(telegramId.toString());
  if (pending) clearTimeout(pending.expiryTimer);
}

async function expireLogin(telegramId: bigint): Promise<void> {
  const key = telegramId.toString();
  const pending = pendingLogins.get(key);
  if (!pending) return;

  pendingLogins.delete(key);
  await pending.client.destroy().catch(() => undefined);
  logger.info("Login muddati tugadi (5 daqiqa)", { telegramId: key });

  try {
    // Holatni "telefon so'rash"ga qaytaramiz — foydalanuvchi qotib qolmasin
    await setState(telegramId, BotState.AWAITING_PHONE);
  } catch (e) {
    logger.error("Login muddati tugaganda holatni tozalashda xato", { telegramId: key, error: String(e) });
  }

  if (onLoginExpired) {
    try {
      await onLoginExpired(telegramId);
    } catch (e) {
      logger.error("Login muddati tugaganini xabar qilishda xato", { telegramId: key, error: String(e) });
    }
  }
}

function scheduleExpiry(telegramId: bigint): void {
  const key = telegramId.toString();
  const pending = pendingLogins.get(key);
  if (!pending) return;
  clearTimeout(pending.expiryTimer);
  pending.expiryTimer = setTimeout(() => {
    void expireLogin(telegramId);
  }, LOGIN_TIMEOUT_MS);
}

export interface SendCodeInfo {
  phoneCodeHash: string;
  codeType: CodeDeliveryType;
}

export type StartLoginResult =
  | { status: "code_sent"; info: SendCodeInfo }
  | { status: "already_authorized" };

/**
 * Login jarayonini boshlaydi: yangi klient, yangi ulanish, auth.SendCode.
 * Xato bo'lsa klient darhol disconnect qilinadi va xato chaqiruvchiga uzatiladi.
 */
export async function startLogin(telegramId: bigint, phone: string): Promise<StartLoginResult> {
  const key = telegramId.toString();
  await cancelPendingLogin(telegramId);

  const client = createClient("");
  try {
    await client.connect();
    const sendResult = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId: env.API_ID,
        apiHash: env.API_HASH,
        settings: new Api.CodeSettings({}),
      })
    );

    if (sendResult instanceof Api.auth.SentCodeSuccess) {
      await finalizeLogin(telegramId, client);
      return { status: "already_authorized" };
    }

    const codeType = classifySentCodeType(sendResult.type);
    pendingLogins.set(key, {
      client,
      phone,
      phoneCodeHash: sendResult.phoneCodeHash,
      expiryTimer: setTimeout(() => void expireLogin(telegramId), LOGIN_TIMEOUT_MS),
    });
    logger.info("Kod yuborildi", { telegramId: key, codeType });

    return { status: "code_sent", info: { phoneCodeHash: sendResult.phoneCodeHash, codeType } };
  } catch (e) {
    await client.destroy().catch(() => undefined);
    throw e;
  }
}

export type ResendCodeResult =
  | { status: "code_sent"; info: SendCodeInfo }
  | { status: "already_authorized" }
  | { status: "error"; error: unknown };

/**
 * auth.ResendCode orqali kodni qayta yuboradi (masalan SMS bilan).
 * Shu foydalanuvchining mavjud (ulangan) klienti va phoneCodeHash'i ishlatiladi.
 */
export async function resendCode(telegramId: bigint): Promise<ResendCodeResult> {
  const key = telegramId.toString();
  const pending = pendingLogins.get(key);
  if (!pending) {
    return { status: "error", error: new Error("Login sessiyasi topilmadi, /start bosib qaytadan boshlang.") };
  }

  try {
    const resendResult = await pending.client.invoke(
      new Api.auth.ResendCode({
        phoneNumber: pending.phone,
        phoneCodeHash: pending.phoneCodeHash,
      })
    );

    if (resendResult instanceof Api.auth.SentCodeSuccess) {
      await finalizeLogin(telegramId, pending.client);
      return { status: "already_authorized" };
    }

    const codeType = classifySentCodeType(resendResult.type);
    pending.phoneCodeHash = resendResult.phoneCodeHash;
    scheduleExpiry(telegramId);
    logger.info("Kod qayta yuborildi", { telegramId: key, codeType });

    return { status: "code_sent", info: { phoneCodeHash: resendResult.phoneCodeHash, codeType } };
  } catch (e) {
    return { status: "error", error: e };
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
    clearExpiryTimer(telegramId);
    await finalizeLogin(telegramId, pending.client);
    return { status: "success" };
  } catch (e) {
    const anyErr = e as { errorMessage?: string; message?: string };
    const text = anyErr?.errorMessage ?? anyErr?.message ?? "";
    if (text.includes("SESSION_PASSWORD_NEEDED")) {
      clearExpiryTimer(telegramId);
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
    clearTimeout(pending.expiryTimer);
    pendingLogins.delete(key);
    await pending.client.destroy().catch(() => undefined);
  }
}

export function dropActiveClient(telegramId: bigint): void {
  activeClients.delete(telegramId.toString());
}

/**
 * Jarayon to'xtayotganda (SIGTERM/SIGINT) barcha GramJS klientlarni toza
 * uzish uchun. Railway qayta deploy qilganda eski nusxa darhol yopilsin.
 */
export async function disconnectAll(): Promise<void> {
  const clients = [
    ...activeClients.values(),
    ...Array.from(pendingLogins.values()).map((p) => p.client),
  ];
  for (const pending of pendingLogins.values()) {
    clearTimeout(pending.expiryTimer);
  }
  activeClients.clear();
  pendingLogins.clear();
  await Promise.all(clients.map((c) => c.destroy().catch(() => undefined)));
}
