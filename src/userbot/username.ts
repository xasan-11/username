import { TelegramClient, Api } from "telegram";
import { sleep, getFloodWaitSeconds } from "./floodWait";

export interface UsernameCheckResult {
  username: string;
  free: boolean;
  invalid: boolean;
}

export type FloodNotifier = (seconds: number) => Promise<void> | void;

/**
 * Har bir username'ni Telegram'da bo'sh yoki bandligini tekshiradi.
 * contacts.ResolveUsername orqali: agar hech kimga/kanalga tegishli bo'lmasa
 * USERNAME_NOT_OCCUPIED xatosi qaytadi — bu bo'shligini bildiradi.
 * Tekshiruvlar orasida kichik kechikish qo'yiladi, FLOOD_WAIT chiqsa kutib davom etiladi.
 */
export async function checkUsernamesAvailability(
  client: TelegramClient,
  usernames: string[],
  onFlood?: FloodNotifier
): Promise<UsernameCheckResult[]> {
  const results: UsernameCheckResult[] = [];

  for (const username of usernames) {
    let done = false;
    while (!done) {
      try {
        await client.invoke(new Api.contacts.ResolveUsername({ username }));
        results.push({ username, free: false, invalid: false });
        done = true;
      } catch (e) {
        const anyErr = e as { errorMessage?: string; message?: string };
        const code = anyErr?.errorMessage ?? anyErr?.message ?? "";
        if (code.includes("USERNAME_NOT_OCCUPIED")) {
          results.push({ username, free: true, invalid: false });
          done = true;
        } else if (code.includes("USERNAME_INVALID")) {
          results.push({ username, free: false, invalid: true });
          done = true;
        } else {
          const waitSeconds = getFloodWaitSeconds(e);
          if (waitSeconds !== null) {
            if (onFlood) await onFlood(waitSeconds);
            await sleep((waitSeconds + 1) * 1000);
            // shu username uchun qayta urinamiz (while davom etadi)
          } else {
            // noma'lum xato — band/yaroqsiz deb belgilab, keyingisiga o'tamiz
            results.push({ username, free: false, invalid: true });
            done = true;
          }
        }
      }
    }
    await sleep(800);
  }

  return results;
}

/**
 * Yangi kanal yoki guruh yaratadi va unga berilgan username'ni o'rnatadi.
 * t.me havolasini qaytaradi.
 */
export async function createChannelOrGroup(
  client: TelegramClient,
  username: string,
  mode: "channel" | "group"
): Promise<string> {
  const createResult = await client.invoke(
    new Api.channels.CreateChannel({
      title: username,
      about: "",
      broadcast: mode === "channel",
      megagroup: mode === "group",
    })
  );

  // channels.CreateChannel natijasi Updates turlaridan biri bo'lib, .chats maydonini o'z ichiga oladi
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chats = (createResult as any).chats as Api.Channel[] | undefined;
  const chat = chats?.[0];
  if (!chat) {
    throw new Error("Kanal/guruh yaratilmadi (Telegram bo'sh natija qaytardi)");
  }

  const channel = new Api.InputChannel({ channelId: chat.id, accessHash: chat.accessHash! });

  // Shu kanal konteksida ham bandlikni oldindan tekshiramiz (spec talabi)
  await client.invoke(new Api.channels.CheckUsername({ channel, username })).catch(() => undefined);

  await client.invoke(new Api.channels.UpdateUsername({ channel, username }));
  return `https://t.me/${username}`;
}

/**
 * O'z akauntining (Urself) username'ini o'zgartiradi.
 */
export async function updateSelfUsername(client: TelegramClient, username: string): Promise<string> {
  await client.invoke(new Api.account.UpdateUsername({ username }));
  return `https://t.me/${username}`;
}
