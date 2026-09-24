import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";
import type { Platform } from "../platforms/index.js";
import { getPlatformConfig } from "../platforms/index.js";
import { fetchInstagramEmbedInfo } from "../platforms/instagram.js";
import { fetchFacebookPhotoInfo } from "../platforms/facebook.js";
import { getNextCookie, getNextProxy } from "./rotator.js";

const pexecFile = promisify(execFile);

export type VideoFormat = {
  formatId: string;
  ext: string;
  resolution: string;
  height: number | null;
  fps: number | null;
  vcodec: string;
  acodec: string;
  filesize: number | null;
  tbr: number | null;
  source: string;
};

export type VideoInfo = {
  id: string;
  title: string;
  duration: number;
  thumbnail: string | null;
  uploader: string | null;
  album?: string | null;
  lyrics?: string | null;
  webpageUrl: string;
  platform: Platform;
  formats: VideoFormat[];
  isLive: boolean;
  availability: string | null;
  isImage: boolean;
  images?: string[];
};

export class ExtractError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_url"
      | "unavailable"
      | "private"
      | "region"
      | "age"
      | "unsupported"
      | "timeout"
      | "error" = "error",
  ) {
    super(message);
  }
}

function classifyError(stderr: string): ExtractError {
  const s = stderr.toLowerCase();
  if (
    /private video|members-only|log in to confirm|account needs|only available for registered users/i.test(
      s,
    )
  )
    return new ExtractError(
      "Konten ini privat atau butuh login. Tidak bisa diunduh tanpa cookies.",
      "private",
    );
  if (/age[- ]restricted|confirm your age/.test(s))
    return new ExtractError("Konten dibatasi usia. Tidak bisa diunduh.", "age");
  if (/not available in your country|geo|region/.test(s))
    return new ExtractError(
      "Konten dibatasi wilayah (region-locked).",
      "region",
    );
  if (/video unavailable|has been removed|does not exist|404|not found/.test(s))
    return new ExtractError(
      "Video tidak tersedia (dihapus atau link salah).",
      "unavailable",
    );
  if (/is not a valid url|unsupported url|no usable/.test(s))
    return new ExtractError(
      "Link tidak dikenali / tidak valid.",
      "invalid_url",
    );
  if (/timed? ?out/.test(s))
    return new ExtractError(
      "Waktu proses sumber habis. Coba lagi sebentar.",
      "timeout",
    );
  if (/cannot parse data/i.test(s))
    return new ExtractError(
      "Gagal mengambil info dari platform. yt-dlp tidak bisa parse data (mungkin format berubah atau post bukan video).",
      "error",
    );
  return new ExtractError(
    "Gagal mengambil info dari platform. Mungkin struktur berubah.",
    "error",
  );
}

async function runYtDlp(args: string[], timeoutMs: number): Promise<string> {
  try {
    const { stdout } = await pexecFile(config.bin.ytDlp, args, {
      maxBuffer: 32 * 1024 * 1024,
      timeout: timeoutMs,
    });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; killed?: boolean; code?: number };
    const stderr = e.stderr ?? String(err);
    console.error("[yt-dlp] stderr:", stderr.slice(0, 1000));
    if (e.killed || (e.code === undefined && "signal" in e))
      throw new ExtractError("Waktu proses sumber habis.", "timeout");
    if (IMAGE_STDERR_RE.test(stderr))
      throw new ExtractError("image_post", "error");
    throw classifyError(stderr);
  }
}

const IMAGE_STDERR_RE =
  /there is no video in this post|not a video|this post contains images?|no video formats found|cannot parse data/i;
const IMAGE_EXTS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
  "heic",
]);

async function tryFetchImageInfo(url: string): Promise<VideoInfo | null> {
  try {
    const args = ["-J", "--no-playlist", "--no-warnings", "--no-progress"];
    const cookie = getNextCookie("instagram");
    if (cookie) args.push("--cookies", cookie);
    const proxy = getNextProxy();
    if (proxy) args.push("--proxy", proxy);
    args.push(url);
    const raw = await runYtDlp(args, INFO_TIMEOUT_MS);
    const data = JSON.parse(raw);
    const allImage =
      (data.formats ?? []).length > 0 &&
      (data.formats ?? []).every((f: any) =>
        IMAGE_EXTS.has((f.ext ?? "").toLowerCase()),
      );
    const isImage =
      allImage ||
      IMAGE_EXTS.has((data.ext ?? "").toLowerCase()) ||
      data._type === "image";
    if (!isImage) return null;
    return {
      id: String(data.id ?? ""),
      title: data.title ?? "Tanpa judul",
      duration: 0,
      thumbnail: data.thumbnail ?? null,
      uploader: data.uploader ?? data.channel ?? null,
      webpageUrl: data.webpage_url ?? url,
      platform: "instagram",
      formats: [],
      isLive: false,
      availability: null,
      isImage: true,
    };
  } catch {
    return null;
  }
}

const INFO_TIMEOUT_MS = 60_000;

export async function fetchInfo(
  url: string,
  platform: Platform,
): Promise<VideoInfo> {
  const handler = getPlatformConfig(platform);
  if (handler?.fetchInfo) {
    try {
      return await handler.fetchInfo(url);
    } catch (err) {
      if (err instanceof ExtractError && err.message === "USE_DEFAULT_YTDLP") {
        // Lanjutkan ke yt-dlp
      } else {
        throw err;
      }
    }
  }

  const args = ["-J", "--no-playlist", "--no-warnings", "--no-progress"];
  const cookie = getNextCookie(platform);
  if (cookie) {
    args.push("--cookies", cookie);
  }
  const proxy = getNextProxy();
  if (proxy) {
    args.push("--proxy", proxy);
  }
  args.push(url);
  console.log("[yt-dlp] fetchInfo:", url);

  let raw: string;
  try {
    raw = await runYtDlp(args, INFO_TIMEOUT_MS);
  } catch (err) {
    if (err instanceof ExtractError && (err.message === "image_post" || (platform === "facebook" && err.code === "private"))) {
      console.log(
        "[yt-dlp] konten gambar atau fb post terdeteksi, coba fallback scraper...",
      );
      if (platform === "facebook") {
        try {
          const fbInfo = await fetchFacebookPhotoInfo(url);
          if (fbInfo) return fbInfo;
        } catch {
          /* lanjutkan fallback */
        }
      }
      if (platform === "instagram") {
        try {
          const igInfo = await fetchInstagramEmbedInfo(url);
          return igInfo;
        } catch {
          /* lanjutkan fallback tryFetchImageInfo */
        }
      }
      const imageInfo = await tryFetchImageInfo(url);
      if (imageInfo) {
        imageInfo.platform = platform;
        return imageInfo;
      }
      throw new ExtractError(
        "Post ini berupa gambar/foto. Gagal mengambil URL gambar.",
        "unsupported",
      );
    }
    throw err;
  }
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("[yt-dlp] JSON parse gagal, stdout:", raw.slice(0, 500));
    throw new ExtractError(
      "Respons yt-dlp tidak valid (JSON parse error).",
      "error",
    );
  }

  console.log(
    `[yt-dlp] ok: "${(data.title ?? "").slice(0, 60)}" | _type=${data._type ?? "-"} | formats=${(data.formats ?? []).length} | ext=${data.ext ?? "-"}`,
  );

  if (data.playlist_count != null || data._type === "playlist") {
    throw new ExtractError(
      "Link playlist tidak didukung. Kirim link satu video saja.",
      "unsupported",
    );
  }

  if (
    data._type === "image" ||
    data.ext === "jpg" ||
    data.ext === "jpeg" ||
    data.ext === "png" ||
    data.ext === "webp"
  ) {
    return {
      id: String(data.id ?? ""),
      title: data.title ?? "Tanpa judul",
      duration: 0,
      thumbnail: data.thumbnail ?? null,
      uploader: data.uploader ?? data.channel ?? null,
      webpageUrl: data.webpage_url ?? url,
      platform,
      formats: [],
      isLive: false,
      availability: null,
      isImage: true,
    };
  }

  const formats: VideoFormat[] = (data.formats ?? [])
    .filter((f: any) => f.vcodec !== "none" || f.acodec !== "none")
    .map((f: any) => ({
      formatId: String(f.format_id),
      ext: f.ext ?? "",
      resolution: f.resolution ?? (f.height ? `${f.height}p` : "audio"),
      height: f.height ?? null,
      fps: f.fps ?? null,
      vcodec: f.vcodec ?? "none",
      acodec: f.acodec ?? "none",
      filesize: f.filesize ?? f.filesize_approx ?? null,
      tbr: f.tbr ?? null,
      source: f.source ?? "",
    }));

  const imageExts = new Set([
    "jpg",
    "jpeg",
    "png",
    "webp",
    "gif",
    "avif",
    "heic",
  ]);
  const allImages =
    (data.formats ?? []).length > 0 &&
    (data.formats ?? []).every((f: any) =>
      imageExts.has((f.ext ?? "").toLowerCase()),
    );
  if (allImages) {
    return {
      id: String(data.id ?? ""),
      title: data.title ?? "Tanpa judul",
      duration: 0,
      thumbnail: data.thumbnail ?? null,
      uploader: data.uploader ?? data.channel ?? null,
      webpageUrl: data.webpage_url ?? url,
      platform,
      formats: [],
      isLive: false,
      availability: null,
      isImage: true,
    };
  }

  return {
    id: String(data.id ?? ""),
    title: data.title ?? "Tanpa judul",
    duration: Math.round(Number(data.duration ?? 0)),
    thumbnail: data.thumbnail ?? null,
    uploader: data.uploader ?? data.channel ?? null,
    webpageUrl: data.webpage_url ?? url,
    platform,
    formats,
    isLive: Boolean(data.is_live),
    availability: data.availability ?? null,
    isImage: false,
  };
}
