import { readEstablishedTcp, isPrivateIp } from "./connections.mjs";
import { lookupMany, lookupSelf } from "./geoip.mjs";

/**
 * Live traffic collector — polls sockets, geolocates remotes, tracks lifetimes.
 * Tracks both inbound and outbound established TCP.
 */
export function createTrafficCollector(options = {}) {
  const pollMs = options.pollMs ?? 1500;
  const lingerMs = options.lingerMs ?? 4500;
  const includePrivate = options.includePrivate ?? false;
  const maxConnections = options.maxConnections ?? 120;
  // inbound | outbound | both
  const directions =
    options.directions ?? process.env.EARTHLINK_DIRECTIONS ?? "both";

  /** @type {Map<string, object>} */
  const active = new Map();
  let home = null;
  let lastError = null;
  let pollCount = 0;
  let running = false;
  let timer = null;
  let polling = false;

  async function ensureHome() {
    if (home) return home;
    if (
      process.env.EARTHLINK_HOME_LAT != null &&
      process.env.EARTHLINK_HOME_LON != null
    ) {
      home = {
        lat: Number(process.env.EARTHLINK_HOME_LAT),
        lon: Number(process.env.EARTHLINK_HOME_LON),
        label: process.env.EARTHLINK_HOME_LABEL || "Server (configured)",
        source: "config",
        ip: process.env.EARTHLINK_HOME_IP || null,
      };
      return home;
    }
    const self = await lookupSelf();
    if (self) {
      home = {
        lat: self.lat,
        lon: self.lon,
        label: self.label || "This server",
        source: "ip",
        ip: self.ip,
        city: self.city,
        region: self.region,
        country: self.country,
      };
    }
    return home;
  }

  function directionAllowed(dir) {
    if (directions === "both" || directions === "all") return true;
    return directions === dir;
  }

  async function pollOnce() {
    if (polling) return;
    polling = true;
    pollCount += 1;
    const now = Date.now();
    try {
      await ensureHome();
      const socks = await readEstablishedTcp();
      lastError = null;

      const candidates = socks.filter((s) => {
        if (!directionAllowed(s.direction)) return false;
        if (includePrivate) return true;
        return !s.private && !isPrivateIp(s.remoteIp);
      });

      const geos = await lookupMany(candidates.map((s) => s.remoteIp));
      const seenKeys = new Set();

      for (const s of candidates) {
        const geo = geos.get(s.remoteIp);
        if (!geo || geo.private || geo.lat == null || geo.lon == null) continue;

        seenKeys.add(s.key);
        const existing = active.get(s.key);
        if (existing) {
          existing.lastSeen = now;
          existing.goneAt = null;
          existing.protocol = s.protocol;
          existing.remotePort = s.remotePort;
          existing.localPort = s.localPort;
          existing.direction = s.direction;
          existing.servicePort = s.servicePort;
          existing.displayPort = s.displayPort ?? s.servicePort;
        } else {
          active.set(s.key, {
            id: s.key,
            ip: s.remoteIp,
            city: geo.city,
            country: geo.country,
            region: geo.region,
            lat: geo.lat,
            lon: geo.lon,
            protocol: s.protocol,
            port: s.displayPort ?? s.servicePort ?? s.remotePort,
            remotePort: s.remotePort,
            localPort: s.localPort,
            localIp: s.localIp,
            direction: s.direction, // inbound | outbound
            servicePort: s.servicePort,
            bytes: 0,
            createdAt: now,
            lastSeen: now,
            goneAt: null,
            real: true,
          });
        }
      }

      for (const [key, conn] of active) {
        if (!seenKeys.has(key) && conn.goneAt == null) {
          conn.goneAt = now;
        }
      }

      for (const [key, conn] of active) {
        if (conn.goneAt != null && now - conn.goneAt > lingerMs) {
          active.delete(key);
        }
      }

      if (active.size > maxConnections) {
        const sorted = [...active.values()].sort((a, b) => {
          if ((a.goneAt != null) !== (b.goneAt != null)) {
            return a.goneAt != null ? -1 : 1;
          }
          return a.createdAt - b.createdAt;
        });
        while (active.size > maxConnections && sorted.length) {
          const drop = sorted.shift();
          if (drop) active.delete(drop.id);
        }
      }
    } catch (err) {
      lastError = String(err?.message ?? err);
    } finally {
      polling = false;
    }
  }

  function snapshot() {
    const now = Date.now();
    const connections = [...active.values()]
      .map((c) => {
        const live = c.goneAt == null;
        return {
          id: c.id,
          ip: c.ip,
          city: c.city,
          country: c.country,
          lat: c.lat,
          lon: c.lon,
          protocol: c.protocol,
          port: c.port,
          localPort: c.localPort,
          remotePort: c.remotePort,
          direction: c.direction || "outbound",
          servicePort: c.servicePort,
          bytes: c.bytes,
          createdAt: c.createdAt,
          lastSeen: c.lastSeen,
          goneAt: c.goneAt,
          live,
          real: true,
          serverNow: now,
          lingerMs,
          ttl: live ? 999_999 : lingerMs,
        };
      })
      .sort((a, b) => b.lastSeen - a.lastSeen);

    const live = connections.filter((c) => c.live);
    const inboundCount = live.filter((c) => c.direction === "inbound").length;
    const outboundCount = live.filter((c) => c.direction === "outbound").length;

    return {
      ok: true,
      mode: "real",
      pollCount,
      pollMs,
      lingerMs,
      error: lastError,
      home,
      connections,
      activeCount: live.length,
      inboundCount,
      outboundCount,
      totalTracked: connections.length,
      serverTime: now,
      hostname: process.env.EARTHLINK_HOSTNAME || undefined,
      listenHint: process.env.EARTHLINK_LISTEN || "0.0.0.0:8080",
    };
  }

  function start() {
    if (running) return;
    running = true;
    void pollOnce();
    timer = setInterval(() => void pollOnce(), pollMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    running = false;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, pollOnce, snapshot, ensureHome };
}
