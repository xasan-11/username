import http from "http";
import { env } from "./utils/env";
import { logger } from "./utils/logger";

/**
 * Railway kabi platformalar ko'pincha "web service" uchun portni tinglashni
 * kutadi. Bot o'zi long-polling orqali ishlaydi, lekin health-check
 * so'rovlariga javob berish uchun yengil HTTP server ham ko'taramiz.
 */
export function startHealthServer(): void {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("OK");
  });
  server.listen(env.PORT, () => {
    logger.info(`Health-check server ${env.PORT}-portda ishga tushdi`);
  });
}
