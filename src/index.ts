import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { assertConfig, config } from "./config.js";
import "./db.js";
import { bot } from "./bot/index.js";
import { getRotatorStats, sweepStaleTmp } from "./services/index.js";

function checkBinary(name: string, bin: string): boolean {
  try {
    const out = execFileSync(bin, ["-version"], {
      encoding: "utf8",
      timeout: 15_000,
    });
    console.log(
      `[init] ${name} OK (${out.trim().split("\n")[0].slice(0, 80)})`,
    );
    return true;
  } catch {
    try {
      const out2 = execFileSync(bin, ["--version"], {
        encoding: "utf8",
        timeout: 15_000,
      });
      console.log(`[init] ${name} ${out2.trim().split("\n")[0].slice(0, 80)}`);
      return true;
    } catch {
      console.error(
        `[init] ${name} tidak ditemukan ('${bin}'). Bot butuh ${name} untuk memproses video.`,
      );
      return false;
    }
  }
}

assertConfig();
fs.mkdirSync(config.tmpDir, { recursive: true });
fs.mkdirSync(config.cookies.dir, { recursive: true });
sweepStaleTmp();

// Jalankan pembersihan file sementara secara berkala (tiap 30 menit)
setInterval(
  () => {
    sweepStaleTmp();
  },
  30 * 60 * 1000,
).unref();

const okYtDlp = checkBinary("yt-dlp", config.bin.ytDlp);
const okFfmpeg = checkBinary("ffmpeg", config.bin.ffmpeg);
if (!okYtDlp) process.exit(1);
if (!okFfmpeg)
  console.error("[init] tanpa ffmpeg, konversi MP3/muxing MP4 akan gagal.");

if (config.accessMode === "whitelist") {
  console.log(
    `[init] mode whitelist: ${config.whitelistIds.size} user diizinkan + admin.`,
  );
}

const rot = getRotatorStats();
if (rot.proxyCount > 0 || Object.values(rot.cookieCounts).some((c) => c > 0)) {
  console.log(
    `[init] rotasi: ${rot.proxyCount} proxy | cookies: YT(${rot.cookieCounts.youtube ?? 0}) FB(${rot.cookieCounts.facebook ?? 0}) IG(${rot.cookieCounts.instagram ?? 0})`,
  );
}

process.once("SIGINT", () => {
  console.log("[init] berhenti...");
  void bot.stop();
  setTimeout(() => process.exit(0), 500);
});

console.log("[init] Snap Save Kit Bot jalan (polling).");
await bot.start({
  onStart: async (me) => {
    console.log(`[init] @${me.username} siap menerima link.`);
    try {
      // Menu perintah standar untuk semua pengguna
      await bot.api.setMyCommands(
        [
          { command: "start", description: "Mulai & panduan penggunaan bot" },
          { command: "status", description: "Cek sisa kuota & antrian unduhan" },
          { command: "cancel", description: "Batalkan proses unduhan berjalan" },
          { command: "help", description: "Bantuan & informasi platform" },
        ],
        { scope: { type: "default" } },
      );

      // Daftarkan menu perintah lengkap (termasuk perintah admin) khusus untuk chat admin
      for (const adminId of config.adminIds) {
        try {
          await bot.api.setMyCommands(
            [
              { command: "start", description: "Mulai & panduan bot" },
              { command: "status", description: "Cek kuota & antrian" },
              { command: "cancel", description: "Batalkan unduhan berjalan" },
              { command: "stats", description: "[Admin] Statistik sistem & unduhan" },
              { command: "limit", description: "[Admin] Ubah kuota harian" },
              { command: "mode", description: "[Admin] Ubah mode public/whitelist" },
              { command: "user", description: "[Admin] Cek pemakaian user" },
              { command: "block", description: "[Admin] Blokir user" },
              { command: "unblock", description: "[Admin] Buka blokir user" },
              { command: "broadcast", description: "[Admin] Kirim siaran ke semua user" },
              { command: "help", description: "Bantuan" },
            ],
            { scope: { type: "chat", chat_id: adminId } },
          );
        } catch {
          // Abaikan jika bot belum pernah di-start oleh admin terkait
        }
      }

      console.log(
        "[init] Menu perintah bot (/) berhasil didaftarkan ke Telegram.",
      );
    } catch (err) {
      console.error("[init] Gagal mendaftarkan menu perintah bot:", err);
    }
  },
});
