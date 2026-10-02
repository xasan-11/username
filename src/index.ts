import { prisma } from "./db/client";
import { createBot } from "./bot";
import { startHealthServer } from "./server";
import { logger } from "./utils/logger";

async function main(): Promise<void> {
  await prisma.$connect();
  logger.info("Bazaga ulanildi");

  startHealthServer();

  const bot = createBot();
  await bot.start({
    onStart: (botInfo) => logger.info(`Bot ishga tushdi: @${botInfo.username}`),
  });
}

main().catch((e) => {
  logger.error("Botni ishga tushirishda xatolik", { error: String(e) });
  process.exit(1);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
