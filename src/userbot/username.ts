import { TelegramClient, Api } from "telegram";
import { sleep, getFloodWaitSeconds } from "./floodWait";
import { logger } from "../utils/logger";

export type TelegramStatus = "free" | "purchase" | "occupied" | "invalid" | "unknown";

export interface UsernameCheckResult {
  username: string;
  status: TelegramStatus;
}

export type FloodNotifier = (seconds: number) => Promise<void> | void;

function codeOf(e: unknown): string {
  const anyErr = e as { errorMessage?: string; message?: string } | null;
  return String(anyErr?.errorMessage ?? anyErr?.message ?? "");
}

/**
 * Bitta username'ni Telegram'da tekshiradi. "free" FAQAT Telegram aniq bo'sh desa:
 * ResolveUsername => USERNAME_NOT_OCCUPIED, so'ng account.CheckUsername => true.
 * Noma'lum xato yoki FLOOD_WAIT hech qachon "free" bo'lmaydi.
 */
export async function checkTelegramUsername(
  client: TelegramClient,
  username: string
): Promise<{ status: TelegramStatus; floodSeconds?: number }> {
  try {
    await client.invoke(new Api.contacts.ResolveUsername({ username }));
    return { status: "occupied" };
  } catch (e) {
    const flood = getFloodWaitSeconds(e);
    if (flood !== null) return { status: "unknown", floodSeconds: flood };
    const code = codeOf(e);
    if (code.includes("USERNAME_INVALID")) return { status: "invalid" };
    if (!code.includes("USERNAME_NOT_OCCUPIED")) return { status: "unknown" };
  }

  // Resolve "mavjud emas" dedi — Fragment'da sotuvda bo'lishi mumkin, shuni aniqlaymiz
  try {
    const ok = await client.invoke(new Api.account.CheckUsername({ username }));
    return { status: ok ? "free" : "occupied" };
  } catch (e) {
    const flood = getFloodWaitSeconds(e);
    if (flood !== null) return { status: "unknown", floodSeconds: flood };
    const code = codeOf(e);
    if (code.includes("USERNAME_PURCHASE_AVAILABLE")) return { status: "purchase" };
    if (code.includes("USERNAME_OCCUPIED")) return { status: "occupied" };
    if (code.includes("USERNAME_INVALID")) return { status: "invalid" };
    return { status: "unknown" };
  }
}

/**
 * Username'larni Telegram'da ketma-ket tekshiradi (1-bosqich). FLOOD_WAIT chiqsa
 * kutilmaydi: shu va qolgan nomlar "unknown" (❔) bo'ladi.
 */
export async function checkUsernamesAvailability(
  client: TelegramClient,
  usernames: string[],
  onFlood?: FloodNotifier
): Promise<UsernameCheckResult[]> {
  const results: UsernameCheckResult[] = [];
  let flooded = false;

  for (const username of usernames) {
    if (flooded) {
      results.push({ username, status: "unknown" });
      continue;
    }
    const r = await checkTelegramUsername(client, username);
    if (r.floodSeconds !== undefined) {
      flooded = true;
      if (onFlood) await Promise.resolve(onFlood(r.floodSeconds)).catch(() => undefined);
    }
    results.push({ username, status: r.status });
    await sleep(800);
  }

  return results;
}

export type CreateOutcome = { ok: true; link: string } | { ok: false; error: unknown; orphan?: string };

/**
 * Yangi kanal yoki guruh yaratadi va unga username o'rnatadi. UpdateUsername xato
 * bersa, yaratilgan kanal darhol o'chiriladi. O'chirish ham xato bersa `orphan`
 * to'ldiriladi (bo'sh kanal qolib ketgan).
 */
export async function createChannelOrGroup(
  client: TelegramClient,
  username: string,
  mode: "channel" | "group"
): Promise<CreateOutcome> {
  let createResult: Api.TypeUpdates;
  try {
    createResult = await client.invoke(
      new Api.channels.CreateChannel({
        title: username,
        about: "",
        broadcast: mode === "channel",
        megagroup: mode === "group",
      })
    );
  } catch (e) {
    return { ok: false, error: e };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chat = ((createResult as any).chats as Api.Channel[] | undefined)?.[0];
  if (!chat || chat.accessHash === undefined) {
    return { ok: false, error: new Error("Telegram bo'sh natija qaytardi") };
  }
  const channel = new Api.InputChannel({ channelId: chat.id, accessHash: chat.accessHash });

  try {
    await client.invoke(new Api.channels.UpdateUsername({ channel, username }));
    return { ok: true, link: `https://t.me/${username}` };
  } catch (e) {
    try {
      await client.invoke(new Api.channels.DeleteChannel({ channel }));
      return { ok: false, error: e };
    } catch (delErr) {
      logger.error("Yaratilgan kanalni o'chirib bo'lmadi", { username, error: codeOf(delErr) });
      return { ok: false, error: e, orphan: username };
    }
  }
}

/**
 * O'z akauntining (Urself) username'ini o'zgartiradi.
 */
export async function updateSelfUsername(client: TelegramClient, username: string): Promise<string> {
  await client.invoke(new Api.account.UpdateUsername({ username }));
  return `https://t.me/${username}`;
}
