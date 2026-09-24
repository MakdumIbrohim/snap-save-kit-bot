import type { Bot, Context } from "grammy";
import { config } from "./config.js";
import { getRotatorStats } from "./services/index.js";
import {
  effectiveDailyLimit,
  getAllActiveUserIds,
  getSetting,
  quotaUsed,
  recentErrors,
  setBlocked,
  setSetting,
  statsSummary,
  topUsers,
} from "./db.js";

export function registerAdminCommands(
  bot: Bot,
  guards: { isAdmin(userId: number): boolean },
): void {
  const guard = (ctx: Context): boolean => {
    const fromId = ctx.from?.id;
    const ok = !!fromId && guards.isAdmin(fromId);
    if (!ok) {
      console.warn(
        `[admin] Akses ditolak untuk user_id: ${fromId}. Admin IDs terdaftar:`,
        [...config.adminIds],
      );
      void ctx.reply("Perintah admin: akses ditolak.");
    }
    return ok;
  };

  const argAt = (ctx: Context, i = 1): string =>
    (ctx.message?.text ?? "").split(/\s+/)[i] ?? "";

  bot.command("stats", async (ctx) => {
    console.log(
      `[admin] Perintah /stats dipanggil oleh user_id: ${ctx.from?.id}`,
    );
    if (!guard(ctx)) return;
    try {
      const s = statsSummary();
      const rate = s.requests24h
        ? Math.round((s.success24h / s.requests24h) * 100)
        : 0;
      const rot = getRotatorStats();
      const cookieSummary = Object.entries(rot.cookieCounts)
        .map(([k, v]) => `${k.toUpperCase()}:${v}`)
        .join(" ");
      const lines = [
        "📊 <b>Statistik 24 jam terakhir</b>",
        `Permintaan: ${s.requests24h} • Sukses: ${s.success24h} • Gagal: ${s.failed24h} (${rate}% sukses)`,
        `Pengguna aktif: ${s.activeUsers24h} • Rata-rata proses: ${s.avgMs ? Math.round(s.avgMs / 100) / 10 : "-"}s`,
        `Kuota harian aktif: ${effectiveDailyLimit()}`,
        `Rotasi: ${rot.proxyCount} proxy • Cookies: ${cookieSummary || "-"}`,
        "",
        "<b>Per platform:</b>",
        ...(s.byPlatform.length
          ? s.byPlatform.map((p) => `• ${p.platform}: ${p.success}/${p.total}`)
          : ["(belum ada data)"]),
        "",
        "<b>Top downloader:</b>",
        ...topUsers(5).map(
          (u) =>
            `• <code>${u.user_id}</code> ${u.username ? `(@${u.username}) ` : ""}${u.total_downloads}`,
        ),
        "",
        "<b>Error terbaru:</b>",
        ...(recentErrors(5).length
          ? recentErrors(5).map(
              (e) =>
                `• ${new Date(e.ts).toISOString().slice(5, 16).replace("T", " ")} <code>${(e.detail ?? "-").slice(0, 80)}</code>`,
            )
          : ["(tidak ada)"]),
      ];
      await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
    } catch (err) {
      console.error("[admin] Gagal memproses /stats:", err);
      await ctx.reply("❌ Gagal mengambil statistik.");
    }
  });

  bot.command("block", async (ctx) => {
    if (!guard(ctx)) return;
    const id = Number(argAt(ctx));
    if (!Number.isFinite(id)) return ctx.reply("Format: /block <user_id>");
    setBlocked(id, true);
    await ctx.reply(`User ${id} diblokir.`);
  });

  bot.command("unblock", async (ctx) => {
    if (!guard(ctx)) return;
    const id = Number(argAt(ctx));
    if (!Number.isFinite(id)) return ctx.reply("Format: /unblock <user_id>");
    setBlocked(id, false);
    await ctx.reply(`Blokir user ${id} dicabut.`);
  });

  bot.command("limit", async (ctx) => {
    if (!guard(ctx)) return;
    const arg = argAt(ctx);
    if (!arg)
      return ctx.reply(
        `Kuota harian saat ini: ${effectiveDailyLimit()}.\nGanti dengan: /limit <jumlah>`,
      );
    const n = Number(arg);
    if (!Number.isInteger(n) || n < 1 || n > 10_000)
      return ctx.reply("Nilai tidak valid (1-10000).");
    setSetting("daily_limit", String(n));
    await ctx.reply(`Kuota harian diubah menjadi ${n} unduhan/pengguna.`);
  });

  bot.command("user", async (ctx) => {
    if (!guard(ctx)) return;
    const id = Number(argAt(ctx));
    if (!Number.isFinite(id)) return ctx.reply("Format: /user <user_id>");
    await ctx.reply(
      `User ${id}: terpakai hari ini ${quotaUsed(id)}/${effectiveDailyLimit()}.`,
    );
  });

  bot.command("mode", async (ctx) => {
    if (!guard(ctx)) return;
    const arg = argAt(ctx);
    if (arg !== "public" && arg !== "whitelist") {
      return ctx.reply(
        `Mode saat ini: ${currentAccessMode()}.\nGanti dengan: /mode public|whitelist`,
      );
    }
    setSetting("access_mode", arg);
    await ctx.reply(`Mode akses diubah ke ${arg}.`);
  });

  bot.command("broadcast", async (ctx) => {
    if (!guard(ctx)) return;

    // Ambil isi pesan setelah perintah /broadcast
    const rawText = ctx.message?.text ?? "";
    const message = rawText.replace(/^\/broadcast\s*/i, "").trim();

    if (!message) {
      return ctx.reply(
        "Format penggunaan: /broadcast <pesan pengumuman>\n\nContoh:\n/broadcast Halo semua, bot sedang maintenance server selama 15 menit.",
      );
    }

    const userIds = getAllActiveUserIds();
    if (userIds.length === 0) {
      return ctx.reply("Belum ada pengguna terdaftar di database.");
    }

    const statusMsg = await ctx.reply(
      `Memulai siaran pesan ke ${userIds.length} pengguna...`,
    );

    let success = 0;
    let failed = 0;

    const broadcastText = `<b>Pemberitahuan Sistem</b>\n\n${message}`;

    for (const id of userIds) {
      try {
        await bot.api.sendMessage(id, broadcastText, { parse_mode: "HTML" });
        success++;
      } catch {
        failed++;
      }
      // Delay 40ms per pesan (~25 pesan/detik) agar patuh rate limit Telegram Bot API (maks 30 msg/s)
      await new Promise((resolve) => setTimeout(resolve, 40));
    }

    await ctx.api
      .editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        `Siaran selesai.\n\nTotal target: ${userIds.length}\nBerhasil terkirim: ${success}\nGagal (bot diblokir/dihapus): ${failed}`,
      )
      .catch(() =>
        ctx.reply(
          `Siaran selesai.\nBerhasil: ${success}\nGagal: ${failed}`,
        ),
      );
  });
}

export function currentAccessMode(): "public" | "whitelist" {
  const v = getSetting("access_mode", "");
  return v === "public" || v === "whitelist" ? v : config.accessMode;
}
