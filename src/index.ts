import { GrammyError } from "grammy";
import type { Bot } from "grammy";
import type { MyContext } from "./bot/context";
import { prisma } from "./db/client";
import { createBot } from "./bot";
import { disconnectAll } from "./userbot/manager";
import { startHealthServer } from "./server";
import { logger } from "./utils/logger";

const INITIAL_RETRY_DELAY_MS = 5000;
const MAX_RETRY_DELAY_MS = 60000;
const HEALTHY_RUN_THRESHOLD_MS = 30000; // shuncha vaqt ishlagan bo'lsa, kechikishni qayta boshidan boshlaymiz

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * bot.start() 409 (boshqa nusxa getUpdates so'rayotgan) yoki boshqa tarmoq
 * xatosi bilan yiqilsa, jarayon to'xtamasin — eksponensial kechikish bilan
 * qayta urinamiz. Faqat bot.stop() chaqirilganda (graceful shutdown) tinch
 * chiqamiz.
 */
async function runBotForever(bot: Bot<MyContext>): Promise<void> {
  let delay = INITIAL_RETRY_DELAY_MS;

  while (true) {
    const startedAt = Date.now();
    try {
      await bot.start({
        drop_pending_updates: false,
        onStart: (info) => logger.info(`Bot ishga tushdi: @${info.username}`),
      });
      // bot.start() faqat bot.stop() chaqirilganda tinch (xatosiz) tugaydi
      return;
    } catch (err) {
      const ranForMs = Date.now() - startedAt;
      if (ranForMs > HEALTHY_RUN_THRESHOLD_MS) {
        delay = INITIAL_RETRY_DELAY_MS;
      }

      if (err instanceof GrammyError && err.error_code === 409) {
        logger.warn(
          `getUpdates 409 Conflict — boshqa nusxa ishlayapti. ${delay / 1000}s dan keyin qayta urinamiz.`
        );
      } else {
        logger.error("Long polling xatosi, qayta urinilmoqda", {
          error: String(err),
          delaySeconds: delay / 1000,
        });
      }

      await sleep(delay);
      delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
    }
  }
}

let bot: Bot<MyContext> | undefined;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} qabul qilindi — bot toza to'xtatilmoqda...`);

  try {
    if (bot) await bot.stop();
  } catch (e) {
    logger.error("bot.stop() xatosi", { error: String(e) });
  }

  try {
    await disconnectAll();
  } catch (e) {
    logger.error("GramJS klientlarini uzishda xato", { error: String(e) });
  }

  try {
    await prisma.$disconnect();
  } catch (e) {
    logger.error("Bazadan uzishda xato", { error: String(e) });
  }

  process.exit(0);
}

async function main(): Promise<void> {
  await prisma.$connect();
  logger.info("Bazaga ulanildi");

  startHealthServer();

  bot = createBot();
  await runBotForever(bot);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((e) => {
  logger.error("Botni ishga tushirishda xatolik", { error: String(e) });
  process.exit(1);
});
