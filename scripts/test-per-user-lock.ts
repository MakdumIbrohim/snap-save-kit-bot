import assert from "node:assert";
import { initQueue, startJob, hasActiveJob, cancelUserJob, queueRunning } from "../src/services/queue.js";
import type { VideoInfo } from "../src/services/extractor.js";

const resolvers = new Set<() => void>();

initQueue(
  async (job, report) => {
    report(50, "proses");
    await new Promise<void>((resolve) => {
      resolvers.add(resolve);
    });
    return { ok: true, path: "/tmp/fake.mp4", size: 100, ms: 10 };
  },
  () => {}
);

const fakeInfo: VideoInfo = {
  id: "test",
  title: "Test Video",
  duration: 10,
  thumbnail: null,
  uploader: null,
  webpageUrl: "https://example.com",
  platform: "youtube",
  formats: [],
  isLive: false,
  availability: null,
  isImage: false,
};

// 1. User 1 starts a job
assert(!hasActiveJob(1));
const job1 = startJob({
  chatId: 100,
  userId: 1,
  platform: "youtube",
  kind: { type: "video", height: 720 },
  info: fakeInfo,
});

assert(hasActiveJob(1));
assert(queueRunning() === 1);

// 2. User 1 tries to start another job -> should throw
assert.throws(() => {
  startJob({
    chatId: 100,
    userId: 1,
    platform: "youtube",
    kind: { type: "video", height: 720 },
    info: fakeInfo,
  });
}, /unduhan yang sedang berjalan/);

// 3. User 2 starts a job independently -> works immediately
assert(!hasActiveJob(2));
const job2 = startJob({
  chatId: 200,
  userId: 2,
  platform: "youtube",
  kind: { type: "audio" },
  info: fakeInfo,
});
assert(hasActiveJob(2));
assert(queueRunning() === 2);

// 4. Cancel user 2
assert(cancelUserJob(2));

// 5. Release runners and finish
resolvers.forEach((r) => r());
await Promise.all([job1.promise, job2.promise]);

assert(!hasActiveJob(1));
assert(!hasActiveJob(2));
console.log("Per-user lock test OK");
