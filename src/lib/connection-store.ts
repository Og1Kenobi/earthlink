import { create } from "zustand";
import {
  DEFAULT_HOME,
  fakeIp,
  randomProtocol,
  randomRemoteCity,
  type City,
} from "./locations";
import { haversineKm } from "./geo";
import type { HomeSource } from "./home-location";
import { playConnectionBlip, setFxAudioEnabled } from "./fx-audio";
import {
  isIpMuted,
  loadMutedPeers,
  normalizeIpInput,
  saveMutedPeers,
  type MutedPeer,
} from "./mute-list";

export type TrafficDirection = "inbound" | "outbound";

export type SecurityPreset = "all" | "security" | "web" | "noise-off";

export type Connection = {
  id: string;
  ip: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  protocol: string;
  port: number;
  bytes: number;
  bytesPerSec?: number;
  createdAt: number;
  ttl: number;
  distanceKm: number;
  real?: boolean;
  live?: boolean;
  direction?: TrafficDirection;
  impactAt?: number;
  org?: string | null;
  as?: string | null;
  asn?: string | null;
  process?: string | null;
  pid?: number | null;
  iface?: string | null;
  httpPath?: string | null;
  httpMethod?: string | null;
  hostId?: string;
  transport?: string;
};

export type TrafficEvent = {
  id: string;
  at: number;
  text: string;
  direction: TrafficDirection;
  protocol: string;
  city: string;
  country: string;
  ip: string;
  process?: string | null;
  org?: string | null;
};

export type AlertItem = {
  id: string;
  at: number;
  level: "info" | "warn" | "danger";
  text: string;
};

export type HistoryEvent = {
  type: "open" | "close";
  at: number;
  id: string;
  ip: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  protocol: string;
  port: number;
  direction: TrafficDirection;
  process?: string | null;
  org?: string | null;
  asn?: string | null;
  hostId?: string;
};

export type TrailPoint = {
  id: string;
  lat: number;
  lon: number;
  color: string;
  born: number;
  ttl: number;
  direction: TrafficDirection;
};

export type Home = {
  lat: number;
  lon: number;
  label: string;
  source: HomeSource;
  city?: string;
  region?: string;
  country?: string;
  ip?: string;
  accuracyM?: number;
  org?: string;
};

export type TrafficMode = "real" | "demo" | "connecting";

export type TopTalker = {
  ip: string;
  city: string;
  country: string;
  org?: string | null;
  protocol: string;
  process?: string | null;
  bytes: number;
  bytesPerSec: number;
  direction: string;
};

type RealRow = {
  id: string;
  ip: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  protocol: string;
  port: number;
  live: boolean;
  lingerMs?: number;
  direction?: TrafficDirection;
  org?: string | null;
  as?: string | null;
  asn?: string | null;
  process?: string | null;
  pid?: number | null;
  iface?: string | null;
  httpPath?: string | null;
  httpMethod?: string | null;
  bytes?: number;
  bytesPerSec?: number;
  hostId?: string;
  transport?: string;
};

const CDN_ORGS =
  /cloudflare|akamai|fastly|amazon|aws|google|microsoft|azure|digitalocean|linode|ovh|hetzner|cdn/i;
const NOISE_PROTO = /^(DNS|NTP|PING|ICMP|QUIC)$/i;
const SECURITY_PORTS = new Set([22, 23, 3389, 5900, 445, 21, 3306, 5432, 27017]);

type State = {
  home: Home;
  homeReady: boolean;
  connections: Connection[];
  totalSeen: number;
  paused: boolean;
  intensity: "calm" | "normal" | "busy";
  mode: TrafficMode;
  agentError: string | null;
  agentActiveCount: number;
  inboundCount: number;
  outboundCount: number;
  mutedActiveCount: number;
  events: TrafficEvent[];
  selectedId: string | null;
  soundEnabled: boolean;
  mutedPeers: MutedPeer[];
  activityHistory: number[];
  topTalkers: TopTalker[];
  hostId: string | null;
  securityPreset: SecurityPreset;
  kiosk: boolean;
  alerts: AlertItem[];
  alertsEnabled: boolean;
  history: HistoryEvent[];
  replayMs: number | null; // null = live
  replayWindowMs: number;
  trails: TrailPoint[];
  multiHosts: string[]; // extra agent base URLs
  seenCountries: Set<string>;
  seenSshSubnets: Set<string>;
  setHome: (home: Partial<Home> & { lat: number; lon: number }) => void;
  setHomeReady: (ready: boolean) => void;
  setPaused: (paused: boolean) => void;
  setIntensity: (intensity: State["intensity"]) => void;
  setMode: (mode: TrafficMode) => void;
  setAgentError: (error: string | null) => void;
  setAgentActiveCount: (n: number) => void;
  setDirectionCounts: (inb: number, out: number) => void;
  setSelectedId: (id: string | null) => void;
  setSoundEnabled: (on: boolean) => void;
  setSecurityPreset: (p: SecurityPreset) => void;
  setKiosk: (on: boolean) => void;
  setAlertsEnabled: (on: boolean) => void;
  setReplayMs: (ms: number | null) => void;
  setTopTalkers: (t: TopTalker[]) => void;
  setHostId: (id: string | null) => void;
  pushHistoryEvents: (evs: HistoryEvent[]) => void;
  hydrateMutes: () => void;
  muteIp: (ip: string, meta?: { label?: string; note?: string }) => void;
  unmuteIp: (ip: string) => void;
  setMuteEnabled: (ip: string, enabled: boolean) => void;
  toggleMuteIp: (ip: string, meta?: { label?: string; note?: string }) => void;
  addMuteFromInput: (raw: string) => boolean;
  spawnConnection: (
    override?: Partial<City> & { direction?: TrafficDirection },
  ) => void;
  upsertRealConnections: (rows: RealRow[]) => void;
  tick: (now: number) => void;
  clear: () => void;
  clearAlerts: () => void;
};

let idSeq = 0;
const seenRealIds = new Set<string>();

function ttlForIntensity(intensity: State["intensity"]): number {
  if (intensity === "calm") return 14000 + Math.random() * 8000;
  if (intensity === "busy") return 7000 + Math.random() * 5000;
  return 10000 + Math.random() * 7000;
}

function eventText(c: {
  direction?: TrafficDirection;
  protocol: string;
  city: string;
  country: string;
  ip: string;
  port: number;
  process?: string | null;
}): string {
  const dir = c.direction === "inbound" ? "IN" : "OUT";
  const proc = c.process ? ` · ${c.process}` : "";
  return `${dir} ${c.protocol}${proc} · ${c.city}, ${c.country} · ${c.ip}${c.port ? `:${c.port}` : ""}`;
}

function recount(list: Connection[], muted: MutedPeer[]) {
  const visible = list.filter((c) => !isIpMuted(c.ip, muted));
  const live = visible.filter((c) => c.live !== false);
  const mutedLive = list.filter(
    (c) => c.live !== false && isIpMuted(c.ip, muted),
  ).length;
  return {
    inboundCount: live.filter((c) => c.direction === "inbound").length,
    outboundCount: live.filter((c) => c.direction !== "inbound").length,
    agentActiveCount: live.length,
    mutedActiveCount: mutedLive,
  };
}

function persistMute(peers: MutedPeer[]) {
  saveMutedPeers(peers);
}

function subnet24(ip: string): string {
  const p = ip.split(".");
  if (p.length === 4) return `${p[0]}.${p[1]}.${p[2]}.0/24`;
  return ip;
}

function pushAlert(
  alerts: AlertItem[],
  level: AlertItem["level"],
  text: string,
): AlertItem[] {
  const a: AlertItem = {
    id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
    level,
    text,
  };
  return [a, ...alerts].slice(0, 40);
}

export function matchesSecurityPreset(
  c: Connection,
  preset: SecurityPreset,
): boolean {
  if (preset === "all") return true;
  const proto = (c.protocol || "").toUpperCase();
  const org = c.org || "";
  if (preset === "noise-off") {
    if (NOISE_PROTO.test(proto)) return false;
    if (CDN_ORGS.test(org)) return false;
    return true;
  }
  if (preset === "web") {
    return (
      proto.includes("HTTP") ||
      proto.includes("HTTPS") ||
      proto.includes("QUIC") ||
      c.port === 80 ||
      c.port === 443 ||
      c.port === 8080 ||
      c.port === 8443
    );
  }
  if (preset === "security") {
    return (
      SECURITY_PORTS.has(c.port) ||
      proto.includes("SSH") ||
      proto.includes("RDP") ||
      proto.includes("VNC") ||
      proto.includes("FTP") ||
      proto.includes("Telnet") ||
      proto.includes("SMB")
    );
  }
  return true;
}

export function protocolWeight(protocol: string, bytesPerSec = 0): number {
  const p = (protocol || "").toUpperCase();
  let base = 0.95;
  if (p.includes("SSH") || p.includes("RDP")) base = 1.4;
  else if (p.includes("DNS") || p.includes("PING") || p.includes("ICMP"))
    base = 0.7;
  else if (p.includes("HTTPS") || p.includes("HTTP")) base = 1.1;
  else if (p.includes("QUIC")) base = 1.0;
  // bandwidth boost
  if (bytesPerSec > 500_000) base *= 1.8;
  else if (bytesPerSec > 50_000) base *= 1.35;
  else if (bytesPerSec > 5_000) base *= 1.15;
  return base;
}

export const useConnectionStore = create<State>((set, get) => ({
  home: {
    lat: DEFAULT_HOME.lat,
    lon: DEFAULT_HOME.lon,
    label: "Locating…",
    source: "default",
  },
  homeReady: false,
  connections: [],
  totalSeen: 0,
  paused: false,
  intensity: "normal",
  mode: "connecting",
  agentError: null,
  agentActiveCount: 0,
  inboundCount: 0,
  outboundCount: 0,
  mutedActiveCount: 0,
  events: [],
  selectedId: null,
  soundEnabled: true,
  mutedPeers: [],
  activityHistory: Array.from({ length: 32 }, () => 0),
  topTalkers: [],
  hostId: null,
  securityPreset: "all",
  kiosk: false,
  alerts: [],
  alertsEnabled: true,
  history: [],
  replayMs: null,
  replayWindowMs: 45 * 60 * 1000,
  trails: [],
  multiHosts: [],
  seenCountries: new Set(),
  seenSshSubnets: new Set(),

  setHome: (home) =>
    set((s) => ({
      home: {
        ...s.home,
        ...home,
        label: home.label ?? s.home.label,
        source: home.source ?? s.home.source,
      },
      homeReady: true,
    })),

  setHomeReady: (homeReady) => set({ homeReady }),
  setPaused: (paused) => set({ paused }),
  setIntensity: (intensity) => set({ intensity }),
  setMode: (mode) => set({ mode }),
  setAgentError: (agentError) => set({ agentError }),
  setAgentActiveCount: (agentActiveCount) => set({ agentActiveCount }),
  setDirectionCounts: (inboundCount, outboundCount) =>
    set({ inboundCount, outboundCount }),
  setSelectedId: (selectedId) => set({ selectedId }),
  setSoundEnabled: (soundEnabled) => {
    setFxAudioEnabled(soundEnabled);
    set({ soundEnabled });
  },
  setSecurityPreset: (securityPreset) => set({ securityPreset }),
  setKiosk: (kiosk) => set({ kiosk }),
  setAlertsEnabled: (alertsEnabled) => set({ alertsEnabled }),
  setReplayMs: (replayMs) => set({ replayMs }),
  setTopTalkers: (topTalkers) => set({ topTalkers }),
  setHostId: (hostId) => set({ hostId }),
  pushHistoryEvents: (evs) =>
    set((s) => {
      if (!evs.length) return s;
      const known = new Set(s.history.map((h) => `${h.type}:${h.id}:${h.at}`));
      const add = evs.filter((e) => !known.has(`${e.type}:${e.id}:${e.at}`));
      if (!add.length) return s;
      const history = [...s.history, ...add]
        .sort((a, b) => a.at - b.at)
        .slice(-5000);
      return { history };
    }),

  hydrateMutes: () => {
    const loaded = loadMutedPeers();
    if (!loaded.length) return;
    set((s) => ({
      mutedPeers: loaded,
      ...recount(s.connections, loaded),
    }));
  },

  muteIp: (ip, meta) => {
    const clean = normalizeIpInput(ip) ?? ip.trim();
    if (!clean) return;
    set((s) => {
      const existing = s.mutedPeers.find((p) => p.ip === clean);
      let mutedPeers: MutedPeer[];
      if (existing) {
        mutedPeers = s.mutedPeers.map((p) =>
          p.ip === clean
            ? {
                ...p,
                enabled: true,
                label: meta?.label ?? p.label,
                note: meta?.note ?? p.note,
              }
            : p,
        );
      } else {
        mutedPeers = [
          {
            ip: clean,
            enabled: true,
            label: meta?.label,
            note: meta?.note,
            addedAt: Date.now(),
          },
          ...s.mutedPeers,
        ];
      }
      persistMute(mutedPeers);
      const selectedId =
        s.selectedId &&
        s.connections.find((c) => c.id === s.selectedId)?.ip === clean
          ? null
          : s.selectedId;
      return {
        mutedPeers,
        selectedId,
        events: s.events.filter((e) => e.ip !== clean),
        ...recount(s.connections, mutedPeers),
      };
    });
  },

  unmuteIp: (ip) => {
    set((s) => {
      const mutedPeers = s.mutedPeers.filter((p) => p.ip !== ip);
      persistMute(mutedPeers);
      return { mutedPeers, ...recount(s.connections, mutedPeers) };
    });
  },

  setMuteEnabled: (ip, enabled) => {
    set((s) => {
      const mutedPeers = s.mutedPeers.map((p) =>
        p.ip === ip ? { ...p, enabled } : p,
      );
      persistMute(mutedPeers);
      return {
        mutedPeers,
        events: enabled ? s.events.filter((e) => e.ip !== ip) : s.events,
        ...recount(s.connections, mutedPeers),
      };
    });
  },

  toggleMuteIp: (ip, meta) => {
    const { mutedPeers, muteIp, setMuteEnabled } = get();
    const hit = mutedPeers.find((p) => p.ip === ip);
    if (!hit) {
      muteIp(ip, meta);
      return;
    }
    setMuteEnabled(ip, !hit.enabled);
  },

  addMuteFromInput: (raw) => {
    const ip = normalizeIpInput(raw);
    if (!ip) return false;
    get().muteIp(ip, { note: "manual" });
    return true;
  },

  spawnConnection: (override) => {
    const { home, intensity, mode, soundEnabled, mutedPeers } = get();
    if (mode === "real") return;
    const city = override
      ? {
          name: override.name ?? "Unknown",
          country: override.country ?? "??",
          lat: override.lat ?? 0,
          lon: override.lon ?? 0,
        }
      : randomRemoteCity({
          name: home.label,
          country: "",
          lat: home.lat,
          lon: home.lon,
        });

    const { protocol, port } = randomProtocol();
    const direction: TrafficDirection =
      override?.direction ?? (Math.random() < 0.45 ? "inbound" : "outbound");
    const now = performance.now();
    const conn: Connection = {
      id: `c-${++idSeq}-${Date.now()}`,
      ip: fakeIp(),
      city: city.name,
      country: city.country,
      lat: city.lat,
      lon: city.lon,
      protocol,
      port,
      bytes: Math.floor(Math.random() * 900_000) + 1200,
      bytesPerSec: Math.random() * 40_000,
      createdAt: now,
      ttl: ttlForIntensity(intensity),
      distanceKm: Math.round(
        haversineKm(city.lat, city.lon, home.lat, home.lon),
      ),
      real: false,
      live: true,
      direction,
      impactAt: now,
      org: null,
      process: null,
    };

    const muted = isIpMuted(conn.ip, mutedPeers);
    if (soundEnabled && !muted) playConnectionBlip(direction, protocol);

    set((s) => {
      const connections = [conn, ...s.connections].slice(0, 80);
      const trail: TrailPoint = {
        id: `t-${conn.id}`,
        lat: conn.lat,
        lon: conn.lon,
        color: direction === "inbound" ? "#2ee6a6" : "#f59e0b",
        born: now,
        ttl: 25000,
        direction,
      };
      const ev: TrafficEvent = {
        id: conn.id,
        at: now,
        text: eventText(conn),
        direction,
        protocol,
        city: conn.city,
        country: conn.country,
        ip: conn.ip,
      };
      return {
        connections,
        totalSeen: s.totalSeen + 1,
        events: muted ? s.events : [ev, ...s.events].slice(0, 40),
        trails: muted ? s.trails : [trail, ...s.trails].slice(0, 120),
        ...recount(connections, s.mutedPeers),
      };
    });
  },

  upsertRealConnections: (rows) => {
    const {
      home,
      soundEnabled,
      mutedPeers,
      alertsEnabled,
      seenCountries,
      seenSshSubnets,
    } = get();
    const now = performance.now();
    const linger = 4500;
    let newCount = 0;
    const freshEvents: TrafficEvent[] = [];
    const freshTrails: TrailPoint[] = [];
    let alerts = get().alerts;
    const countries = new Set(seenCountries);
    const sshNets = new Set(seenSshSubnets);

    set((s) => {
      const byId = new Map(s.connections.map((c) => [c.id, c]));
      const nextIds = new Set(rows.map((r) => r.id));

      for (const row of rows) {
        const prev = byId.get(row.id);
        const muted = isIpMuted(row.ip, mutedPeers);
        if (prev) {
          byId.set(row.id, {
            ...prev,
            protocol: row.protocol,
            port: row.port,
            city: row.city,
            country: row.country,
            lat: row.lat,
            lon: row.lon,
            live: row.live,
            real: true,
            direction: row.direction ?? prev.direction ?? "outbound",
            org: row.org ?? prev.org,
            as: row.as ?? prev.as,
            asn: row.asn ?? prev.asn,
            process: row.process ?? prev.process,
            pid: row.pid ?? prev.pid,
            iface: row.iface ?? prev.iface,
            httpPath: row.httpPath ?? prev.httpPath,
            httpMethod: row.httpMethod ?? prev.httpMethod,
            bytes: row.bytes ?? prev.bytes,
            bytesPerSec: row.bytesPerSec ?? prev.bytesPerSec,
            hostId: row.hostId ?? prev.hostId,
            transport: row.transport ?? prev.transport,
            ttl: row.live
              ? Math.max(prev.ttl, now - prev.createdAt + 60_000)
              : now - prev.createdAt + (row.lingerMs ?? linger),
          });
        } else {
          const isNew = !seenRealIds.has(row.id);
          if (isNew) {
            seenRealIds.add(row.id);
            if (!muted) newCount += 1;
          }
          const direction = row.direction ?? "outbound";
          byId.set(row.id, {
            id: row.id,
            ip: row.ip,
            city: row.city,
            country: row.country,
            lat: row.lat,
            lon: row.lon,
            protocol: row.protocol,
            port: row.port,
            bytes: row.bytes ?? 0,
            bytesPerSec: row.bytesPerSec ?? 0,
            createdAt: now,
            ttl: row.live ? 60_000 : (row.lingerMs ?? linger),
            distanceKm: Math.round(
              haversineKm(row.lat, row.lon, home.lat, home.lon),
            ),
            real: true,
            live: row.live,
            direction,
            impactAt: isNew && !muted ? now : undefined,
            org: row.org,
            as: row.as,
            asn: row.asn,
            process: row.process,
            pid: row.pid,
            iface: row.iface,
            httpPath: row.httpPath,
            httpMethod: row.httpMethod,
            hostId: row.hostId,
            transport: row.transport,
          });
          if (isNew && !muted) {
            if (soundEnabled) playConnectionBlip(direction, row.protocol);
            freshEvents.push({
              id: row.id,
              at: now,
              text: eventText({
                direction,
                protocol: row.protocol,
                city: row.city,
                country: row.country,
                ip: row.ip,
                port: row.port,
                process: row.process,
              }),
              direction,
              protocol: row.protocol,
              city: row.city,
              country: row.country,
              ip: row.ip,
              process: row.process,
              org: row.org,
            });
            freshTrails.push({
              id: `t-${row.id}-${now}`,
              lat: row.lat,
              lon: row.lon,
              color: direction === "inbound" ? "#2ee6a6" : "#f59e0b",
              born: now,
              ttl: 28000,
              direction,
            });

            if (alertsEnabled) {
              if (row.country && !countries.has(row.country)) {
                countries.add(row.country);
                alerts = pushAlert(
                  alerts,
                  "info",
                  `New country: ${row.country} (${row.city}) · ${row.ip}`,
                );
              }
              const isSsh =
                row.port === 22 ||
                (row.protocol || "").toUpperCase().includes("SSH");
              if (isSsh && direction === "inbound") {
                const net = subnet24(row.ip);
                if (!sshNets.has(net)) {
                  sshNets.add(net);
                  alerts = pushAlert(
                    alerts,
                    "danger",
                    `SSH from new subnet ${net} · ${row.city}, ${row.country}`,
                  );
                }
              }
              if ((row.protocol || "").toUpperCase() === "DNS") {
                // mild info — spikes handled elsewhere if needed
              }
            }
          }
        }
      }

      const merged = [...byId.values()].filter((c) => {
        if (!c.real) return false;
        if (nextIds.has(c.id)) return true;
        return now - c.createdAt < c.ttl;
      });

      merged.sort((a, b) => {
        if ((a.live ? 1 : 0) !== (b.live ? 1 : 0)) return a.live ? -1 : 1;
        return b.createdAt - a.createdAt;
      });

      const sliced = merged.slice(0, 120);
      const counts = recount(sliced, mutedPeers);
      const history = [
        ...s.activityHistory.slice(-31),
        counts.agentActiveCount,
      ];
      const trails = [...freshTrails, ...s.trails]
        .filter((t) => now - t.born < t.ttl)
        .slice(0, 160);

      return {
        connections: sliced,
        totalSeen: s.totalSeen + newCount,
        mode: "real" as const,
        agentError: null,
        events: [...freshEvents, ...s.events].slice(0, 40),
        activityHistory: history,
        trails,
        alerts,
        seenCountries: countries,
        seenSshSubnets: sshNets,
        ...counts,
      };
    });
  },

  tick: (now) => {
    set((s) => {
      const next = s.connections.filter((c) => now - c.createdAt < c.ttl);
      const trails = s.trails.filter((t) => now - t.born < t.ttl);
      if (
        next.length === s.connections.length &&
        trails.length === s.trails.length
      ) {
        return s;
      }
      return {
        connections: next,
        trails,
        ...recount(next, s.mutedPeers),
      };
    });
  },

  clear: () =>
    set((s) => ({
      connections: [],
      totalSeen: 0,
      inboundCount: 0,
      outboundCount: 0,
      mutedActiveCount: 0,
      agentActiveCount: 0,
      events: [],
      selectedId: null,
      trails: [],
      mutedPeers: s.mutedPeers,
    })),

  clearAlerts: () => set({ alerts: [] }),
}));

export function connectionLife(c: Connection, now: number): number {
  const age = now - c.createdAt;
  const t = age / c.ttl;
  if (c.real && c.live) {
    if (t < 0.05) return t / 0.05;
    return 1;
  }
  if (t < 0.08) return t / 0.08;
  if (t > 0.72) return Math.max(0, 1 - (t - 0.72) / 0.28);
  return 1;
}

export { isIpMuted };
export type { MutedPeer };
