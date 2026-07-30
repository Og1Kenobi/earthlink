/** In-memory IP → geo cache (survives process lifetime). */
const cache = new Map();
const NEGATIVE_TTL_MS = 5 * 60 * 1000; // short — rate-limits recover
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
 * Lookup a single public IP. Returns null for private / failed.
 */
export async function lookupIp(ip) {
  if (!ip) return null;
  const cached = getCached(ip);
  if (cached !== null && cached !== undefined) {
    return cached === false ? null : cached;
  }

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

  try {
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,regionName,city,lat,lon,query,as,org,isp,asname`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
    });
    if (res.status === 429) {
      // rate limited — do NOT long-negative-cache
      return null;
    }
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
 * Batch lookup. Uses ip-api.com/batch (up to 100) when possible so agent
 * ingest of 50–100 sockets does not get rate-limited to nothing.
 */
export async function lookupMany(ips, concurrency = 6) {
  const unique = [...new Set(ips.filter(Boolean))];
  const result = new Map();
  const needFetch = [];

  for (const ip of unique) {
    if (isPrivateIp(ip)) {
      const lan = await lookupIp(ip);
      result.set(ip, lan);
      continue;
    }
    const cached = getCached(ip);
    if (cached !== null && cached !== undefined) {
      result.set(ip, cached === false ? null : cached);
    } else {
      needFetch.push(ip);
    }
  }

  // Batch in chunks of 100
  for (let offset = 0; offset < needFetch.length; offset += 100) {
    const chunk = needFetch.slice(offset, offset + 100);
    try {
      const res = await fetch("http://ip-api.com/batch?fields=status,message,country,countryCode,regionName,city,lat,lon,query,as,org,isp,asname", {
        method: "POST",
        headers: { "content-type": "application/json", Accept: "application/json" },
        body: JSON.stringify(chunk.map((query) => ({ query }))),
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) {
        const arr = await res.json();
        if (Array.isArray(arr)) {
          for (let i = 0; i < chunk.length; i++) {
            const ip = chunk[i];
            const data = arr[i];
            const geo = geoFromIpApi(data);
            if (geo) {
              setCache(ip, geo, POSITIVE_TTL_MS);
              result.set(ip, geo);
            } else {
              // soft fail — leave uncached so next poll retries
              result.set(ip, null);
            }
          }
          continue;
        }
      }
    } catch {
      // fall through to sequential
    }

    // Sequential fallback with low concurrency
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
