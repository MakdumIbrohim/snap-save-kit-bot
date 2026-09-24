import type { ChildProcess } from "node:child_process";
import { consumeQuota, logEvent } from "../db.js";
import type { Platform } from "../platforms/index.js";
import type { VideoInfo } from "./extractor.js";

export type JobKind =
  | { type: "video"; height: number }
  | { type: "audio" }
  | { type: "image"; index?: number };

export type JobResult =
  | { ok: true; path: string; paths?: string[]; size: number; ms: number }
  | { ok: false; code: "too_big"; size: number; path: string }
  | { ok: false; code: "error"; message: string }
  | { ok: false; code: "cancelled" };

export type DownloadJob = {
  id: string;
  chatId: number;
  userId: number;
  statusMessageId?: number;
  info: VideoInfo;
  platform: Platform;
  kind: JobKind;
  queuedAt: number;
  startedAt?: number;
  cancelled: boolean;
  child?: ChildProcess;
  promise: Promise<JobResult>;
};

export type JobRunner = (
  job: DownloadJob,
  report: (percent: number | null, stage: string) => void,
) => Promise<JobResult>;

const activeByUser = new Map<number, DownloadJob>();

let runner: JobRunner | null = null;
let reporter:
  | ((job: DownloadJob, percent: number | null, stage: string) => void)
  | null = null;
let counter = 0;

export function initQueue(
  r: JobRunner,
  onProgress: (job: DownloadJob, percent: number | null, stage: string) => void,
): void {
  runner = r;
  reporter = onProgress;
}

export function hasActiveJob(userId: number): boolean {
  return activeByUser.has(userId);
}

export function getActiveJob(userId: number): DownloadJob | undefined {
  return activeByUser.get(userId);
}

export function queueDepth(): number {
  return 0;
}

export function queueRunning(): number {
  return activeByUser.size;
}

export function cancelJob(job: DownloadJob): void {
  job.cancelled = true;
  if (job.child && !job.child.killed) {
    try {
      job.child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

export function cancelUserJob(userId: number): boolean {
  const job = activeByUser.get(userId);
  if (!job) return false;
  cancelJob(job);
  return true;
}

export function startJob(params: {
  chatId: number;
  userId: number;
  platform: Platform;
  kind: JobKind;
  info: VideoInfo;
  statusMessageId?: number;
}): DownloadJob {
  if (!runner || !reporter) throw new Error("job runner belum diinisialisasi");
  if (activeByUser.has(params.userId)) {
    throw new Error("Pengguna masih memiliki unduhan yang sedang berjalan");
  }

  const id = `${Date.now().toString(36)}-${(++counter).toString(36)}`;
  let resolvePromise!: (r: JobResult) => void;
  const promise = new Promise<JobResult>((res) => {
    resolvePromise = res;
  });

  const job: DownloadJob = {
    id,
    chatId: params.chatId,
    userId: params.userId,
    platform: params.platform,
    kind: params.kind,
    info: params.info,
    statusMessageId: params.statusMessageId,
    queuedAt: Date.now(),
    startedAt: Date.now(),
    cancelled: false,
    promise,
  };

  activeByUser.set(params.userId, job);

  void (async () => {
    try {
      if (job.cancelled) {
        resolvePromise({ ok: false, code: "cancelled" });
        return;
      }
      const res = await runner!(job, (pct, stage) =>
        reporter!(job, pct, stage),
      );
      if (res.ok) {
        consumeQuota(job.userId);
        logEvent(job.userId, job.platform, job.kind.type, true);
      } else if (res.code === "too_big") {
        logEvent(
          job.userId,
          job.platform,
          job.kind.type,
          false,
          `too_big: ${res.size}`,
        );
      }
      resolvePromise(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logEvent(
        job.userId,
        job.platform,
        job.kind.type,
        false,
        msg.slice(0, 200),
      );
      resolvePromise({ ok: false, code: "error", message: msg });
    } finally {
      activeByUser.delete(params.userId);
    }
  })();

  return job;
}

export const enqueue = startJob;
