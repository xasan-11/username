import { TelegramClient, Api } from "telegram";
import { env } from "../utils/env";
import { logger } from "../utils/logger";
import { sleep, getFloodWaitSeconds } from "./floodWait";

export interface ChannelRef {
  channelId: Api.InputPeerChannel["channelId"];
  accessHash: Api.InputPeerChannel["accessHash"];
}

export type FolderResult = { ok: true } | { ok: false; reason: string };

function codeOf(e: unknown): string {
  const anyErr = e as { errorMessage?: string; message?: string } | null;
  return String(anyErr?.errorMessage ?? anyErr?.message ?? "");
}

/** Xatoni foydalanuvchiga tushunarli o'zbekcha sababga aylantiradi. */
export function describeFolderError(e: unknown): string {
  const code = codeOf(e);
  if (code.includes("FILTER_INCLUDE_TOO_MUCH")) return "papka to'lgan";
  if (code.includes("FILTERS_TOO_MUCH")) return "papkalar soni limiti to'lgan";
  const wait = getFloodWaitSeconds(e);
  if (wait !== null) return `flood limit (${wait} soniya)`;
  return code || "noma'lum xato";
}

function titleText(title: unknown): string {
  if (typeof title === "string") return title;
  const t = title as { text?: unknown } | null;
  return typeof t?.text === "string" ? t.text : "";
}

type EditableFilter = Api.DialogFilter | Api.DialogFilterChatlist;

function isEditable(f: Api.TypeDialogFilter): f is EditableFilter {
  return f.className === "DialogFilter" || f.className === "DialogFilterChatlist";
}

function peerKey(p: Api.TypeInputPeer): string | null {
  return p.className === "InputPeerChannel" ? p.channelId.toString() : null;
}

/** Mavjud papkani to'liq nusxalab, kanallarni includePeers'ga qo'shadi. */
function withChannels(existing: EditableFilter, channels: ChannelRef[]): EditableFilter {
  const newKeys = new Set(channels.map((c) => c.channelId.toString()));
  const have = new Set(
    [...existing.includePeers, ...existing.pinnedPeers].map(peerKey).filter((k): k is string => k !== null)
  );
  const added = channels
    .filter((c) => !have.has(c.channelId.toString()))
    .map((c) => new Api.InputPeerChannel({ channelId: c.channelId, accessHash: c.accessHash }));
  const includePeers = [...existing.includePeers, ...added];

  if (existing.className === "DialogFilterChatlist") {
    return new Api.DialogFilterChatlist({
      hasMyInvites: existing.hasMyInvites,
      titleNoanimate: existing.titleNoanimate,
      id: existing.id,
      title: existing.title,
      emoticon: existing.emoticon,
      color: existing.color,
      pinnedPeers: existing.pinnedPeers,
      includePeers,
    });
  }
  return new Api.DialogFilter({
    contacts: existing.contacts,
    nonContacts: existing.nonContacts,
    groups: existing.groups,
    broadcasts: existing.broadcasts,
    bots: existing.bots,
    excludeMuted: existing.excludeMuted,
    excludeRead: existing.excludeRead,
    excludeArchived: existing.excludeArchived,
    titleNoanimate: existing.titleNoanimate,
    id: existing.id,
    title: existing.title,
    emoticon: existing.emoticon,
    color: existing.color,
    pinnedPeers: existing.pinnedPeers,
    includePeers,
    excludePeers: existing.excludePeers.filter((p) => {
      const k = peerKey(p);
      return k === null || !newKeys.has(k);
    }),
  });
}

async function applyOnce(client: TelegramClient, channels: ChannelRef[]): Promise<void> {
  const res = await client.invoke(new Api.messages.GetDialogFilters());
  // Yangi versiyada { filters: [...] }, eski versiyada to'g'ridan-to'g'ri massiv bo'lishi mumkin
  const filters: Api.TypeDialogFilter[] = Array.isArray(res)
    ? (res as Api.TypeDialogFilter[])
    : ((res as { filters?: Api.TypeDialogFilter[] }).filters ?? []);

  const wanted = env.FOLDER_NAME.trim().toLowerCase();
  const found = filters.filter(isEditable).find((f) => titleText(f.title).trim().toLowerCase() === wanted);

  if (found) {
    await client.invoke(new Api.messages.UpdateDialogFilter({ id: found.id, filter: withChannels(found, channels) }));
    return;
  }

  const usedIds = filters.map((f) => (f.className === "DialogFilterDefault" ? 0 : f.id));
  const id = Math.max(1, ...usedIds) + 1;
  const filter = new Api.DialogFilter({
    id,
    title: new Api.TextWithEntities({ text: env.FOLDER_NAME.trim(), entities: [] }),
    pinnedPeers: [],
    includePeers: channels.map((c) => new Api.InputPeerChannel({ channelId: c.channelId, accessHash: c.accessHash })),
    excludePeers: [],
  });
  await client.invoke(new Api.messages.UpdateDialogFilter({ id, filter }));
}

/**
 * Yaratilgan kanallarni foydalanuvchining "Username" papkasiga BITTA yangilash bilan qo'shadi.
 * Hech qachon xato tashlamaydi; FLOOD_WAIT bo'lsa bir marta kutib qayta urinadi.
 */
export async function addChannelsToFolder(client: TelegramClient, channels: ChannelRef[]): Promise<FolderResult> {
  if (channels.length === 0) return { ok: true };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await applyOnce(client, channels);
      return { ok: true };
    } catch (e) {
      const wait = getFloodWaitSeconds(e);
      if (wait !== null && attempt === 0) {
        await sleep((wait + 1) * 1000);
        continue;
      }
      logger.warn("Papkaga qo'shishda xato", { error: codeOf(e) });
      return { ok: false, reason: describeFolderError(e) };
    }
  }
  return { ok: false, reason: "noma'lum xato" };
}
