/**
 * Oddiy logger. DIQQAT: bu yerga hech qachon kod, parol yoki sessiya satrini
 * uzatmang — faqat harakat nomi va umumiy ma'lumotlarni loglang.
 */
export const logger = {
  info(message: string, meta?: Record<string, unknown>): void {
    console.log(`[INFO] ${message}`, meta ?? "");
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(`[WARN] ${message}`, meta ?? "");
  },
  error(message: string, meta?: Record<string, unknown>): void {
    console.error(`[ERROR] ${message}`, meta ?? "");
  },
};
