import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { getNextCookie, getNextProxy, getRotatorStats, initCookiePools, setProxies } from "../src/services/rotator.js";

const stats = getRotatorStats();
assert(typeof stats.proxyCount === "number");
assert(typeof stats.cookieCounts === "object");

setProxies(["http://proxy1:8080", "http://proxy2:8080"]);
assert(getNextProxy() === "http://proxy1:8080");
assert(getNextProxy() === "http://proxy2:8080");
assert(getNextProxy() === "http://proxy1:8080");
setProxies([]);

const testDir = path.resolve("data/test-cookies");
const ytDir = path.join(testDir, "youtube");
fs.mkdirSync(ytDir, { recursive: true });
fs.writeFileSync(path.join(ytDir, "c1.txt"), "cookie1");
fs.writeFileSync(path.join(ytDir, "c2.txt"), "cookie2");

initCookiePools(testDir);

const c1 = getNextCookie("youtube");
const c2 = getNextCookie("youtube");
const c3 = getNextCookie("youtube");

assert(c1 !== null);
assert(c2 !== null);
assert(c1 !== c2);
assert(c3 === c1);

fs.rmSync(testDir, { recursive: true, force: true });
initCookiePools();
console.log("Rotator test OK");
