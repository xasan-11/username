import { getFloodWaitSeconds } from "./floodWait";

function errorCode(error: unknown): string {
  const anyErr = error as { errorMessage?: string; message?: string } | null;
  return String(anyErr?.errorMessage ?? anyErr?.message ?? "");
}

/**
 * Login (telefon/kod/parol) bosqichidagi xatolarni o'zbek tilida tushuntiradi.
 */
export function describeLoginError(error: unknown): string {
  const waitSeconds = getFloodWaitSeconds(error);
  if (waitSeconds !== null) {
    return `⏳ Juda ko'p urinish qilindi. Iltimos ${waitSeconds} soniyadan keyin qaytadan urinib ko'ring.`;
  }
  const code = errorCode(error);
  if (code.includes("PHONE_CODE_INVALID")) return "❌ Kod noto'g'ri. Qaytadan kiriting.";
  if (code.includes("PHONE_CODE_EXPIRED"))
    return "❌ Kodning amal qilish muddati tugadi. /start bosib qaytadan boshlang.";
  if (code.includes("PASSWORD_HASH_INVALID")) return "❌ Parol noto'g'ri. Qaytadan kiriting.";
  if (code.includes("PHONE_NUMBER_INVALID"))
    return "❌ Telefon raqam formati noto'g'ri. +998901234567 kabi formatda yuboring.";
  if (code.includes("PHONE_NUMBER_BANNED")) return "❌ Bu telefon raqam Telegram tomonidan bloklangan.";
  if (code.includes("PHONE_NUMBER_FLOOD"))
    return "⏳ Juda ko'p urinish qilindi. Birozdan so'ng qaytadan urinib ko'ring.";
  if (code.includes("PHONE_PASSWORD_FLOOD"))
    return "⏳ Juda ko'p noto'g'ri parol urinishi. Birozdan so'ng qaytadan urinib ko'ring.";
  return `❌ Xatolik yuz berdi: ${code || "noma'lum xato"}`;
}

/**
 * Username tekshirish / yaratish / o'zgartirish bosqichidagi xatolarni
 * o'zbek tilida tushuntiradi.
 */
export function describeUsernameActionError(error: unknown): string {
  const waitSeconds = getFloodWaitSeconds(error);
  if (waitSeconds !== null) {
    return `⏳ Flood limit: ${waitSeconds} soniya kutish kerak.`;
  }
  const code = errorCode(error);
  if (code.includes("USERNAME_OCCUPIED")) return "❌ Bu username band bo'lib qoldi.";
  if (code.includes("USERNAME_PURCHASE_AVAILABLE"))
    return "💰 Bu username auksionda sotiladi, oddiy usulda bepul olib bo'lmaydi.";
  if (code.includes("USERNAME_INVALID")) return "❌ Username formati yaroqsiz.";
  if (code.includes("USERNAME_NOT_MODIFIED")) return "⚠️ Username o'zgarmadi (bir xil qiymat).";
  if (code.includes("CHANNELS_ADMIN_PUBLIC_TOO_MUCH"))
    return "❌ Siz ega bo'lishingiz mumkin bo'lgan ommaviy kanal/guruhlar limiti to'lgan.";
  if (code.includes("CHAT_ADMIN_REQUIRED")) return "❌ Bu amal uchun admin huquqi talab qilinadi.";
  return `❌ Xatolik yuz berdi: ${code || "noma'lum xato"}`;
}
