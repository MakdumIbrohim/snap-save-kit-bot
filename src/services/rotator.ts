import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

function parseProxies(raw: string): string[] {
  if (!raw) return [];
  if (fs.existsSync(raw)) {
    try {
      const stat = fs.statSync(raw);
      if (stat.isFile()) {
        return fs
          .readFileSync(raw, "utf8")
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !s.startsWith("#"));
      }
    } catch {
      return [];
    }
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("#"));
}

function scanCookieDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".txt"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function parseCookiePool(raw?: string, subDir?: string): string[] {
  const result = new Set<string>();
  if (subDir && fs.existsSync(subDir)) {
    for (const f of scanCookieDir(subDir)) {
      result.add(path.resolve(f));
    }
  }
  if (raw) {
    if (fs.existsSync(raw)) {
      try {
        const stat = fs.statSync(raw);
        if (stat.isDirectory()) {
          for (const f of scanCookieDir(raw)) {
            result.add(path.resolve(f));
          }
        } else if (stat.isFile()) {
          result.add(path.resolve(raw));
        }
      } catch {
        /* skip */
      }
    } else {
      const parts = raw.split(",").map((s) => s.trim());
      for (const p of parts) {
        if (p && fs.existsSync(p)) {
          result.add(path.resolve(p));
        }
      }
    }
  }
  return [...result];
}

let proxies: string[] = parseProxies(config.proxies);
let proxyIndex = 0;

export function setProxies(list: string[]): void {
  proxies = list;
  proxyIndex = 0;
}

export function getNextProxy(): string | null {
  if (proxies.length === 0) return null;
  const p = proxies[proxyIndex % proxies.length];
  proxyIndex = (proxyIndex + 1) % proxies.length;
  return p;
}

const cookiePools = new Map<string, string[]>();
const cookieIndices = new Map<string, number>();

export function initCookiePools(customDir?: string): void {
  const baseDir = customDir ?? config.cookies.dir;
  const platforms = ["youtube", "facebook", "instagram"] as const;
  for (const plat of platforms) {
    const raw = config.cookies[plat];
    const sub = path.join(baseDir, plat);
    const pool = parseCookiePool(raw, sub);
    cookiePools.set(plat, pool);
  }
  const generalFiles = scanCookieDir(baseDir);
  for (const f of generalFiles) {
    const resolved = path.resolve(f);
    for (const plat of platforms) {
      const p = cookiePools.get(plat) ?? [];
      if (!p.includes(resolved)) {
        p.push(resolved);
        cookiePools.set(plat, p);
      }
    }
  }
}

initCookiePools();

export function getNextCookie(platform: string): string | null {
  const pool = cookiePools.get(platform);
  if (!pool || pool.length === 0) return null;
  const idx = cookieIndices.get(platform) ?? 0;
  const file = pool[idx % pool.length];
  cookieIndices.set(platform, (idx + 1) % pool.length);
  return file;
}

export function getRotatorStats(): {
  proxyCount: number;
  cookieCounts: Record<string, number>;
} {
  const cookieCounts: Record<string, number> = {};
  for (const [k, v] of cookiePools) {
    cookieCounts[k] = v.length;
  }
  return {
    proxyCount: proxies.length,
    cookieCounts,
  };
}
