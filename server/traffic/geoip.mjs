/**
 * IP geolocation with durable disk cache.
 *
 * External providers (only when cache misses):
 *   - http://ip-api.com  (primary, free non-commercial)
 *   - https://ipwho.is   (fallback)
 *
 * Env:
 *   EARTHLINK_GEO_CACHE     path to JSON cache file (default: <cwd>/data/geo-cache.json)
 *   EARTHLINK_GEO_TTL_DAYS  positive entry lifetime (default: 30)
 *   EARTHLINK_GEO_OFFLINE=1 never call providers — cache only
 *   EARTHLINK_GEO_DISABLE=1 disable all geo (everything "Unresolved")
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const DAY = 24 * 60 * 60 * 1000;
const POSITIVE_TTL_MS = Math.max(
  1,
  Number(process.env.EARTHLINK_GEO_TTL_DAYS || 30),
) * DAY;
const NEGATIVE_TTL_MS = 15 * 60 * 1000;
const OFFLINE = process.env.EARTHLINK_GEO_OFFLINE === "1";
const DISABLED = process.env.EARTHLINK_GEO_DISABLE === "1";

const CACHE_PATH =
  process.env.EARTHLINK_GEO_CACHE ||
  path.join(process.cwd(), "data", "geo-cache.json");

/** @type {Map<string, { value: any, expiresAt: number }>} */
const cache = new Map();
let loaded = false;
let dirty = false;
let saveTimer = null;
let hits = 0;
let misses = 0;
let fetches = 0;

function now() {
  return Date.now();
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(CACHE_PATH)) return;
    const raw = fs.readFileSync(CACHE_PATH, "utf8");
    const data = JSON.parse(raw);
    const entries = data.entries || data;
    if (!entries || typeof entries !== "object") return;
    const t = now();
    let n = 0;
    for (const [ip, row] of Object.entries(entries)) {
      if (!row || typeof row !== "object") continue;
      const expiresAt = Number(row.expiresAt || 0);
      if (expiresAt && expiresAt < t) continue;
      cache.set(ip, {
        value: row.value === undefined ? row.geo ?? row : row.value,
        expiresAt: expiresAt || t + POSITIVE_TTL_MS,
      });
      n += 1;
    }
    if (n > 0) {
      console.log(
        `[earthlink] geo cache loaded ${n} IPs from ${CACHE_PATH}`,
      );
    }
  } catch (e) {
    console.warn("[earthlink] geo cache load failed:", e?.message || e);
  }
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushCache();
  }, 2000);
  if (typeof saveTimer.unref === "function") saveTimer.unref();
}

export async function flushCache() {
  if (!dirty) return;
  dirty = false;
  try {
    const dir = path.dirname(CACHE_PATH);
    await fsp.mkdir(dir, { recursive: true });
    const entries = {};
    const t = now();
    for (const [ip, row] of cache) {
      if (row.expiresAt < t) continue;
      // Don't persist private synthetic entries forever bulk — still ok
      entries[ip] = {
        value: row.value,
        expiresAt: row.expiresAt,
      };
    }
    const payload = JSON.stringify(
      {
        version: 1,
        savedAt: t,
        provider: "ip-api.com / ipwho.is",
        entries,
      },
      null,
      0,
    );
    const tmp = `${CACHE_PATH}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, payload, "utf8");
    await fsp.rename(tmp, CACHE_PATH);
  } catch (e) {
    dirty = true;
    console.warn("[earthlink] geo cache save failed:", e?.message || e);
  }
}

export function getCached(ip) {
  ensureLoaded();
  const hit = cache.get(ip);
  if (!hit) return null;
  if (hit.expiresAt < now()) {
    cache.delete(ip);
    return null;
  }
  hits += 1;
  return hit.value;
}

export function setCache(ip, value, ttl = POSITIVE_TTL_MS) {
  ensureLoaded();
  cache.set(ip, { value, expiresAt: now() + ttl });
  scheduleSave();
}

export function geoCacheStats() {
  ensureLoaded();
  return {
    path: CACHE_PATH,
    size: cache.size,
    hits,
    misses,
    fetches,
    offline: OFFLINE,
    disabled: DISABLED,
    ttlDays: POSITIVE_TTL_MS / DAY,
  };
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith("169.254.")) return true;
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return (
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80")
    );
  }
  return false;
}

function geoFromIpApi(data) {
  if (!data || data.status !== "success" || data.lat == null || data.lon == null) {
    return null;
  }
  const asnMatch = /^AS(\d+)/i.exec(data.as || "");
  return {
    lat: data.lat,
    lon: data.lon,
    city: data.city || data.regionName || "Unknown",
    region: data.regionName || "",
    country: data.countryCode || data.country || "??",
    private: false,
    org: data.org || data.asname || data.isp || null,
    as: data.as || null,
    asn: asnMatch ? asnMatch[1] : null,
    isp: data.isp || null,
  };
}

/**
 * Lookup a single public IP. Cache-first; external only on miss.
 */
export async function lookupIp(ip) {
  if (!ip || DISABLED) return null;
  ensureLoaded();

  const cached = getCached(ip);
  if (cached !== null && cached !== undefined) {
    return cached === false ? null : cached;
  }
  misses += 1;

  if (isPrivateIp(ip)) {
    const lan = {
      lat: null,
      lon: null,
      city: "LAN",
      region: "",
      country: "Local",
      private: true,
      org: "Private network",
      as: null,
      asn: null,
      isp: null,
    };
    setCache(ip, lan, POSITIVE_TTL_MS);
    return lan;
  }

  if (OFFLINE) {
    return null;
  }

  fetches += 1;
  try {
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,regionName,city,lat,lon,query,as,org,isp,asname`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
    });
    if (res.status === 429) return null;
    if (!res.ok) {
      setCache(ip, false, NEGATIVE_TTL_MS);
      return null;
    }
    const data = await res.json();
    const geo = geoFromIpApi(data);
    if (!geo) {
      setCache(ip, false, NEGATIVE_TTL_MS);
      return null;
    }
    setCache(ip, geo, POSITIVE_TTL_MS);
    return geo;
  } catch {
    try {
      fetches += 1;
      const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        setCache(ip, false, NEGATIVE_TTL_MS);
        return null;
      }
      const data = await res.json();
      if (!data.success || data.latitude == null) {
        setCache(ip, false, NEGATIVE_TTL_MS);
        return null;
      }
      const geo = {
        lat: data.latitude,
        lon: data.longitude,
        city: data.city || data.region || "Unknown",
        region: data.region || "",
        country: data.country_code || data.country || "??",
        private: false,
        org: data.connection?.org || data.connection?.isp || null,
        as: data.connection?.asn
          ? `AS${data.connection.asn} ${data.connection.org || ""}`.trim()
          : null,
        asn: data.connection?.asn ? String(data.connection.asn) : null,
        isp: data.connection?.isp || null,
      };
      setCache(ip, geo, POSITIVE_TTL_MS);
      return geo;
    } catch {
      setCache(ip, false, NEGATIVE_TTL_MS);
      return null;
    }
  }
}

/**
 * Batch lookup — cache first, then ip-api.com/batch for misses only.
 */
export async function lookupMany(ips, concurrency = 6) {
  if (DISABLED) {
    return new Map((ips || []).map((ip) => [ip, null]));
  }
  ensureLoaded();
  const unique = [...new Set((ips || []).filter(Boolean))];
  const result = new Map();
  const needFetch = [];

  for (const ip of unique) {
    if (isPrivateIp(ip)) {
      result.set(ip, await lookupIp(ip));
      continue;
    }
    const cached = getCached(ip);
    if (cached !== null && cached !== undefined) {
      result.set(ip, cached === false ? null : cached);
    } else {
      misses += 1;
      needFetch.push(ip);
    }
  }

  if (needFetch.length === 0 || OFFLINE) {
    for (const ip of needFetch) result.set(ip, null);
    return result;
  }

  for (let offset = 0; offset < needFetch.length; offset += 100) {
    const chunk = needFetch.slice(offset, offset + 100);
    try {
      fetches += 1;
      const res = await fetch(
        "http://ip-api.com/batch?fields=status,message,country,countryCode,regionName,city,lat,lon,query,as,org,isp,asname",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(chunk.map((query) => ({ query }))),
          signal: AbortSignal.timeout(12000),
        },
      );
      if (res.ok) {
        const arr = await res.json();
        if (Array.isArray(arr)) {
          for (let i = 0; i < chunk.length; i++) {
            const ip = chunk[i];
            const geo = geoFromIpApi(arr[i]);
            if (geo) {
              setCache(ip, geo, POSITIVE_TTL_MS);
              result.set(ip, geo);
            } else {
              result.set(ip, null);
            }
          }
          continue;
        }
      }
    } catch {
      // sequential fallback
    }

    let i = 0;
    async function worker() {
      while (i < chunk.length) {
        const idx = i++;
        const ip = chunk[idx];
        if (result.has(ip)) continue;
        result.set(ip, await lookupIp(ip));
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, chunk.length || 1) },
        () => worker(),
      ),
    );
  }

  return result;
}

export async function lookupSelf() {
  if (DISABLED) return null;
  ensureLoaded();
  const selfKey = "__self__";
  const cached = getCached(selfKey);
  if (cached && cached.lat != null) return cached;

  if (OFFLINE) return null;

  try {
    fetches += 1;
    const res = await fetch(
      "http://ip-api.com/json/?fields=status,country,countryCode,regionName,city,lat,lon,query,as,org,isp",
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) throw new Error("status");
    const data = await res.json();
    if (data.status !== "success") throw new Error("fail");
    const home = {
      lat: data.lat,
      lon: data.lon,
      city: data.city,
      region: data.regionName,
      country: data.countryCode || data.country,
      ip: data.query,
      label: [data.city, data.regionName, data.countryCode]
        .filter(Boolean)
        .join(", "),
      org: data.org || data.isp || null,
      as: data.as || null,
    };
    setCache(selfKey, home, POSITIVE_TTL_MS);
    return home;
  } catch {
    try {
      fetches += 1;
      const res = await fetch("https://ipwho.is/", {
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      if (!data.success) return null;
      const home = {
        lat: data.latitude,
        lon: data.longitude,
        city: data.city,
        region: data.region,
        country: data.country_code,
        ip: data.ip,
        label: [data.city, data.region, data.country_code]
          .filter(Boolean)
          .join(", "),
        org: data.connection?.org || null,
        as: data.connection?.asn ? `AS${data.connection.asn}` : null,
      };
      setCache(selfKey, home, POSITIVE_TTL_MS);
      return home;
    } catch {
      return null;
    }
  }
}

// Load at import so first poll is warm
ensureLoaded();

// Persist on exit
for (const sig of ["SIGINT", "SIGTERM", "beforeExit"]) {
  process.on(sig, () => {
    try {
      if (!dirty && cache.size === 0) return;
      dirty = true;
      const dir = path.dirname(CACHE_PATH);
      fs.mkdirSync(dir, { recursive: true });
      const entries = {};
      const t = now();
      for (const [ip, row] of cache) {
        if (row.expiresAt < t) continue;
        entries[ip] = { value: row.value, expiresAt: row.expiresAt };
      }
      fs.writeFileSync(
        CACHE_PATH,
        JSON.stringify({ version: 1, savedAt: t, entries }),
      );
    } catch {
      /* ignore */
    }
  });
}
