import crypto from "crypto";
import { env } from "./env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM uchun tavsiya etilgan uzunlik

const key = Buffer.from(env.SESSION_ENCRYPTION_KEY, "hex");

/**
 * Matnni AES-256-GCM bilan shifrlaydi.
 * Natija format: "<ivHex>:<authTagHex>:<cipherTextHex>"
 */
export function encrypt(plainText: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * encrypt() orqali shifrlangan matnni asl holiga qaytaradi.
 */
export function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Shifrlangan ma'lumot formati noto'g'ri");
  }
  const [ivHex, authTagHex, cipherTextHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const cipherText = Buffer.from(cipherTextHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  return decrypted.toString("utf8");
}
