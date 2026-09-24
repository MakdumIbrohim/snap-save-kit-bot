import "dotenv/config";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resolveFfmpeg(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const p = createRequire(import.meta.url)("ffmpeg-static");
    if (typeof p === "string") return p;
  } catch {
    /* fallthrough */
  }
  return "ffmpeg";
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function num(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

function ids(name: string): Set<number> {
  return new Set(
    (process.env[name] ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter(Number.isFinite),
  );
}

export const config = {
  botToken: process.env.BOT_TOKEN ?? "",
  adminIds: ids("ADMIN_IDS"),
  accessMode: (process.env.ACCESS_MODE === "whitelist"
    ? "whitelist"
    : "public") as "public" | "whitelist",
  whitelistIds: ids("WHITELIST_IDS"),
  dailyLimit: num("DAILY_LIMIT", 10),
  maxDurationSec: num("MAX_DURATION_SEC", 3600), // Default: maks 1 jam (3600 detik)
  maxResolution: num("MAX_RESOLUTION", 1080),
  maxUploadMb: num("MAX_UPLOAD_MB", 50),
  concurrency: num("CONCURRENCY", 2),
  queueTimeoutSec: num("QUEUE_TIMEOUT_SEC", 900),
  previewTtlMin: num("PREVIEW_TTL_MIN", 30),
  rateLimit: {
    windowSec: num("RATE_LIMIT_WINDOW_SEC", 60),
    maxRequests: num("RATE_LIMIT_MAX_REQUESTS", 5),
  },
  proxies: process.env.PROXIES ?? process.env.PROXY_FILE ?? "",
  cookies: {
    dir: process.env.COOKIES_DIR ?? path.join(root, "data", "cookies"),
    youtube: process.env.YOUTUBE_COOKIES_TXT ?? "",
    facebook: process.env.FACEBOOK_COOKIES_TXT ?? "",
    instagram: process.env.INSTAGRAM_COOKIES_TXT ?? "",
  },
  youTubeCookies: process.env.YOUTUBE_COOKIES_TXT ?? "",
  facebookCookies: process.env.FACEBOOK_COOKIES_TXT ?? "",
  bin: {
    ytDlp: process.env.YTDLP_PATH ?? "yt-dlp",
    ffmpeg: resolveFfmpeg(),
  },
  dbPath: process.env.DB_PATH ?? path.join(root, "data", "snapkit.db"),
  tmpDir: process.env.TMP_DIR ?? path.join(root, "data", "tmp"),
};

export function assertConfig(): void {
  if (!config.botToken) {
    console.error(
      "BOT_TOKEN belum diisi. Salin .env.example ke .env lalu isi token dari @BotFather.",
    );
    process.exit(1);
  }
}
