import { Bot, InlineKeyboard } from "grammy";
import { currentAccessMode, registerAdminCommands } from "../admin.js";
import { config } from "../config.js";
import { ensureUser, logEvent, quotaUsed, effectiveDailyLimit } from "../db.js";
import {
  PLATFORM_LABEL,
  detectPlatform,
  extractUrl,
  type Platform,
} from "../platforms/index.js";
import {
  ExtractError,
  cancelUserJob,
  enqueue,
  fetchInfo,
  hasActiveJob,
  initQueue,
  queueRunning,
  runDownload,
  type DownloadJob,
  type VideoInfo,
} from "../services/index.js";
import { checkAccess, checkQuota, checkRateLimit, isAdmin } from "./guards.js";
import { buildImagePreview, buildVideoPreview } from "./keyboards.js";
import { handleJobResult } from "./sender.js";
import { esc, pending, progressBar, takePending } from "./utils.js";

export const bot = new Bot(config.botToken);

// Daftarkan admin commands lebih awal sebelum message handler
registerAdminCommands(bot, { isAdmin });

function describeError(err: unknown): string {
  if (err instanceof ExtractError) {
    return `❌ ${err.message}\n\nJika link benar tapi tetap gagal, kemungkinan konten privat/hapus/dibatasi, atau extractor perlu diperbarui.`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return `❌ Terjadi kesalahan: ${msg.slice(0, 200)}\nSilakan coba lagi. Jika berulang, hubungi admin.`;
}

async function sendPreview(
  chatId: number,
  userId: number,
  info: VideoInfo,
  platform: Platform,
) {
  if (info.isImage) {
    const { caption, keyboard } = buildImagePreview(info, platform, userId);
    const images = info.images ?? [];

    // Jika memiliki slide lebih dari 1 gambar, kirim album foto sebagai preview visual
    if (images.length > 1) {
      try {
        const CHUNK_SIZE = 10;
        for (let i = 0; i < images.length; i += CHUNK_SIZE) {
          const chunk = images.slice(i, i + CHUNK_SIZE);
          const media = chunk.map((url, idx) => ({
            type: "photo" as const,
            media: url,
            caption: `Foto ${i + idx + 1}/${images.length}`,
          }));
          await bot.api.sendMediaGroup(chatId, media);
        }

        // Kirim caption & keyboard pengendali format setelah album
        await bot.api.sendMessage(chatId, caption, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        });
        return;
      } catch (err) {
        console.error(
          "[bot] Gagal mengirim media group preview, fallback ke single thumbnail:",
          err,
        );
      }
    }

    if (info.thumbnail) {
      await bot.api
        .sendPhoto(chatId, info.thumbnail, {
          caption,
          parse_mode: "HTML",
          reply_markup: keyboard,
        })
        .catch(() =>
          bot.api.sendMessage(chatId, caption, {
            parse_mode: "HTML",
            reply_markup: keyboard,
          }),
        );
    } else {
      await bot.api.sendMessage(chatId, caption, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    }
    return;
  }

  const hasAudio = info.formats.some((f) => f.acodec !== "none");
  const hasVideo = info.formats.some((f) => f.vcodec !== "none");
  if (!hasVideo && !hasAudio) {
    await bot.api.sendMessage(
      chatId,
      "❌ Konten ini tidak memiliki format video atau audio yang bisa diunduh.",
    );
    return;
  }

  const { caption, keyboard } = buildVideoPreview(info, platform, userId);
  if (info.thumbnail) {
    await bot.api
      .sendPhoto(chatId, info.thumbnail, {
        caption,
        parse_mode: "HTML",
        reply_markup: keyboard,
      })
      .catch(async () => {
        await bot.api.sendMessage(chatId, caption, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        });
      });
  } else {
    await bot.api.sendMessage(chatId, caption, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }
}

// Commands
bot.command(["start", "help"], async (ctx) => {
  const name = ctx.from?.first_name ? `, <b>${esc(ctx.from.first_name)}</b>` : "";
  const text = [
    `Selamat datang di <b>Snap Save Kit Bot</b>${name}.`,
    "",
    "Layanan pengunduhan media multi-platform:",
    "- YouTube (Video & Audio)",
    "- TikTok (Video & Foto Slide)",
    "- Instagram (Reels & Carousel)",
    "- Facebook (Video & Foto)",
    "- X / Twitter (Video)",
    "- Threads (Video & Foto)",
    "- Spotify (Lagu, Cover & Lirik)",
    "",
    "Silakan kirimkan tautan untuk memulai proses pengunduhan.",
    `Batas kuota harian: <code>${effectiveDailyLimit()}</code> unduhan (reset tiap tengah malam).`,
    "",
    "Perintah menu:",
    "/status — Cek kuota dan posisi antrian",
    "/cancel — Batalkan unduhan yang berjalan",
    "/help — Panduan penggunaan",
    "",
    "<i>Catatan: Gunakan secara bijak untuk konten berizin. Bot tidak menyimpan file Anda.</i>",
  ].join("\n");
  await ctx.reply(text, { parse_mode: "HTML" });
});

bot.command("status", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  ensureUser(userId, ctx.from?.username);
  const limit = effectiveDailyLimit();
  const used = quotaUsed(userId);
  const active = hasActiveJob(userId);
  await ctx.reply(
    `Kuota hari ini: ${used}/${limit}\nStatus proses: ${active ? "Sedang mengunduh ⏳" : "Siap menerima link"}\nUnduhan aktif sistem: ${queueRunning()}\nMode akses: ${currentAccessMode()}.`,
  );
});

bot.command("cancel", async (ctx) => {
  const from = ctx.from;
  if (!from) return;
  const cancelled = cancelUserJob(from.id);
  await ctx.reply(
    cancelled ? "Unduhan dibatalkan." : "Tidak ada unduhan aktif.",
  );
});

// Message handler
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;
  const accessErr = checkAccess(ctx);
  if (accessErr) return ctx.reply(accessErr);

  if (hasActiveJob(ctx.from.id)) {
    return ctx.reply(
      "⏳ Kamu masih memiliki unduhan yang sedang berjalan.\nHarap tunggu hingga selesai atau batalkan dengan /cancel sebelum mengirim link lain.",
    );
  }

  const url = extractUrl(text);
  if (!url)
    return ctx.reply("Kirim tautan video, contoh: https://youtu.be/xxxx");

  const platform = detectPlatform(url);
  if (!platform) {
    logEvent(
      ctx.from.id,
      null,
      null,
      false,
      `unsupported url: ${url.slice(0, 120)}`,
    );
    return ctx.reply(
      "Platform link ini belum didukung. Yang didukung: YouTube, TikTok, Instagram, Facebook, X, Threads.",
    );
  }

  const quotaErr = checkQuota(ctx.from.id);
  if (quotaErr) return ctx.reply(quotaErr);

  const rateLimitErr = checkRateLimit(ctx.from.id);
  if (rateLimitErr) return ctx.reply(rateLimitErr);

  const ack = await ctx.reply(
    `Link ${PLATFORM_LABEL[platform]} terdeteksi. Mengambil info konten…`,
  );

  try {
    const info = await fetchInfo(url, platform);
    await ctx.api.deleteMessage(ctx.chat.id, ack.message_id).catch(() => {});

    // Validasi durasi maksimum video/audio
    if (info.duration && info.duration > config.maxDurationSec) {
      const maxMin = Math.round(config.maxDurationSec / 60);
      return ctx.reply(
        `❌ Durasi konten terlalu panjang (${Math.round(info.duration / 60)} menit). Maksimal durasi yang diizinkan adalah ${maxMin} menit.`,
      );
    }

    ensureUser(ctx.from.id, ctx.from.username);
    await sendPreview(ctx.chat.id, ctx.from.id, info, platform);
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat.id, ack.message_id).catch(() => {});
    const message = describeError(err);
    logEvent(ctx.from.id, platform, null, false, message.slice(0, 200));
    await ctx.reply(message);
  }
});

// Callback query handler
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const fromId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  const accessErr = checkAccess(ctx);
  if (!fromId || !chatId) return ctx.answerCallbackQuery();
  if (accessErr) {
    return ctx.answerCallbackQuery({
      text: accessErr.slice(0, 190),
      show_alert: true,
    });
  }

  const m = data.match(/^dl:(\w+):([va]|i(?:all|\d*))(\d*)$/);
  if (!m) return ctx.answerCallbackQuery();
  const [, token, kindFull, heightStr] = m;

  const p = takePending(token);
  if (!p) {
    return ctx.answerCallbackQuery({
      text: "Pilihan sudah kedaluwarsa/dipakai. Kirim ulang link videonya ya.",
      show_alert: true,
    });
  }
  if (p.userId !== fromId) {
    pending.set(token, p);
    return ctx.answerCallbackQuery({
      text: "Hanya pengirim link yang bisa memilih.",
      show_alert: true,
    });
  }

  const quotaErr = checkQuota(fromId);
  if (quotaErr) {
    return ctx.answerCallbackQuery({
      text: quotaErr.slice(0, 190),
      show_alert: true,
    });
  }

  const rateLimitErr = checkRateLimit(fromId);
  if (rateLimitErr) {
    return ctx.answerCallbackQuery({
      text: rateLimitErr.slice(0, 190),
      show_alert: true,
    });
  }

  if (hasActiveJob(fromId)) {
    return ctx.answerCallbackQuery({
      text: "Unduhan kamu sebelumnya masih berjalan. Harap tunggu hingga selesai atau batalkan dengan /cancel.",
      show_alert: true,
    });
  }

  let kindObj:
    | { type: "video"; height: number }
    | { type: "audio" }
    | { type: "image"; index?: number };

  if (kindFull === "a") {
    kindObj = { type: "audio" };
  } else if (kindFull.startsWith("i")) {
    const sub = kindFull.slice(1);
    if (sub === "all" || !sub) {
      kindObj = { type: "image" };
    } else {
      kindObj = { type: "image", index: Number(sub) };
    }
  } else {
    kindObj = { type: "video", height: Number(heightStr) };
  }

  await ctx.answerCallbackQuery({ text: "Memulai pemrosesan…" });
  const previewMsgId = (
    ctx.callbackQuery.message as { message_id?: number } | undefined
  )?.message_id;
  if (previewMsgId) {
    await ctx.api
      .editMessageCaption(chatId, previewMsgId, {
        caption: `⏳ <b>Sedang diproses…</b>\n${esc(p.info.title.slice(0, 120))}`,
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard(),
      })
      .catch(() => {});
  }

  const status = await bot.api.sendMessage(
    chatId,
    "⏳ Mempersiapkan unduhan…",
  );

  const job = enqueue({
    chatId,
    userId: fromId,
    platform: p.platform,
    kind: kindObj,
    info: p.info,
    statusMessageId: status.message_id,
  });

  const result = await job.promise;
  await handleJobResult(bot, chatId, job, result);
});

initQueue(runDownload, (job, percent, stage) => {
  if (!job.statusMessageId) return;
  const text =
    percent !== null ? `⏳ ${stage}\n${progressBar(percent)}` : `⏳ ${stage}`;
  void bot.api
    .editMessageText(job.chatId, job.statusMessageId, text)
    .catch(() => {});
});

bot.catch((err) => {
  console.error("[bot] unhandled error:", err.error ?? err);
});
