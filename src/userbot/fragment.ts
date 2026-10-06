import * as cheerio from "cheerio";
import { sleep } from "./floodWait";
import { logger } from "../utils/logger";

/**
 * Fragment (fragment.com) tekshiruvi.
 *
 * Sahifa tuzilishi (3 xil nom bo'yicha o'rganilgan):
 * - Fragment'da umuman yo'q nom: /username/<nom> so'rovi `/?query=<nom>` qidiruv
 *   sahifasiga redirect bo'ladi; unda shu nom uchun qator va "Unavailable" holati bor,
 *   `.tm-section-header-status` elementi esa yo'q.
 * - Ro'yxatdagi nom: /username/<nom> sahifasida `.tm-section-header-status` elementi
 *   bor. Holat matni: "For sale", "On auction", "Sold", "Taken" (sinf: tm-status-avail /
 *   tm-status-unavail / tm-status-taken). Narx `.tm-section-bid-info` ichidagi
 *   birinchi `.tm-value.icon-ton` elementida.
 */

export type FragmentResult =
  | { kind: "free" }
  | { kind: "listed"; label: string; price: string | null }
  | { kind: "unknown"; reason: string };

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 8000;
const MIN_GAP_MS = 2000;
const CACHE_TTL_MS = 10 * 60 * 1000;
export const MAX_FRAGMENT_REQUESTS = 20;

const STATUS_LABELS: Record<string, string> = {
  "for sale": "Sotuvda",
  "on auction": "Auksionda",
  sold: "Sotilgan",
  taken: "Egallangan",
};

// Fragment natijalari hamma uchun bir xil (ommaviy ma'lumot) — faqat aniq natijalar keshlanadi.
const cache = new Map<string, { at: number; result: FragmentResult }>();

// So'rovlar orasida kamida 2 soniya (barcha foydalanuvchilar uchun umumiy).
let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

function parsePage(html: string, finalUrl: string, name: string): FragmentResult {
  const $ = cheerio.load(html);
  const status = $(".tm-section-header-status").first();

  if (status.length > 0) {
    // Natija aynan shu nom sahifasi ekanini tasdiqlaymiz
    const title = $("title").first().text().trim().toLowerCase();
    if (!finalUrl.toLowerCase().includes(`/username/${name}`) || !title.startsWith(name)) {
      return { kind: "unknown", reason: "sahifa boshqa nomga tegishli" };
    }
    const raw = status.text().trim();
    const label = STATUS_LABELS[raw.toLowerCase()];
    if (!label) return { kind: "unknown", reason: `noma'lum holat: ${raw.slice(0, 40)}` };
    const price = $(".tm-section-bid-info .tm-value.icon-ton").first().text().trim();
    return { kind: "listed", label, price: price ? `${price} TON` : null };
  }

  // Qidiruv sahifasi: aynan shu nom uchun qator va barcha qatorlarda "Unavailable" bo'lishi shart
  if (finalUrl.includes("query=")) {
    const rows = $("tr").filter((_, el) => $(el).find(".tm-value").length > 0);
    const own = rows.filter((_, el) => $(el).text().toLowerCase().includes(`@${name}`));
    if (own.length === 0) return { kind: "unknown", reason: "qidiruv natijasida nom topilmadi" };
    const statusText = own.first().find("[class*='tm-status-']").first().text().trim().toLowerCase();
    if (statusText === "unavailable") return { kind: "free" };
    return { kind: "unknown", reason: `qidiruv holati: ${statusText || "yo'q"}` };
  }

  return { kind: "unknown", reason: "sahifa tuzilishi tanilmadi" };
}

async function fetchOne(name: string): Promise<FragmentResult> {
  try {
    const res = await fetch(`https://fragment.com/username/${encodeURIComponent(name)}`, {
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return { kind: "unknown", reason: `HTTP ${res.status}` };
    const html = await res.text();
    return parsePage(html, res.url, name);
  } catch (e) {
    const err = e as { name?: string; message?: string };
    const reason = err?.name === "TimeoutError" || err?.name === "AbortError" ? "timeout" : "tarmoq xatosi";
    logger.warn("Fragment so'rovi xato", { name, error: String(err?.message ?? e) });
    return { kind: "unknown", reason };
  }
}

/**
 * Berilgan nomlarni Fragment'da tekshiradi. Bir chaqiruvda maksimum
 * MAX_FRAGMENT_REQUESTS ta haqiqiy so'rov yuboriladi (keshdan olinganlar
 * hisoblanmaydi); qolganlari "unknown" bo'ladi. Hech qachon xato tashlamaydi.
 */
export async function checkFragmentNames(names: string[]): Promise<Map<string, FragmentResult>> {
  const out = new Map<string, FragmentResult>();
  let requests = 0;

  for (const name of names) {
    try {
      const cached = cache.get(name);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        out.set(name, cached.result);
        continue;
      }
      if (requests >= MAX_FRAGMENT_REQUESTS) {
        out.set(name, { kind: "unknown", reason: "so'rovlar limiti (keyingi tekshiruvga qoldi)" });
        continue;
      }
      requests++;
      const result = await throttled(() => fetchOne(name));
      if (result.kind !== "unknown") cache.set(name, { at: Date.now(), result });
      out.set(name, result);
    } catch (e) {
      logger.error("Fragment tekshiruvida kutilmagan xato", { name, error: String(e) });
      out.set(name, { kind: "unknown", reason: "ichki xato" });
    }
  }
  return out;
}

export function fragmentUrl(name: string): string {
  return `https://fragment.com/username/${name}`;
}
