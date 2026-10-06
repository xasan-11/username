import type { MyContext } from "../context";
import { BotState, UsernameMode, UsernamesStateData, ConfirmStateData } from "../states";
import { setState, getStateData, resetToIdle } from "../../db/userRepo";
import { parseUsernameCandidates, validateUsernameFormat } from "../../utils/username";
import { getActiveClient } from "../../userbot/manager";
import {
  checkTelegramUsername,
  checkUsernamesAvailability,
  createChannelOrGroup,
  updateSelfUsername,
  TelegramStatus,
} from "../../userbot/username";
import { checkFragmentNames, FragmentResult } from "../../userbot/fragment";
import { logger } from "../../utils/logger";
import type { TelegramClient } from "telegram";
import { describeUsernameActionError } from "../../userbot/errors";
import { sleep } from "../../userbot/floodWait";
import {
  cancelOnlyKeyboard,
  checkResultKeyboard,
  confirmCancelInlineKeyboard,
  mainMenuKeyboard,
} from "../keyboards";

const MODE_LABEL: Record<UsernameMode, string> = {
  channel: "kanal",
  group: "guruh",
  self: "urself",
};

export async function handleModeEntry(ctx: MyContext, mode: UsernameMode): Promise<void> {
  const user = ctx.dbUser;
  if (!user.encryptedSession) {
    await ctx.reply("❌ Avval hisobingizni ulang (/start).");
    return;
  }

  await setState(user.telegramId, BotState.AWAITING_USERNAMES, { mode } satisfies UsernamesStateData);
  await ctx.reply(
    "Username'larni yuboring (har qatorda bittadan yoki probel/vergul bilan ajratib, @ belgisiz ham bo'ladi):",
    { reply_markup: cancelOnlyKeyboard() }
  );
}

export async function handleUsernamesInput(ctx: MyContext): Promise<void> {
  const user = ctx.dbUser;
  if (user.state !== BotState.AWAITING_USERNAMES) return;

  const data = getStateData<UsernamesStateData>(user);
  if (!data) {
    await resetToIdle(user.telegramId);
    return;
  }

  const text = ctx.message?.text ?? "";
  const candidates = parseUsernameCandidates(text);
  if (candidates.length === 0) {
    await ctx.reply("❌ Hech bo'lmaganda bitta username yuboring.");
    return;
  }

  const valid: string[] = [];
  const formatInvalid: string[] = [];
  for (const name of candidates) {
    const result = validateUsernameFormat(name);
    if (result.valid) valid.push(name);
    else formatInvalid.push(name);
  }

  if (valid.length === 0) {
    await ctx.reply(`⚠️ Barcha username'lar yaroqsiz:\n${formatInvalid.map((n) => `@${n}`).join(", ")}`, {
      reply_markup: cancelOnlyKeyboard(),
    });
    return;
  }

  const client = await getActiveClient(user.telegramId);
  if (!client) {
    await ctx.reply("❌ Hisob ulanmagan. /start bosib qaytadan ulang.");
    await resetToIdle(user.telegramId);
    return;
  }

  await runTwoStageCheck(ctx, client, data.mode, valid, formatInvalid, []);
}

const NL = String.fromCharCode(10);
const list = (names: string[]) => names.map((n) => `@${n}`).join("\n");

/**
 * Ikki bosqichli tekshiruv: avval Telegram, so'ng (faqat Telegram "bo'sh" degan
 * nomlar uchun) Fragment. Natijani 5 guruhda ko'rsatadi va holatni saqlaydi.
 */
async function runTwoStageCheck(
  ctx: MyContext,
  client: TelegramClient,
  mode: UsernameMode,
  names: string[],
  formatInvalid: string[],
  carryFree: string[]
): Promise<void> {
  const user = ctx.dbUser;
  await ctx.reply(`🔎 ${names.length} ta username tekshirilmoqda (Telegram + Fragment)...`);

  // 1-bosqich: Telegram
  const tg = await checkUsernamesAvailability(client, names, async (seconds) => {
    await ctx.reply(`⏳ Telegram flood-limit qo'ydi (${seconds} soniya). Qolganlari aniqlanmadi deb belgilanadi.`).catch(
      () => undefined
    );
  });

  const byStatus = (st: TelegramStatus) => tg.filter((r) => r.status === st).map((r) => r.username);
  const tgFree = byStatus("free");
  const occupied = byStatus("occupied");
  const invalid = [...formatInvalid, ...byStatus("invalid")];
  const unchecked: string[] = byStatus("unknown");
  const fragmentListed: { name: string; text: string }[] = byStatus("purchase").map((name) => ({
    name,
    text: "Fragment'da sotuvda",
  }));

  // 2-bosqich: Fragment (faqat Telegram "bo'sh" degan nomlar)
  const bothFree: string[] = [];
  if (tgFree.length > 0) {
    if (tgFree.length > 1) await ctx.reply("🔎 Fragment tekshirilmoqda...").catch(() => undefined);
    let fr = new Map<string, FragmentResult>();
    try {
      fr = await checkFragmentNames(tgFree);
    } catch (e) {
      logger.error("Fragment bosqichi xatosi", { error: String(e) });
    }
    for (const name of tgFree) {
      const r = fr.get(name);
      if (r?.kind === "free") bothFree.push(name);
      else if (r?.kind === "listed") {
        fragmentListed.push({ name, text: `${r.label}${r.price ? `, ${r.price}` : ""}` });
      } else unchecked.push(name);
    }
  }

  const free = [...new Set([...carryFree, ...bothFree])];
  const fragmentUnchecked = tgFree.filter((n) => unchecked.includes(n));

  const sections: string[] = [];
  if (free.length > 0) sections.push(["✅ Ikkalasida ham bo'sh:", list(free)].join(NL));
  if (fragmentListed.length > 0) {
    const rows = fragmentListed.map((f) => `@${f.name} — ${f.text}`).join(NL);
    sections.push(["💎 Fragment'da:", rows].join(NL));
  }
  if (occupied.length > 0) sections.push(["❌ Band:", list(occupied)].join(NL));
  if (invalid.length > 0) sections.push(["⚠️ Yaroqsiz:", list(invalid)].join(NL));
  if (unchecked.length > 0) {
    const head = ["❔ Tekshirilmadi:", list(unchecked)];
    if (fragmentUnchecked.length > 0) head.push("(Fragment tekshirilmadi — yaratilmaydi)");
    sections.push(head.join(NL));
  }
  let message = sections.join(NL + NL) || "Natija topilmadi.";
  if (message.length > 3800) message = message.slice(0, 3800) + NL + "…";

  if (free.length === 0 && unchecked.length === 0) {
    await ctx.reply(message);
    await resetToIdle(user.telegramId);
    await ctx.reply("Menyu:", { reply_markup: mainMenuKeyboard(user.isAdmin) });
    return;
  }

  const confirmData: ConfirmStateData = { mode, freeUsernames: free, retryUsernames: unchecked };
  await setState(user.telegramId, BotState.AWAITING_CONFIRM, confirmData);

  let footer = "";
  if (free.length > 0) {
    footer =
      NL +
      NL +
      (mode === "self"
        ? "Bo'sh username'lardan bittasini tanlang:"
        : `✅ nomlar uchun ${MODE_LABEL[mode]} yaratilsinmi?`);
  }
  await ctx.reply(message + footer, {
    reply_markup: checkResultKeyboard({
      mode,
      free,
      fragmentNames: fragmentListed.map((f) => f.name),
      hasRetry: unchecked.length > 0,
    }),
  });
}

export async function handleMenuCallbackQuery(ctx: MyContext): Promise<void> {
  const user = ctx.dbUser;
  const data = ctx.callbackQuery?.data;
  if (!data) return;
  await ctx.answerCallbackQuery().catch(() => undefined);

  if (user.state !== BotState.AWAITING_CONFIRM) return;
  const confirmData = getStateData<ConfirmStateData>(user);
  if (!confirmData) {
    await resetToIdle(user.telegramId);
    return;
  }

  if (data === "cancel") {
    await resetToIdle(user.telegramId);
    await ctx.editMessageText("❌ Bekor qilindi.").catch(() => undefined);
    await ctx.reply("Menyu:", { reply_markup: mainMenuKeyboard(user.isAdmin) });
    return;
  }

  if (data === "recheck") {
    if (confirmData.retryUsernames.length === 0) return;
    const client = await getActiveClient(user.telegramId);
    if (!client) {
      await ctx.reply("❌ Hisob ulanmagan. /start bosib qaytadan ulang.");
      await resetToIdle(user.telegramId);
      return;
    }
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    await runTwoStageCheck(ctx, client, confirmData.mode, confirmData.retryUsernames, [], confirmData.freeUsernames);
    return;
  }

  if (data.startsWith("select:")) {
    if (confirmData.mode !== "self") return;
    const idx = Number(data.split(":")[1]);
    const selected = confirmData.freeUsernames[idx];
    if (!selected) return;

    const updated: ConfirmStateData = { ...confirmData, selected };
    await setState(user.telegramId, BotState.AWAITING_CONFIRM, updated);
    await ctx
      .editMessageText(`Tanlandi: @${selected}\nO'z akauntingizga shu username o'rnatilsinmi?`, {
        reply_markup: confirmCancelInlineKeyboard(),
      })
      .catch(() => undefined);
    return;
  }

  if (data === "confirm") {
    if (confirmData.freeUsernames.length === 0) return;
    const client = await getActiveClient(user.telegramId);
    if (!client) {
      await ctx.reply("❌ Hisob ulanmagan.");
      await resetToIdle(user.telegramId);
      return;
    }

    if (confirmData.mode === "self") {
      if (!confirmData.selected) {
        await ctx.reply("❌ Avval bo'sh username'lardan bittasini tanlang.");
        return;
      }
      // Qayta bosishdan himoya: holatni darhol tozalaymiz
      await resetToIdle(user.telegramId);
      await ctx.editMessageText("⏳ Username o'zgartirilmoqda...").catch(() => undefined);
      const stillFree = await recheckStillFree(client, confirmData.selected);
      if (stillFree !== true) {
        await ctx.reply(`⚠️ @${confirmData.selected} o'tkazib yuborildi: ${stillFree}. Username o'zgarmadi.`);
      } else {
        try {
          const link = await updateSelfUsername(client, confirmData.selected);
          await ctx.reply(`✅ Username muvaffaqiyatli o'rnatildi: ${link}`);
        } catch (e) {
          await ctx.reply(`${describeUsernameActionError(e)}
Eski username o'zgarmadi.`);
        }
      }
      await ctx.reply("Menyu:", { reply_markup: mainMenuKeyboard(user.isAdmin) });
      return;
    }

    // channel / group: har biri uchun ketma-ket
    await resetToIdle(user.telegramId);
    const names = confirmData.freeUsernames;
    const total = names.length;
    const lines: string[] = [];
    const orphans: string[] = [];
    const chatId = ctx.chat!.id;
    const progress = await ctx.editMessageText(`⏳ Yaratilmoqda... 0/${total}`).catch(() => undefined);
    const progressId = progress && typeof progress === "object" ? progress.message_id : undefined;

    for (let i = 0; i < total; i++) {
      const username = names[i];
      const stillFree = await recheckStillFree(client, username);
      if (stillFree !== true) {
        lines.push(`⚠️ @${username}: o'tkazib yuborildi — ${stillFree}`);
      } else {
        const outcome = await createChannelOrGroup(client, username, confirmData.mode);
        if (outcome.ok) {
          lines.push(`✅ ${outcome.link}`);
        } else {
          lines.push(`❌ @${username}: ${describeUsernameActionError(outcome.error)}`);
          if (outcome.orphan) {
            orphans.push(outcome.orphan);
            logger.error("Bo'sh kanal qolib ketdi", { userId: user.telegramId.toString(), username: outcome.orphan });
          }
        }
      }
      if (progressId !== undefined) {
        await ctx.api
          .editMessageText(chatId, progressId, `⏳ Yaratilmoqda... ${i + 1}/${total}`)
          .catch(() => undefined);
      }
      if (i < total - 1) await sleep(2000 + Math.floor(Math.random() * 1000));
    }

    let report = lines.join("\n");
    if (orphans.length > 0) {
      report += `

⚠️ Bo'sh kanal qolib ketdi: ${orphans.map((n) => `@${n}`).join(", ")} — qo'lda o'chiring.`;
    }
    await ctx.reply(report);
    await ctx.reply("Menyu:", { reply_markup: mainMenuKeyboard(user.isAdmin) });
  }
}

/**
 * Yaratishdan oldin Telegram holatini qayta tekshiradi. Bo'sh bo'lsa true,
 * aks holda o'tkazib yuborish sababini (matn) qaytaradi.
 */
async function recheckStillFree(client: TelegramClient, username: string): Promise<true | string> {
  const r = await checkTelegramUsername(client, username);
  switch (r.status) {
    case "free":
      return true;
    case "occupied":
      return "endi band";
    case "purchase":
      return "Fragment'da sotuvga qo'yilgan";
    case "invalid":
      return "yaroqsiz";
    default:
      return "holat aniqlanmadi";
  }
}
