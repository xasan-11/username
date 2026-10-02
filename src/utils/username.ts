/**
 * Foydalanuvchi yuborgan matndan username nomzodlarini ajratib oladi.
 * Qator, probel va vergul bilan ajratilgan bo'lishi mumkin.
 */
export function parseUsernameCandidates(text: string): string[] {
  const raw = text
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const normalized = raw.map((item) => normalizeUsername(item));

  // Dublikatlarni olib tashlaymiz, tartibni saqlagan holda
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of normalized) {
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

/**
 * "@" belgisini olib tashlaydi va kichik harfga o'tkazadi.
 */
export function normalizeUsername(name: string): string {
  return name.replace(/^@/, "").toLowerCase();
}

export interface UsernameValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Telegram qoidalariga ko'ra username yaroqliligini tekshiradi:
 * - 5-32 belgi
 * - faqat lotin harf, raqam, pastki chiziq (_)
 * - harf bilan boshlanishi kerak
 * - "_" bilan tugamasligi kerak
 * - ketma-ket "__" bo'lmasligi kerak
 */
export function validateUsernameFormat(name: string): UsernameValidationResult {
  if (name.length < 5 || name.length > 32) {
    return { valid: false, reason: "uzunlik 5-32 belgi bo'lishi kerak" };
  }
  if (!/^[a-zA-Z]/.test(name)) {
    return { valid: false, reason: "harf bilan boshlanishi kerak" };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    return { valid: false, reason: "faqat lotin harf, raqam va pastki chiziqdan iborat bo'lishi kerak" };
  }
  if (name.endsWith("_")) {
    return { valid: false, reason: "pastki chiziq (_) bilan tugamasligi kerak" };
  }
  if (name.includes("__")) {
    return { valid: false, reason: "ketma-ket ikkita pastki chiziq (__) bo'lmasligi kerak" };
  }
  return { valid: true };
}
