import { readAllConnections, isPrivateIp } from "./connections.mjs";
import { lookupMany, lookupSelf } from "./geoip.mjs";
import { loadProcessMap, resolveProcess } from "./process.mjs";
import { loadLocalIpIfaces, parseIfaceFilter } from "./ifaces.mjs";
import { createAccessLogWatcher } from "./access-log.mjs";

function parseMuteEnv() {
  const raw = process.env.EARTHLINK_MUTE_IPS || "";
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

const HOST_ID =
  process.env.EARTHLINK_HOST_ID ||
  process.env.EARTHLINK_HOSTNAME ||
  process.env.HOSTNAME ||
  "local";

/** Stable jitter near home so LAN peers are visible on the globe. */
function privateGeoNearHome(ip, home) {
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = (h * 33 + ip.charCodeAt(i)) | 0;
  const a = ((h % 360) + 360) % 360;
  const rad = (a * Math.PI) / 180;
  const ring = 0.08 + (Math.abs(h) % 50) * 0.004; // ~0.08–0.28°
  const baseLat = home?.lat ?? 0;
  const baseLon = home?.lon ?? 0;
  const subnet =
    ip.startsWith("10.")
      ? "10.x"
      : ip.startsWith("192.168.")
        ? "192.168.x"
        : /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
          ? "172.16–31.x"
          : "private";
  return {
    lat: baseLat + Math.sin(rad) * ring,
    lon: baseLon + Math.cos(rad) * ring,
    city: "LAN",
    country: "Local",
    region: subnet,
    private: true,
    org: `Private · ${subnet}`,
    as: null,
    asn: null,
    isp: null,
  };
}

/**
 * Live traffic collector — full NOC data:
 * process names, ASN/org, bytes, iface filter, access-log correlate, event history.
 */
export function createTrafficCollector(options = {}) {
  const pollMs = options.pollMs ?? Number(process.env.EARTHLINK_POLL_MS || 1000);
  const lingerMs =
    options.lingerMs ?? Number(process.env.EARTHLINK_LINGER_MS || 6000);
  /** Runtime toggle (env is initial default). */
  let includePrivate =
    options.includePrivate ?? process.env.EARTHLINK_INCLUDE_PRIVATE === "1";
  const maxConnections = options.maxConnections ?? 160;
  const directions =
    options.directions ?? process.env.EARTHLINK_DIRECTIONS ?? "both";
  const ifaceFilter = parseIfaceFilter(
    options.ifaces ?? process.env.EARTHLINK_IFACES,
  );
  const historyMax = Number(process.env.EARTHLINK_HISTORY_MAX || 4000);
  const historyKeepMs = Number(
    process.env.EARTHLINK_HISTORY_MS || 45 * 60 * 1000,
  );

  const mutedIps = parseMuteEnv();
  /** @type {Map<string, object>} */
  const active = new Map();
  /** @type {Array<object>} ring of connection events for replay */
  const history = [];
  let home = null;
  let lastError = null;
  let pollCount = 0;
  let running = false;
  let timer = null;
  let polling = false;
  let lastSources = { tcp: 0, udp: 0, icmp: 0 };
  let processMap = new Map();
  let ifaceMap = new Map();
  let processRefreshAt = 0;

  const accessLog = createAccessLogWatcher();

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
        org: self.org,
        as: self.as,
      };
    }
    return home;
  }

  function directionAllowed(dir) {
    if (directions === "both" || directions === "all") return true;
    return directions === dir;
  }

  function isMuted(ip) {
    return mutedIps.has(ip);
  }

  function muteIp(ip) {
    const clean = String(ip || "").trim();
    if (!clean) return false;
    mutedIps.add(clean);
    for (const [k, v] of active) {
      if (v.ip === clean) active.delete(k);
    }
    return true;
  }

  function unmuteIp(ip) {
    return mutedIps.delete(String(ip || "").trim());
  }

  function listMuted() {
    return [...mutedIps].sort();
  }

  function getIncludePrivate() {
    return includePrivate;
  }

  function setIncludePrivate(on) {
    includePrivate = Boolean(on);
    if (!includePrivate) {
      // drop private rows immediately
      for (const [k, v] of active) {
        if (v.isPrivate || isPrivateIp(v.ip)) active.delete(k);
      }
    }
    return includePrivate;
  }

  function pushHistory(ev) {
    history.push(ev);
    const cutoff = Date.now() - historyKeepMs;
    while (history.length && history[0].at < cutoff) history.shift();
    while (history.length > historyMax) history.shift();
  }

  async function refreshSideData(now) {
    if (now - processRefreshAt > 4000) {
      processRefreshAt = now;
      try {
        processMap = await loadProcessMap();
      } catch {
        // ignore
      }
      try {
        ifaceMap = await loadLocalIpIfaces();
      } catch {
        // ignore
      }
    }
  }

  async function pollOnce() {
    if (polling) return;
    polling = true;
    pollCount += 1;
    const now = Date.now();
    try {
      await ensureHome();
      await refreshSideData(now);
      const socks = await readAllConnections();
      lastError = null;

      lastSources = { tcp: 0, udp: 0, icmp: 0 };
      for (const s of socks) {
        const t = s.transport || "tcp";
        if (t === "udp") lastSources.udp += 1;
        else if (t === "icmp") lastSources.icmp += 1;
        else lastSources.tcp += 1;
      }

      const candidates = socks.filter((s) => {
        if (isMuted(s.remoteIp)) return false;
        if (!directionAllowed(s.direction)) return false;
        if (ifaceFilter && ifaceFilter.size) {
          const iface = ifaceMap.get(s.localIp) || "unknown";
          s.iface = iface;
          if (!ifaceFilter.has(iface) && !ifaceFilter.has("*")) return false;
        } else {
          s.iface = ifaceMap.get(s.localIp) || null;
        }
        if (includePrivate) return true;
        return !s.private && !isPrivateIp(s.remoteIp);
      });

      const publicIps = candidates
        .filter((s) => !s.private && !isPrivateIp(s.remoteIp))
        .map((s) => s.remoteIp);
      const geos = await lookupMany(publicIps);
      const seenKeys = new Set();

      for (const s of candidates) {
        const isPriv = Boolean(s.private || isPrivateIp(s.remoteIp));
        let geo = geos.get(s.remoteIp);
        if (isPriv) {
          if (!includePrivate) continue;
          geo = privateGeoNearHome(s.remoteIp, home);
        } else if (!geo || geo.lat == null || geo.lon == null) {
          continue;
        }

        const proc = resolveProcess(s, processMap);
        const logHit = accessLog.lookup(s.remoteIp);
        const bytes = Number(s.bytes) || 0;

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
          existing.transport = s.transport || "tcp";
          existing.process = proc?.process ?? existing.process ?? null;
          existing.pid = proc?.pid ?? existing.pid ?? null;
          existing.org = geo.org ?? existing.org;
          existing.as = geo.as ?? existing.as;
          existing.asn = geo.asn ?? existing.asn;
          existing.isp = geo.isp ?? existing.isp;
          existing.iface = s.iface ?? existing.iface;
          existing.isPrivate = isPriv;
          existing.city = geo.city;
          existing.country = geo.country;
          existing.lat = geo.lat;
          existing.lon = geo.lon;
          existing.bytes = Math.max(existing.bytes || 0, bytes);
          if (logHit) {
            existing.httpPath = logHit.path;
            existing.httpMethod = logHit.method;
            existing.httpStatus = logHit.status;
          }
          const dt = Math.max(
            0.001,
            (now - (existing._rateAt || existing.createdAt)) / 1000,
          );
          const dBytes = Math.max(
            0,
            (existing.bytes || 0) - (existing._prevBytes || 0),
          );
          existing.bytesPerSec = dBytes / dt;
          existing._prevBytes = existing.bytes;
          existing._rateAt = now;
        } else {
          const transport = s.transport || "tcp";
          const row = {
            id: s.key,
            ip: s.remoteIp,
            city: geo.city,
            country: geo.country,
            region: geo.region,
            lat: geo.lat,
            lon: geo.lon,
            org: geo.org || null,
            as: geo.as || null,
            asn: geo.asn || null,
            isp: geo.isp || null,
            protocol: s.protocol,
            port: s.displayPort ?? s.servicePort ?? s.remotePort,
            remotePort: s.remotePort,
            localPort: s.localPort,
            localIp: s.localIp,
            direction: s.direction,
            servicePort: s.servicePort,
            transport,
            process: proc?.process || null,
            pid: proc?.pid || null,
            iface: s.iface || null,
            httpPath: logHit?.path || null,
            httpMethod: logHit?.method || null,
            httpStatus: logHit?.status || null,
            isPrivate: isPriv,
            bytes,
            bytesPerSec: 0,
            _prevBytes: bytes,
            _rateAt: now,
            createdAt: now,
            lastSeen: now,
            goneAt: null,
            real: true,
            hostId: HOST_ID,
          };
          active.set(s.key, row);
          pushHistory({
            type: "open",
            at: now,
            id: row.id,
            ip: row.ip,
            city: row.city,
            country: row.country,
            lat: row.lat,
            lon: row.lon,
            protocol: row.protocol,
            port: row.port,
            direction: row.direction,
            process: row.process,
            org: row.org,
            asn: row.asn,
            hostId: HOST_ID,
            isPrivate: isPriv,
          });
        }
      }

      for (const [key, conn] of active) {
        if (!seenKeys.has(key) && conn.goneAt == null) {
          conn.goneAt = now;
          pushHistory({
            type: "close",
            at: now,
            id: conn.id,
            ip: conn.ip,
            city: conn.city,
            country: conn.country,
            lat: conn.lat,
            lon: conn.lon,
            protocol: conn.protocol,
            port: conn.port,
            direction: conn.direction,
            process: conn.process,
            org: conn.org,
            asn: conn.asn,
            hostId: HOST_ID,
            isPrivate: conn.isPrivate,
          });
        }
      }

      for (const [key, conn] of active) {
        const extra =
          conn.transport === "udp" || conn.transport === "icmp" ? 2500 : 0;
        if (conn.goneAt != null && now - conn.goneAt > lingerMs + extra) {
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
        const linger =
          c.transport === "udp" || c.transport === "icmp"
            ? lingerMs + 2500
            : lingerMs;
        return {
          id: c.id,
          ip: c.ip,
          city: c.city,
          country: c.country,
          region: c.region,
          lat: c.lat,
          lon: c.lon,
          org: c.org,
          as: c.as,
          asn: c.asn,
          isp: c.isp,
          protocol: c.protocol,
          port: c.port,
          localPort: c.localPort,
          remotePort: c.remotePort,
          direction: c.direction || "outbound",
          servicePort: c.servicePort,
          transport: c.transport || "tcp",
          process: c.process,
          pid: c.pid,
          iface: c.iface,
          httpPath: c.httpPath,
          httpMethod: c.httpMethod,
          httpStatus: c.httpStatus,
          isPrivate: Boolean(c.isPrivate),
          bytes: c.bytes || 0,
          bytesPerSec: c.bytesPerSec || 0,
          createdAt: c.createdAt,
          lastSeen: c.lastSeen,
          goneAt: c.goneAt,
          live,
          real: true,
          hostId: c.hostId || HOST_ID,
          serverNow: now,
          lingerMs: linger,
          ttl: live ? 999_999 : linger,
        };
      })
      .sort((a, b) => b.lastSeen - a.lastSeen);

    const live = connections.filter((c) => c.live);
    const inboundCount = live.filter((c) => c.direction === "inbound").length;
    const outboundCount = live.filter((c) => c.direction === "outbound").length;

    const topTalkers = [...live]
      .sort(
        (a, b) =>
          (b.bytesPerSec || 0) - (a.bytesPerSec || 0) ||
          (b.bytes || 0) - (a.bytes || 0),
      )
      .slice(0, 12)
      .map((c) => ({
        ip: c.ip,
        city: c.city,
        country: c.country,
        org: c.org,
        protocol: c.protocol,
        process: c.process,
        bytes: c.bytes,
        bytesPerSec: c.bytesPerSec,
        direction: c.direction,
        isPrivate: c.isPrivate,
      }));

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
      sources: lastSources,
      mutedIps: listMuted(),
      topTalkers,
      hostId: HOST_ID,
      includePrivate,
      ifaces: ifaceFilter ? [...ifaceFilter] : null,
      accessLog: accessLog.path || null,
      serverTime: now,
      hostname:
        process.env.EARTHLINK_HOSTNAME || process.env.HOSTNAME || undefined,
      listenHint: process.env.EARTHLINK_LISTEN || "0.0.0.0:8080",
    };
  }

  function getHistory(sinceMs = 0) {
    const since = sinceMs > 0 ? sinceMs : Date.now() - historyKeepMs;
    return history.filter((e) => e.at >= since);
  }

  function start() {
    if (running) return;
    running = true;
    accessLog.start();
    void pollOnce();
    timer = setInterval(() => void pollOnce(), pollMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    running = false;
    accessLog.stop();
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    start,
    stop,
    pollOnce,
    snapshot,
    ensureHome,
    muteIp,
    unmuteIp,
    listMuted,
    isMuted,
    getHistory,
    getIncludePrivate,
    setIncludePrivate,
    hostId: HOST_ID,
  };
}
