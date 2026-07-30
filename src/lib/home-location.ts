export type HomeSource = "ip" | "geo" | "default" | "manual" | "cached" | "config";

export type ResolvedHome = {
  lat: number;
  lon: number;
  label: string;
  city?: string;
  region?: string;
  country?: string;
  ip?: string;
  source: HomeSource;
  accuracyM?: number;
};

const STORAGE_KEY = "earthlink.home.v1";

function withTimeout(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(ms);
  }
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

export function loadCachedHome(): ResolvedHome | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResolvedHome;
    if (
      typeof parsed.lat !== "number" ||
      typeof parsed.lon !== "number" ||
      !Number.isFinite(parsed.lat) ||
      !Number.isFinite(parsed.lon)
    ) {
      return null;
    }
    return { ...parsed, source: "cached" };
  } catch {
    return null;
  }
}

export function saveCachedHome(home: ResolvedHome): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...home,
        source: home.source === "cached" ? "ip" : home.source,
      }),
    );
  } catch {
    // ignore quota / private mode
  }
}

function labelFromParts(parts: {
  city?: string;
  region?: string;
  country?: string;
}): string {
  const bits = [parts.city, parts.region, parts.country].filter(Boolean);
  return bits.length ? bits.join(", ") : "Your machine";
}

async function resolveFromGeoJs(): Promise<ResolvedHome | null> {
  const res = await fetch("https://get.geojs.io/v1/ip/geo.json", {
    signal: withTimeout(8000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    latitude?: string;
    longitude?: string;
    city?: string;
    region?: string;
    country?: string;
    country_code?: string;
    ip?: string;
  };
  const lat = Number(data.latitude);
  const lon = Number(data.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    city: data.city,
    region: data.region,
    country: data.country_code || data.country,
    ip: data.ip,
    label: labelFromParts({
      city: data.city,
      region: data.region,
      country: data.country_code || data.country,
    }),
    source: "ip",
  };
}

/** Approximate from timezone when IP geo is blocked. */
function resolveFromTimezone(): ResolvedHome | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const TZ_MAP: Record<string, { lat: number; lon: number; label: string }> =
      {
        "America/New_York": {
          lat: 40.7128,
          lon: -74.006,
          label: "Eastern US (timezone)",
        },
        "America/Chicago": {
          lat: 41.8781,
          lon: -87.6298,
          label: "Central US (timezone)",
        },
        "America/Denver": {
          lat: 39.7392,
          lon: -104.9903,
          label: "Mountain US (timezone)",
        },
        "America/Los_Angeles": {
          lat: 34.0522,
          lon: -118.2437,
          label: "Pacific US (timezone)",
        },
        "America/Toronto": {
          lat: 43.6532,
          lon: -79.3832,
          label: "Toronto area (timezone)",
        },
        "Europe/London": {
          lat: 51.5074,
          lon: -0.1278,
          label: "London area (timezone)",
        },
        "Europe/Paris": {
          lat: 48.8566,
          lon: 2.3522,
          label: "Paris area (timezone)",
        },
        "Europe/Berlin": {
          lat: 52.52,
          lon: 13.405,
          label: "Berlin area (timezone)",
        },
        "Asia/Tokyo": {
          lat: 35.6762,
          lon: 139.6503,
          label: "Tokyo area (timezone)",
        },
        "Asia/Shanghai": {
          lat: 31.2304,
          lon: 121.4737,
          label: "Shanghai area (timezone)",
        },
        "Asia/Kolkata": {
          lat: 19.076,
          lon: 72.8777,
          label: "Mumbai area (timezone)",
        },
        "Australia/Sydney": {
          lat: -33.8688,
          lon: 151.2093,
          label: "Sydney area (timezone)",
        },
      };
    const hit = tz ? TZ_MAP[tz] : undefined;
    if (!hit) return null;
    return {
      lat: hit.lat,
      lon: hit.lon,
      label: hit.label,
      source: "ip",
    };
  } catch {
    return null;
  }
}

/** IP-based home — uses the visitor's public IP from their browser. */
export async function resolveHomeFromIp(): Promise<ResolvedHome | null> {
  try {
    const geo = await resolveFromGeoJs();
    if (geo) return geo;
  } catch {
    // fall through
  }
  return resolveFromTimezone();
}

export function resolveHomeFromGps(
  timeoutMs = 10000,
): Promise<ResolvedHome | null> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          label: "Your machine (GPS)",
          source: "geo",
          accuracyM: pos.coords.accuracy,
        });
      },
      () => resolve(null),
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 120_000,
      },
    );
  });
}

export async function resolveHomeLocation(opts?: {
  preferGps?: boolean;
  onUpdate?: (home: ResolvedHome) => void;
}): Promise<ResolvedHome | null> {
  const cached = loadCachedHome();
  if (cached) opts?.onUpdate?.(cached);

  const ipHome = await resolveHomeFromIp();
  if (ipHome) {
    opts?.onUpdate?.(ipHome);
    saveCachedHome(ipHome);
  }

  if (opts?.preferGps !== false) {
    const gps = await resolveHomeFromGps();
    if (gps) {
      const merged: ResolvedHome = {
        ...gps,
        label:
          ipHome?.city != null
            ? `${ipHome.city}${ipHome.region ? `, ${ipHome.region}` : ""} (GPS)`
            : gps.label,
        city: ipHome?.city ?? gps.city,
        region: ipHome?.region ?? gps.region,
        country: ipHome?.country ?? gps.country,
        ip: ipHome?.ip,
        source: "geo",
      };
      opts?.onUpdate?.(merged);
      saveCachedHome(merged);
      return merged;
    }
  }

  return ipHome ?? cached;
}
