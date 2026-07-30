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
 * Includes ASN/org when the provider supplies it.
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
      org: "Private network",
      as: null,
      asn: null,
      isp: null,
    };
    setCache(ip, lan, POSITIVE_TTL_MS);
    return lan;
  }

  try {
    // ip-api free tier: non-HTTPS, 45 req/min — includes as/org/isp
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,regionName,city,lat,lon,query,as,org,isp,asname`;
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
    const asnMatch = /^AS(\d+)/i.exec(data.as || "");
    const geo = {
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
  const workers = Array.from(
    { length: Math.min(concurrency, unique.length || 1) },
    () => worker(),
  );
  await Promise.all(workers);
  return result;
}

export async function lookupSelf() {
  try {
    const res = await fetch(
      "http://ip-api.com/json/?fields=status,country,countryCode,regionName,city,lat,lon,query,as,org,isp",
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) throw new Error("status");
    const data = await res.json();
    if (data.status !== "success") throw new Error("fail");
    return {
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
  } catch {
    try {
      const res = await fetch("https://ipwho.is/", {
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      if (!data.success) return null;
      return {
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
    } catch {
      return null;
    }
  }
}
