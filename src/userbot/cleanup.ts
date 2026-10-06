import bigInt from "big-integer";
import { TelegramClient, Api } from "telegram";
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { sleep, getFloodWaitSeconds } from "./floodWait";
import { getActiveClient } from "./manager";

const STALE_AFTER_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const DELETE_ATTEMPTS = 3;

type Big = ReturnType<typeof bigInt>;

function codeOf(e: unknown): string {
  const anyErr = e as { errorMessage?: string; message?: string } | null;
  return String(anyErr?.errorMessage ?? anyErr?.message ?? "");
}

/** Kanal allaqachon yo'q / unga kirish yo'q — o'chirish kerak emas. */
function isGone(e: unknown): boolean {
  const c = codeOf(e);
  return ["CHANNEL_INVALID", "CHANNEL_PRIVATE", "CHAT_ID_INVALID", "PEER_ID_INVALID"].some((k) => c.includes(k));
}

/** DB xatosi hech qachon oqimni buzmasin. */
async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    logger.error(`${label}: bazada xato`, { error: String(e) });
    return undefined;
  }
}

export async function startPending(userId: number, username: string): Promise<number | undefined> {
  const row = await safe("Kutilayotgan kanal yozuvi", () =>
    prisma.pendingChannel.create({ data: { userId, username } })
  );
  return row?.id;
}

export async function savePendingChannel(pendingId: number | undefined, channelId: Big, accessHash: Big): Promise<void> {
  if (pendingId === undefined) return;
  await safe("Kanal ID'sini saqlash", () =>
    prisma.pendingChannel.update({
      where: { id: pendingId },
      data: { channelId: BigInt(channelId.toString()), accessHash: BigInt(accessHash.toString()) },
    })
  );
}

export async function finishPending(pendingId: number | undefined): Promise<void> {
  if (pendingId === undefined) return;
  await safe("Yozuvni yakunlash", () => prisma.pendingChannel.deleteMany({ where: { id: pendingId } }));
}

/** channels.DeleteChannel — FLOOD_WAIT bo'lsa kutib, 3 martagacha urinadi. */
export async function deleteChannelWithRetry(
  client: TelegramClient,
  channelId: Big,
  accessHash: Big
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const channel = new Api.InputChannel({ channelId, accessHash });
  let lastReason = "noma'lum xato";
  for (let attempt = 0; attempt < DELETE_ATTEMPTS; attempt++) {
    try {
      await client.invoke(new Api.channels.DeleteChannel({ channel }));
      return { ok: true };
    } catch (e) {
      if (isGone(e)) return { ok: true };
      lastReason = codeOf(e) || lastReason;
      const wait = getFloodWaitSeconds(e);
      if (wait === null) break;
      await sleep((wait + 1) * 1000);
    }
  }
  return { ok: false, reason: lastReason };
}

export async function recordOrphan(userId: number, channelId: Big, accessHash: Big, reason: string): Promise<void> {
  await safe("Tozalanmagan kanalni yozish", () =>
    prisma.orphanChannel.create({
      data: {
        userId,
        channelId: BigInt(channelId.toString()),
        accessHash: BigInt(accessHash.toString()),
        reason: reason.slice(0, 200),
      },
    })
  );
}

/**
 * Kanal hali username'siz va bo'sh ekanini tekshiradi (faqat shu foydalanuvchi yaratgan bo'lsa).
 * "empty" — o'chirsa bo'ladi; "keep" — tegmaymiz; "gone" — allaqachon yo'q.
 */
async function inspectChannel(
  client: TelegramClient,
  channelId: Big,
  accessHash: Big
): Promise<"empty" | "keep" | "gone"> {
  try {
    const input = new Api.InputChannel({ channelId, accessHash });
    const res = await client.invoke(new Api.channels.GetChannels({ id: [input] }));
    const chat = res.chats[0];
    if (!chat || chat.className !== "Channel") return "gone";
    if (!chat.creator) return "keep";
    if (chat.username || (chat.usernames && chat.usernames.length > 0)) return "keep";

    const hist = await client.invoke(
      new Api.messages.GetHistory({
        peer: new Api.InputPeerChannel({ channelId, accessHash }),
        offsetId: 0,
        offsetDate: 0,
        addOffset: 0,
        limit: 10,
        maxId: 0,
        minId: 0,
        hash: bigInt(0),
      })
    );
    const messages = (hist as { messages?: Api.TypeMessage[] }).messages ?? [];
    const hasContent = messages.some((m) => m.className !== "MessageService");
    return hasContent ? "keep" : "empty";
  } catch (e) {
    return isGone(e) ? "gone" : "keep";
  }
}

let sweeping = false;

/** Eskirgan "kutilmoqda" yozuvlari va tozalanmagan kanallarni qayta ko'rib chiqadi. */
export async function sweepOrphans(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const stale = await prisma.pendingChannel.findMany({
      where: {
        status: "pending",
        channelId: { not: null },
        accessHash: { not: null },
        createdAt: { lt: new Date(Date.now() - STALE_AFTER_MS) },
      },
      include: { user: true },
      take: 100,
    });

    for (const row of stale) {
      try {
        const client = await getActiveClient(row.user.telegramId);
        if (!client) continue; // hisob ulanmagan — keyinroq
        const channelId = bigInt(row.channelId!.toString());
        const accessHash = bigInt(row.accessHash!.toString());
        const verdict = await inspectChannel(client, channelId, accessHash);
        if (verdict === "empty") {
          const del = await deleteChannelWithRetry(client, channelId, accessHash);
          if (!del.ok) {
            await recordOrphan(row.userId, channelId, accessHash, del.reason);
            logger.warn("Eskirgan bo'sh kanalni o'chirib bo'lmadi", { pendingId: row.id });
          } else {
            logger.info("Yetim kanal o'chirildi", { pendingId: row.id });
          }
        }
        // "keep" / "gone" / o'chirilgan yoki orphan jadvaliga o'tkazilgan — yozuv tayyor
        await prisma.pendingChannel.deleteMany({ where: { id: row.id } });
      } catch (e) {
        logger.error("Eskirgan yozuvni tozalashda xato", { pendingId: row.id, error: String(e) });
      }
    }

    const orphans = await prisma.orphanChannel.findMany({ include: { user: true }, take: 100 });
    for (const row of orphans) {
      try {
        const client = await getActiveClient(row.user.telegramId);
        if (!client) continue;
        const del = await deleteChannelWithRetry(
          client,
          bigInt(row.channelId.toString()),
          bigInt(row.accessHash.toString())
        );
        if (del.ok) {
          await prisma.orphanChannel.deleteMany({ where: { id: row.id } });
          logger.info("Tozalanmagan kanal o'chirildi", { orphanId: row.id });
        } else {
          await prisma.orphanChannel.update({
            where: { id: row.id },
            data: { attempts: { increment: 1 }, reason: del.reason.slice(0, 200) },
          });
        }
      } catch (e) {
        logger.error("Tozalanmagan kanalni o'chirishda xato", { orphanId: row.id, error: String(e) });
      }
    }
  } catch (e) {
    logger.error("Tozalash davri xatosi", { error: String(e) });
  } finally {
    sweeping = false;
  }
}

export function startCleanupSweeper(): void {
  void sweepOrphans();
  setInterval(() => void sweepOrphans(), SWEEP_INTERVAL_MS).unref();
}
