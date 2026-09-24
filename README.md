# Snap Save Kit Bot

Bot Telegram pengunduh video, audio, album foto, dan lagu multi-platform.

**Platform didukung:** YouTube, TikTok, Instagram, Facebook, X (Twitter), Threads, Spotify

**Fitur:**
- Unduh video MP4 (pilihan resolusi hingga 1080p).
- Ekstrak audio MP3.
- Unduh lagu dari Spotify (pencarian audio berkualitas tinggi via YouTube Music).
- Penyematan tag metadata audio ID3v2 otomatis: cover art (APIC), judul, artis, nama album, dan lirik lagu (USLT via LrcLib).
- Unduh post gambar/foto tunggal maupun album slide (TikTok photo slide, Instagram carousel, Facebook photos).
- Pilihan unduh satu foto tertentu atau semua slide sekaligus (media group/album).
- Fallback scraper mandiri untuk post foto Facebook dan Instagram yang gagal diproses oleh yt-dlp.
- Perlindungan anti-spam / in-memory rate limiter per pengguna untuk mencegah overload server.
- Dukungan autentikasi & rotasi cookies pool (YouTube, Facebook, Instagram) untuk konten privat/login-wall.
- Dukungan pool rotasi proxy (HTTP/SOCKS5) untuk mencegah blokir IP dan rate limit (403 Forbidden).

**Alur:** Kirim link → lihat pratinjau (thumbnail/album slide, judul, uploader, format) → pilih format/foto → terima file.

---

## Prasyarat

| Kebutuhan | Versi |
|---|---|
| Node.js | ≥ 20 |
| yt-dlp | Terbaru (`yt-dlp -U`) |
| ffmpeg | ≥ 4 (untuk MP3 / mux MP4) |

### Install yt-dlp

```bash
# Linux/macOS — binary langsung
mkdir -p ~/.local/bin
curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ~/.local/bin/yt-dlp
chmod +x ~/.local/bin/yt-dlp
```

### Install ffmpeg

```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg
```

> ffmpeg-static (npm) sudah termasuk sebagai fallback otomatis jika `ffmpeg` tidak ada di PATH.

---

## Setup

```bash
# 1. Clone/extract proyek
cd any-clip-bot

# 2. Install dependensi
npm install

# 3. Buat .env dari template
cp .env.example .env
```

Edit `.env`:

```env
BOT_TOKEN=123456:ABC-ganti-dengan-token-dari-BotFather
ADMIN_IDS=12345678          # user_id Telegram kamu (lihat @userinfobot)
DAILY_LIMIT=10              # batas unduhan per user per hari
```

---

## Jalankan

### Cara Manual (Node.js di Host)

```bash
# Development (hot-reload)
npm run dev

# Produksi
npm run build
npm start
```

### Cara Docker (Rekomendasi untuk VPS/Server)

Node.js, `ffmpeg`, dan `yt-dlp` sudah terpasang otomatis di dalam image Docker.

```bash
# 1. Siapkan file environment
cp .env.example .env
nano .env

# 2. Jalankan container di background
docker compose up -d --build

# 3. Cek log bot
docker compose logs -f

# 4. Hentikan container
docker compose down
```

Data database SQLite dan temporary file otomatis tersimpan persisten di folder `./data` host server.

---

## Perintah Bot

| Perintah | Keterangan |
|---|---|
| `/start` atau `/help` | Panduan penggunaan & disclaimer |
| `/status` | Kuota hari ini + posisi antrian |
| `/cancel` | Batalkan unduhan berjalan |

### Perintah Admin (user_id harus ada di `ADMIN_IDS`)

| Perintah | Contoh | Keterangan |
|---|---|---|
| `/stats` | `/stats` | Statistik 24 jam: request, sukses, error, per-platform, top user |
| `/block` | `/block 123456` | Blokir user dari bot |
| `/unblock` | `/unblock 123456` | Cabut blokir |
| `/limit` | `/limit 20` | Ubah kuota harian (berlaku langsung) |
| `/user` | `/user 123456` | Lihat pemakaian kuota user tertentu |
| `/mode` | `/mode whitelist` | Ganti mode akses: `public` / `whitelist` |
| `/broadcast` | `/broadcast Pesan pengumuman` | Kirim pesan pengumuman ke seluruh pengguna aktif |

---

## Batasan Upload Bot API

Bot API standar: **maks 50 MB per file**.

Kalau file melebihi batas, bot memberitahu ukurannya dan menyarankan resolusi lebih rendah atau format MP3.

Untuk melewati limit 50 MB (sampai 2 GB), jalankan [Local Bot API Server](https://github.com/tdlib/telegram-bot-api) dan sesuaikan nilai `MAX_UPLOAD_MB` di `.env`.

---

## Struktur Proyek

```
src/
  index.ts               — entry point bot
  config.ts              — konfigurasi lingkungan & path binari
  db.ts                  — database SQLite (kuota, logs, settings)
  bot/
    index.ts             — workflow bot, handler perintah, preview, kirim file
    keyboards.ts         — pembentukan inline keyboard video & slide gambar
    sender.ts            — logic pengiriman dokumen, audio, video, dan media group
    guards.ts            — filter akses, kuota harian, whitelist, admin
    utils.ts             — escape HTML, token generator, pending session map
  platforms/
    index.ts             — dispatcher platform, deteksi URL, mapping domain
    types.ts             — interface PlatformConfig
    youtube.ts           — konfigurasi YouTube
    tiktok.ts            — handler TikTok video & slide foto
    instagram.ts         — handler Instagram video & carousel fallback scraper
    facebook.ts          — handler Facebook video & fallback photo scraper
    threads.ts           — konfigurasi Threads
    x.ts                 — konfigurasi X / Twitter
    spotify.ts           — handler lagu Spotify, ekstraksi metadata album & lirik
  services/
    downloader.ts        — download media via yt-dlp & download gambar
    extractor.ts         — ekstraksi metadata via yt-dlp -J + image fallback
    queue.ts             — antrian download (p-queue)
scripts/
  test-detect.ts         — unit test deteksi URL semua platform
  test-pipeline.ts       — tes integrasi fetch metadata & download video/audio
  test-single-and-all.ts — tes download single slide vs all slides album
data/                    — database SQLite + folder file temporary
```

---

## Tes

```bash
# Unit test deteksi URL platform
npx tsx scripts/test-detect.ts

# Tes download single foto vs semua foto album
npx tsx scripts/test-single-and-all.ts

# Tes download lagu Spotify (metadata, tag ID3, cover, lirik)
npx tsx scripts/test-spotify.ts

# Tes metadata video (butuh internet)
npx tsx scripts/test-pipeline.ts "https://youtu.be/dQw4w9WgXcQ"

# Tes unduh MP3 end-to-end
npx tsx scripts/test-pipeline.ts "https://youtu.be/dQw4w9WgXcQ" download
```

---

## Konfigurasi Lengkap `.env`

```env
BOT_TOKEN=                    # Wajib dari @BotFather
ADMIN_IDS=                    # user_id admin, pisah koma
ACCESS_MODE=public             # public | whitelist
WHITELIST_IDS=                 # user_id diizinkan jika whitelist, pisah koma
DAILY_LIMIT=10                 # batas unduhan sukses per user per hari
MAX_DURATION_SEC=3600          # batas durasi maksimal video/audio (detik, default 1 jam)
RATE_LIMIT_WINDOW_SEC=60       # jendela waktu anti-spam (detik)
RATE_LIMIT_MAX_REQUESTS=5      # batas request per jendela waktu per user
MAX_RESOLUTION=1080            # batas resolusi video (mis. 720 / 1080)
MAX_UPLOAD_MB=50               # batas upload file Telegram (default 50 MB)
CONCURRENCY=2                  # batas proses unduhan paralel
QUEUE_TIMEOUT_SEC=900          # timeout proses per job (detik)
PREVIEW_TTL_MIN=30             # masa berlaku tombol pilihan format (menit)
YOUTUBE_COOKIES_TXT=           # path file / folder cookies.txt YouTube
FACEBOOK_COOKIES_TXT=          # path file / folder cookies.txt Facebook
INSTAGRAM_COOKIES_TXT=         # path file / folder cookies.txt Instagram
COOKIES_DIR=data/cookies       # folder pool cookies (berisi *.txt atau subfolder per platform)
PROXIES=                       # daftar proxy pisah koma (http://..., socks5://...)
PROXY_FILE=                    # atau path file daftar proxy (1 per baris)
YTDLP_PATH=yt-dlp              # path binari yt-dlp jika custom
FFMPEG_PATH=                   # path binari ffmpeg jika custom
DB_PATH=data/snapkit.db        # lokasi file database SQLite
TMP_DIR=data/tmp               # lokasi direktori penyimpanan sementara
```

---

## Legal

Bot ini untuk keperluan pribadi/edukasi. Mengunduh konten platform lain dapat melanggar Terms of Service platform tersebut dan hak cipta konten. Pengguna bertanggung jawab atas konten yang diunduh.
