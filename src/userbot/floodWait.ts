/**
 * FLOOD_WAIT xatolarini aniqlash va kutish uchun yordamchi funksiyalar.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GramJS FloodWaitError'da `.seconds` bo'ladi, ba'zan esa xabar matnida
 * "FLOOD_WAIT_123" ko'rinishida keladi. Ikkisini ham qo'llab-quvvatlaymiz.
 */
export function getFloodWaitSeconds(error: unknown): number | null {
  const anyErr = error as { seconds?: number; errorMessage?: string; message?: string } | null;
  if (anyErr && typeof anyErr.seconds === "number") {
    return anyErr.seconds;
  }
  const text = anyErr?.errorMessage ?? anyErr?.message ?? "";
  const match = /FLOOD_WAIT_(\d+)/.exec(text);
  if (match) return Number(match[1]);
  return null;
}
