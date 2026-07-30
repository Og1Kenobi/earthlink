/** In-memory IP → geo cache (survives process lifetime). */
const cache = new Map();
const NEGATIVE_TTL_MS = 30 * 60 * 1000;
const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000;

function now() {
  return Date.now();
}

export function getCached(ip) {
  const hit = cache.get(ip);
  if (!hit) return null;
  if (hit.expiresAt < now()) {
    cache.delete(ip);
    return null;
  }
  return hit.value;
}

export function setCache(ip, value, ttl = POSITIVE_TTL_MS) {
  cache.set(ip, { value, expiresAt: now() + ttl });
}

/**
 * Lookup a single public IP. Returns null for private / failed.
 */
export async function lookupIp(ip) {
  if (!ip) return null;
  const cached = getCached(ip);
  if (cached !== null && cached !== undefined) {
    return cached === false ? null : cached;
  }

  // Private — synthetic LAN marker
  if (
    ip === "127.0.0.1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  ) {
    const lan = {
      lat: null,
      lon: null,
      city: "LAN",
      region: "",
      country: "Local",
      private: true,
    };
    setCache(ip, lan, POSITIVE_TTL_MS);
    return lan;
  }

  try {
    // ip-api free tier: non-HTTPS, 45 req/min — fine for connection churn
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,regionName,city,lat,lon,query`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      setCache(ip, false, NEGATIVE_TTL_MS);
      return null;
    }
    const data = await res.json();
    if (data.status !== "success" || data.lat == null || data.lon == null) {
      setCache(ip, false, NEGATIVE_TTL_MS);
      return null;
    }
    const geo = {
      lat: data.lat,
      lon: data.lon,
      city: data.city || data.regionName || "Unknown",
      region: data.regionName || "",
      country: data.countryCode || data.country || "??",
      private: false,
    };
    setCache(ip, geo, POSITIVE_TTL_MS);
    return geo;
  } catch {
    // Fallback provider
    try {
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
      };
      setCache(ip, geo, POSITIVE_TTL_MS);
      return geo;
    } catch {
      setCache(ip, false, NEGATIVE_TTL_MS);
      return null;
    }
  }
}

/** Batch lookup with simple concurrency limit. */
export async function lookupMany(ips, concurrency = 4) {
  const unique = [...new Set(ips.filter(Boolean))];
  const result = new Map();
  let i = 0;
  async function worker() {
    while (i < unique.length) {
      const idx = i++;
      const ip = unique[idx];
      result.set(ip, await lookupIp(ip));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, unique.length) }, () =>
      worker(),
    ),
  );
  return result;
}

/** This host's public IP geo (for the amber home pin on the server). */
export async function lookupSelf() {
  try {
    const res = await fetch("https://get.geojs.io/v1/ip/geo.json", {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const lat = Number(data.latitude);
    const lon = Number(data.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      lat,
      lon,
      city: data.city || "",
      region: data.region || "",
      country: data.country_code || data.country || "",
      ip: data.ip,
      label: [data.city, data.region, data.country_code || data.country]
        .filter(Boolean)
        .join(", "),
    };
  } catch {
    return null;
  }
}
