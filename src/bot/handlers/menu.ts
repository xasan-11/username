import type { MyContext } from "../context";
import { BotState, UsernameMode, UsernamesStateData, ConfirmStateData } from "../states";
import { setState, getStateData, resetToIdle } from "../../db/userRepo";
import { parseUsernameCandidates, validateUsernameFormat } from "../../utils/username";
import { getActiveClient } from "../../userbot/manager";
import { checkUsernamesAvailability, createChannelOrGroup, updateSelfUsername } from "../../userbot/username";
import { describeUsernameActionError } from "../../userbot/errors";
import { sleep } from "../../userbot/floodWait";
import {
  cancelOnlyKeyboard,
  confirmCancelInlineKeyboard,
  mainMenuKeyboard,
  selfUsernameChoiceKeyboard,
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

  await ctx.reply(`🔎 ${valid.length} ta username tekshirilmoqda...`);

  const results = await checkUsernamesAvailability(client, valid, async (seconds) => {
    await ctx.reply(`⏳ Telegram flood-limit qo'ydi: ${seconds} soniya kutib, davom etamiz...`).catch(
      () => undefined
    );
  });

  const free = results.filter((r) => r.free).map((r) => r.username);
  const occupied = results.filter((r) => !r.free && !r.invalid).map((r) => r.username);
  const allInvalid = [...formatInvalid, ...results.filter((r) => r.invalid).map((r) => r.username)];

  let message = "";
  if (free.length > 0) message += `✅ Bo'sh:\n${free.map((n) => `@${n}`).join("\n")}\n\n`;
  if (occupied.length > 0) message += `❌ Band:\n${occupied.map((n) => `@${n}`).join("\n")}\n\n`;
  if (allInvalid.length > 0) message += `⚠️ Yaroqsiz:\n${allInvalid.map((n) => `@${n}`).join("\n")}\n\n`;
  await ctx.reply(message.trim() || "Natija topilmadi.");

  if (free.length === 0) {
    await resetToIdle(user.telegramId);
    await ctx.reply("Menyu:", { reply_markup: mainMenuKeyboard(user.isAdmin) });
    return;
  }

  const confirmData: ConfirmStateData = { mode: data.mode, freeUsernames: free };
  await setState(user.telegramId, BotState.AWAITING_CONFIRM, confirmData);

  if (data.mode === "self") {
    await ctx.reply("Bo'sh username'lardan bittasini tanlang:", {
      reply_markup: selfUsernameChoiceKeyboard(free),
    });
  } else {
    await ctx.reply(
      `Yuqoridagi bo'sh username'lar uchun ${MODE_LABEL[data.mode]} yaratilsinmi?`,
      { reply_markup: confirmCancelInlineKeyboard() }
    );
  }
}

export async function handleMenuCallbackQuery(ctx: MyContext): Promise<void> {
  const user = ctx.dbUser;
  const data = ctx.callbackQuery?.data;
  if (!data) return;

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
      await ctx.editMessageText("⏳ Username o'zgartirilmoqda...").catch(() => undefined);
      try {
        const link = await updateSelfUsername(client, confirmData.selected);
        await ctx.reply(`✅ Username muvaffaqiyatli o'rnatildi: ${link}`);
      } catch (e) {
        await ctx.reply(describeUsernameActionError(e));
      }
      await resetToIdle(user.telegramId);
      await ctx.reply("Menyu:", { reply_markup: mainMenuKeyboard(user.isAdmin) });
      return;
    }

    // channel / group: har biri uchun alohida yaratamiz
    await ctx.editMessageText("⏳ Yaratilmoqda...").catch(() => undefined);
    const total = confirmData.freeUsernames.length;
    const lines: string[] = [];

    for (let i = 0; i < total; i++) {
      const username = confirmData.freeUsernames[i];
      try {
        const link = await createChannelOrGroup(client, username, confirmData.mode);
        lines.push(`✅ ${link}`);
      } catch (e) {
        lines.push(`❌ @${username}: ${describeUsernameActionError(e)}`);
      }
      await ctx.reply(`Progress: ${i + 1}/${total}`).catch(() => undefined);
      if (i < total - 1) await sleep(2500);
    }

    await ctx.reply(lines.join("\n"));
    await resetToIdle(user.telegramId);
    await ctx.reply("Menyu:", { reply_markup: mainMenuKeyboard(user.isAdmin) });
  }
}
