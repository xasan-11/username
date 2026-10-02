import { Api } from "telegram";

/**
 * Tasdiqlash kodi qaysi kanal orqali yuborilganini bildiradi.
 * DIQQAT: bu yerda hech qachon kodning o'zi saqlanmaydi/loglanmaydi — faqat turi.
 */
export type CodeDeliveryType = "app" | "sms" | "call" | "flash_call" | "missed_call" | "other";

export function classifySentCodeType(type: Api.auth.TypeSentCodeType): CodeDeliveryType {
  if (type instanceof Api.auth.SentCodeTypeApp) return "app";
  if (type instanceof Api.auth.SentCodeTypeSms) return "sms";
  if (type instanceof Api.auth.SentCodeTypeCall) return "call";
  if (type instanceof Api.auth.SentCodeTypeFlashCall) return "flash_call";
  if (type instanceof Api.auth.SentCodeTypeMissedCall) return "missed_call";
  return "other";
}

export function describeCodeDeliveryType(kind: CodeDeliveryType): string {
  switch (kind) {
    case "app":
      return "📩 Kod Telegram ilovangizdagi rasmiy \"Telegram\" chatiga yuborildi (Archived papkani ham tekshiring).";
    case "sms":
      return "📩 Kod SMS orqali yuborildi.";
    case "call":
      return "📞 Kod telefon qo'ng'irog'i orqali aytiladi.";
    case "flash_call":
      return "📞 Kod qisqa qo'ng'iroq (flash call) raqami orqali yuboriladi — kelgan raqamning oxirgi raqamlari kod bo'ladi.";
    case "missed_call":
      return "📞 Sizga qo'ng'iroq qilinadi — raqamning oxirgi raqamlari kod bo'ladi.";
    default:
      return "📩 Tasdiqlash kodi yuborildi.";
  }
}
