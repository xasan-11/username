import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Muhim environment o'zgaruvchi topilmadi: ${name}`);
  }
  return value.trim();
}

function requiredInt(name: string): number {
  const raw = required(name);
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} butun son bo'lishi kerak, hozirgi qiymat: ${raw}`);
  }
  return value;
}

function requiredBigInt(name: string): bigint {
  const raw = required(name);
  try {
    return BigInt(raw);
  } catch {
    throw new Error(`${name} butun son (Telegram ID) bo'lishi kerak, hozirgi qiymat: ${raw}`);
  }
}

const sessionKeyRaw = required("SESSION_ENCRYPTION_KEY");
if (!/^[0-9a-fA-F]{64}$/.test(sessionKeyRaw)) {
  throw new Error(
    "SESSION_ENCRYPTION_KEY 32 baytlik (64 hex belgili) satr bo'lishi kerak. Generatsiya: openssl rand -hex 32"
  );
}

export const env = {
  BOT_TOKEN: required("BOT_TOKEN"),
  ADMIN_ID: requiredBigInt("ADMIN_ID"),
  API_ID: requiredInt("API_ID"),
  API_HASH: required("API_HASH"),
  DATABASE_URL: required("DATABASE_URL"),
  SESSION_ENCRYPTION_KEY: sessionKeyRaw,
  PORT: Number(process.env.PORT ?? 3000),
};
