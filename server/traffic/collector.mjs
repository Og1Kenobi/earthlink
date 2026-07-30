import { readAllConnections, isPrivateIp, platformId } from "./connections.mjs";
import { lookupMany, lookupSelf } from "./geoip.mjs";
import { loadProcessMap, resolveProcess } from "./process.mjs";
import { loadLocalIpIfaces, parseIfaceFilter } from "./ifaces.mjs";
import { createAccessLogWatcher } from "./access-log.mjs";
import { osLabel } from "./platforms/index.mjs";

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
  process.env.COMPUTERNAME ||
  "local";

const LOCAL_OS = platformId();

/** Stable jitter near home so LAN peers are visible on the globe. */
function privateGeoNearHome(ip, home) {
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = (h * 33 + ip.charCodeAt(i)) | 0;
  const a = ((h % 360) + 360) % 360;
  const rad = (a * Math.PI) / 180;
  const ring = 0.08 + (Math.abs(h) % 50) * 0.004;
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
 * Live traffic collector — multi-OS local + remote agents.
 */
export function createTrafficCollector(options = {}) {
  const pollMs = options.pollMs ?? Number(process.env.EARTHLINK_POLL_MS || 1000);
  const lingerMs =
    options.lingerMs ?? Number(process.env.EARTHLINK_LINGER_MS || 6000);
  let includePrivate =
    options.includePrivate ?? process.env.EARTHLINK_INCLUDE_PRIVATE === "1";
  const maxConnections = options.maxConnections ?? 200;
  const directions =
    options.directions ?? process.env.EARTHLINK_DIRECTIONS ?? "both";
  const ifaceFilter = parseIfaceFilter(
    options.ifaces ?? process.env.EARTHLINK_IFACES,
  );
  const historyMax = Number(process.env.EARTHLINK_HISTORY_MAX || 4000);
  const historyKeepMs = Number(
    process.env.EARTHLINK_HISTORY_MS || 45 * 60 * 1000,
  );
  const agentToken = process.env.EARTHLINK_AGENT_TOKEN || "";
  const agentStaleMs = Number(process.env.EARTHLINK_AGENT_STALE_MS || 15000);

  const mutedIps = parseMuteEnv();
  /** @type {Map<string, object>} */
  const active = new Map();
  /** @type {Array<object>} */
  const history = [];
  /** @type {Map<string, object>} remote agents last seen */
  const remoteAgents = new Map();

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

  function upsertSocketRow(s, geo, now, hostId, os) {
    if (isMuted(s.remoteIp)) return null;
    if (!directionAllowed(s.direction)) return null;

    const isPriv = Boolean(s.private || isPrivateIp(s.remoteIp));
    let g = geo;
    if (isPriv) {
      if (!includePrivate) return null;
      g = privateGeoNearHome(s.remoteIp, home);
    } else if (!g || g.lat == null || g.lon == null) {
      return null;
    }

    const proc = resolveProcess(s, processMap);
    const logHit = hostId === HOST_ID ? accessLog.lookup(s.remoteIp) : null;
    const bytes = Number(s.bytes) || 0;
    const fullKey = `${hostId}|${s.key}`;

    const existing = active.get(fullKey);
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
      existing.process = s.process || proc?.process || existing.process || null;
      existing.pid = s.pid ?? proc?.pid ?? existing.pid ?? null;
      existing.org = g.org ?? existing.org;
      existing.as = g.as ?? existing.as;
      existing.asn = g.asn ?? existing.asn;
      existing.isp = g.isp ?? existing.isp;
      existing.iface = s.iface ?? existing.iface;
      existing.isPrivate = isPriv;
      existing.city = g.city;
      existing.country = g.country;
      existing.lat = g.lat;
      existing.lon = g.lon;
      existing.hostId = hostId;
      existing.os = os;
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
      const dBytes = Math.max(0, (existing.bytes || 0) - (existing._prevBytes || 0));
      existing.bytesPerSec = dBytes / dt;
      existing._prevBytes = existing.bytes;
      existing._rateAt = now;
      return fullKey;
    }

    const row = {
      id: fullKey,
      ip: s.remoteIp,
      city: g.city,
      country: g.country,
      region: g.region,
      lat: g.lat,
      lon: g.lon,
      org: g.org || null,
      as: g.as || null,
      asn: g.asn || null,
      isp: g.isp || null,
      protocol: s.protocol,
      port: s.displayPort ?? s.servicePort ?? s.remotePort,
      remotePort: s.remotePort,
      localPort: s.localPort,
      localIp: s.localIp,
      direction: s.direction,
      servicePort: s.servicePort,
      transport: s.transport || "tcp",
      process: s.process || proc?.process || null,
      pid: s.pid ?? proc?.pid ?? null,
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
      hostId,
      os,
    };
    active.set(fullKey, row);
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
      hostId,
      os,
      isPrivate: isPriv,
    });
    return fullKey;
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
        const geo = isPriv ? null : geos.get(s.remoteIp);
        const k = upsertSocketRow(s, geo, now, HOST_ID, LOCAL_OS);
        if (k) seenKeys.add(k);
      }

      // mark local gone
      for (const [key, conn] of active) {
        if (conn.hostId !== HOST_ID) continue;
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
            hostId: conn.hostId,
            os: conn.os,
            isPrivate: conn.isPrivate,
          });
        }
      }

      // expire remote agents that went silent
      for (const [id, ag] of remoteAgents) {
        if (now - ag.lastSeen > agentStaleMs) {
          for (const [k, c] of active) {
            if (c.hostId === id && c.goneAt == null) c.goneAt = now;
          }
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

  /**
   * Ingest sockets from a remote OS agent (Windows / macOS / Linux edge).
   * body: { hostId, os, token?, sockets: [{remoteIp, localIp, ...}] }
   */
  async function ingestRemote(body = {}) {
    if (agentToken) {
      if (body.token !== agentToken) {
        const err = new Error("invalid agent token");
        err.status = 401;
        throw err;
      }
    }
    const hostId = String(body.hostId || body.hostname || "agent").slice(0, 64);
    const os = String(body.os || body.platform || "unknown").slice(0, 32);
    const now = Date.now();
    await ensureHome();

    const sockets = Array.isArray(body.sockets) ? body.sockets : [];
    const publicIps = sockets
      .map((s) => s.remoteIp)
      .filter((ip) => ip && !isPrivateIp(ip));
    const geos = await lookupMany(publicIps);
    const seenKeys = new Set();

    for (const raw of sockets) {
      if (!raw?.remoteIp) continue;
      const s = {
        key:
          raw.key ||
          `${raw.transport || "tcp"}|${raw.remoteIp}|${raw.remotePort || 0}|${raw.localIp || "?"}|${raw.localPort || 0}`,
        transport: raw.transport || "tcp",
        localIp: raw.localIp || "0.0.0.0",
        localPort: Number(raw.localPort) || 0,
        remoteIp: raw.remoteIp,
        remotePort: Number(raw.remotePort) || 0,
        direction: raw.direction || "outbound",
        protocol: raw.protocol,
        servicePort: raw.servicePort,
        displayPort: raw.displayPort,
        private: raw.private ?? isPrivateIp(raw.remoteIp),
        process: raw.process || null,
        pid: raw.pid ?? null,
        iface: raw.iface || null,
        bytes: raw.bytes || 0,
      };
      // enrich protocol if missing
      if (!s.protocol) {
        const { enrichSocket } = await import("./connections.mjs");
        Object.assign(s, enrichSocket(s, new Set()));
      }
      const isPriv = Boolean(s.private);
      const geo = isPriv ? null : geos.get(s.remoteIp);
      const k = upsertSocketRow(s, geo, now, hostId, os);
      if (k) seenKeys.add(k);
    }

    // mark missing remote as gone
    for (const [key, conn] of active) {
      if (conn.hostId !== hostId) continue;
      if (!seenKeys.has(key) && conn.goneAt == null) {
        conn.goneAt = now;
      }
    }

    remoteAgents.set(hostId, {
      hostId,
      os,
      osLabel: osLabel(os),
      lastSeen: now,
      socketCount: seenKeys.size,
      hostname: body.hostname || null,
      arch: body.arch || null,
      node: body.node || null,
    });

    return {
      ok: true,
      hostId,
      accepted: seenKeys.size,
      agents: listAgents(),
    };
  }

  function listAgents() {
    const now = Date.now();
    const local = {
      hostId: HOST_ID,
      os: LOCAL_OS,
      osLabel: osLabel(LOCAL_OS),
      lastSeen: now,
      local: true,
      socketCount: [...active.values()].filter(
        (c) => c.hostId === HOST_ID && c.goneAt == null,
      ).length,
    };
    const remotes = [...remoteAgents.values()].map((a) => ({
      ...a,
      stale: now - a.lastSeen > agentStaleMs,
      local: false,
    }));
    return [local, ...remotes];
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
          os: c.os || LOCAL_OS,
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
        hostId: c.hostId,
        os: c.os,
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
      os: LOCAL_OS,
      osLabel: osLabel(LOCAL_OS),
      agents: listAgents(),
      includePrivate,
      ifaces: ifaceFilter ? [...ifaceFilter] : null,
      accessLog: accessLog.path || null,
      serverTime: now,
      hostname:
        process.env.EARTHLINK_HOSTNAME ||
        process.env.HOSTNAME ||
        process.env.COMPUTERNAME ||
        undefined,
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
    ingestRemote,
    listAgents,
    hostId: HOST_ID,
    os: LOCAL_OS,
  };
}
