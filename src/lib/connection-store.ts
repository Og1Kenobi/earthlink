import { create } from "zustand";
import {
  DEFAULT_HOME,
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

/** Named presets — avoids float/null bugs with localStorage. */
export type SpinPreset = "off" | "slow" | "med" | "fast" | "turbo";

/** Radians/sec multipliers applied in Earth.tsx */
export const SPIN_RATES: Record<SpinPreset, number> = {
  off: 0,
  slow: 0.35,
  med: 1,
  fast: 2.25,
  turbo: 4.5,
};

export const SPIN_PRESETS: { id: SpinPreset; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "slow", label: "Slow" },
  { id: "med", label: "Med" },
  { id: "fast", label: "Fast" },
  { id: "turbo", label: "Turbo" },
];

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
  os?: string;
  transport?: string;
  isPrivate?: boolean;
  missCount?: number;
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

export type TrafficMode = "real" | "connecting";

export type AgentInfo = {
  hostId: string;
  os?: string;
  osLabel?: string;
  local?: boolean;
  socketCount?: number;
  stale?: boolean;
};

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
  hostId?: string;
  os?: string;
  isPrivate?: boolean;
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
  os?: string;
  transport?: string;
  isPrivate?: boolean;
};

const CDN_ORGS =
  /cloudflare|akamai|fastly|amazon|aws|google|microsoft|azure|digitalocean|linode|ovh|hetzner|cdn/i;
const NOISE_PROTO = /^(DNS|NTP|PING|ICMP|QUIC)$/i;
const SECURITY_PORTS = new Set([22, 23, 3389, 5900, 445, 21, 3306, 5432, 27017]);

const SPIN_KEY = "earthlink-spin-preset";
const SPIN_KEY_LEGACY = "earthlink-spin-speed";

function isSpinPreset(v: string): v is SpinPreset {
  return v === "off" || v === "slow" || v === "med" || v === "fast" || v === "turbo";
}

function loadSpinPreset(): SpinPreset {
  try {
    if (typeof window === "undefined") return "med";
    const named = localStorage.getItem(SPIN_KEY);
    if (named && isSpinPreset(named)) return named;

    // migrate old numeric values (and fix Number(null)===0 trap)
    const legacyRaw = localStorage.getItem(SPIN_KEY_LEGACY);
    if (legacyRaw != null && legacyRaw !== "") {
      const n = Number(legacyRaw);
      let migrated: SpinPreset = "med";
      if (n === 0) migrated = "off";
      else if (n > 0 && n < 0.75) migrated = "slow";
      else if (n >= 0.75 && n < 1.5) migrated = "med";
      else if (n >= 1.5 && n < 3) migrated = "fast";
      else if (n >= 3) migrated = "turbo";
      try {
        localStorage.setItem(SPIN_KEY, migrated);
        localStorage.removeItem(SPIN_KEY_LEGACY);
      } catch {
        /* ignore */
      }
      return migrated;
    }
  } catch {
    /* ignore */
  }
  return "med";
}

type State = {
  home: Home;
  homeReady: boolean;
  connections: Connection[];
  totalSeen: number;
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
  replayMs: number | null;
  replayWindowMs: number;
  trails: TrailPoint[];
  multiHosts: string[];
  agents: AgentInfo[];
  includePrivate: boolean;
  spinPreset: SpinPreset;
  /** null = all agents; set to a hostId to focus that machine */
  selectedAgentId: string | null;
  seenCountries: Set<string>;
  seenSshSubnets: Set<string>;

  setHome: (home: Partial<Home> & { lat: number; lon: number }) => void;
  setHomeReady: (ready: boolean) => void;
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
  setIncludePrivate: (on: boolean) => void;
  setAgents: (a: AgentInfo[]) => void;
  setSpinPreset: (p: SpinPreset) => void;
  setSelectedAgentId: (id: string | null) => void;
  pushHistoryEvents: (evs: HistoryEvent[]) => void;

  hydrateMutes: () => void;
  muteIp: (ip: string, meta?: { label?: string; note?: string }) => void;
  unmuteIp: (ip: string) => void;
  setMuteEnabled: (ip: string, enabled: boolean) => void;
  toggleMuteIp: (ip: string, meta?: { label?: string; note?: string }) => void;
  addMuteFromInput: (raw: string) => boolean;

  upsertRealConnections: (rows: RealRow[]) => void;
  tick: (now: number) => void;
  clear: () => void;
  clearAlerts: () => void;
};

let idSeq = 0;
const seenRealIds = new Set<string>();


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

/** Filter globe/list to one edge agent (or hub). null = all. */
export function matchesAgentFilter(
  c: { hostId?: string | null; id?: string },
  selectedAgentId: string | null,
  hubHostId?: string | null,
): boolean {
  if (!selectedAgentId) return true;
  const want = selectedAgentId.trim().toLowerCase();

  // Prefer explicit hostId
  if (c.hostId) {
    if (c.hostId.trim().toLowerCase() === want) return true;
  }

  // Connection ids are `${hostId}|transport|ip|…`
  if (c.id) {
    const pipe = c.id.indexOf("|");
    if (pipe > 0) {
      const prefix = c.id.slice(0, pipe).trim().toLowerCase();
      if (prefix === want) return true;
    }
  }

  // Only fall back to hub id when the row has no host markers at all
  if (!c.hostId && !c.id) {
    const hub = (hubHostId || "local").trim().toLowerCase();
    return hub === want;
  }

  return false;
}


export function protocolWeight(protocol: string, bytesPerSec = 0): number {
  const p = (protocol || "").toUpperCase();
  let base = 0.95;
  if (p.includes("SSH") || p.includes("RDP")) base = 1.4;
  else if (p.includes("DNS") || p.includes("PING") || p.includes("ICMP"))
    base = 0.7;
  else if (p.includes("HTTPS") || p.includes("HTTP")) base = 1.1;
  else if (p.includes("QUIC")) base = 1.0;
  if (bytesPerSec > 500_000) base *= 1.8;
  else if (bytesPerSec > 50_000) base *= 1.35;
  else if (bytesPerSec > 5_000) base *= 1.15;
  return base;
}


/** Collapse ephemeral local ports / server id churn into one visual peer. */
function stablePeerId(row: {
  id: string;
  ip: string;
  port: number;
  direction?: string;
  hostId?: string;
  transport?: string;
}): string {
  const host =
    row.hostId || (row.id.includes("|") ? row.id.split("|")[0]! : "local");
  const transport = row.transport || "tcp";
  const dir = row.direction || "outbound";
  const port = row.port || 0;
  return `${host}|${transport}|${row.ip}|${port}|${dir}`;
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
  includePrivate: false,
  agents: [],
  spinPreset: "med",
  selectedAgentId: null,
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
  setIncludePrivate: (includePrivate) => set({ includePrivate }),
  setAgents: (agents) => set({ agents }),
  setSpinPreset: (spinPreset) => {
    if (!isSpinPreset(spinPreset)) return;
    try {
      localStorage.setItem(SPIN_KEY, spinPreset);
      localStorage.removeItem(SPIN_KEY_LEGACY);
    } catch {
      /* ignore */
    }
    set({ spinPreset });
  },
  setSelectedAgentId: (selectedAgentId) => set({ selectedAgentId }),
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
    const spinPreset = loadSpinPreset();
    set((s) => ({
      spinPreset,
      mutedPeers: loaded.length ? loaded : s.mutedPeers,
      ...(loaded.length ? recount(s.connections, loaded) : {}),
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
    const linger = 8000;

    let newCount = 0;
    const freshEvents: TrafficEvent[] = [];
    const freshTrails: TrailPoint[] = [];
    let alerts = get().alerts;
    const countries = new Set(seenCountries);
    const sshNets = new Set(seenSshSubnets);

    set((s) => {
      const byId = new Map(s.connections.map((c) => [c.id, c]));
      // Map stable peer key → row (last write wins)
      const stabilized = rows.map((r) => {
        const sid = stablePeerId(r);
        return { ...r, id: sid, _rawId: r.id };
      });
      const nextIds = new Set(stabilized.map((r) => r.id));

      for (const row of stabilized) {
        const prev = byId.get(row.id);
        const muted = isIpMuted(row.ip, mutedPeers);
        if (prev) {
          const wasLive = prev.live !== false;
          const nowLive = row.live !== false;
          const dying = wasLive && !nowLive;
          const reviving = !wasLive && nowLive;
          byId.set(row.id, {
            ...prev,
            protocol: row.protocol,
            port: row.port,
            city: row.city,
            country: row.country,
            lat: row.lat,
            lon: row.lon,
            live: nowLive,
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
            hostId:
              row.hostId ??
              prev.hostId ??
              (row.id?.includes("|") ? row.id.split("|")[0] : undefined),
            os: row.os ?? prev.os,
            transport: row.transport ?? prev.transport,
            isPrivate: row.isPrivate ?? prev.isPrivate,
            // Restart fade clock only when a live socket first dies
            createdAt: dying ? now : reviving ? now : prev.createdAt,
            ttl: nowLive
              ? 120_000
              : dying
                ? (row.lingerMs ?? linger)
                : Math.max(4000, prev.ttl),
            missCount: 0,
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
            hostId:
              row.hostId ||
              (row.id?.includes("|") ? row.id.split("|")[0] : undefined),
            os: row.os,
            transport: row.transport,
            isPrivate: row.isPrivate,

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

            if (alertsEnabled && !row.isPrivate) {
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
            }
          }
        }
      }

      // Vanished from feed — need several consecutive misses before fade
      // (1.5s poll × 4 ≈ 6s) so one empty netstat doesn't pop the arc.
      const MISS_BEFORE_FADE = 4;
      for (const [id, prev] of byId) {
        if (!prev.real) continue;
        if (nextIds.has(id)) {
          if (prev.missCount) {
            byId.set(id, { ...prev, missCount: 0 });
          }
          continue;
        }
        const misses = (prev.missCount || 0) + 1;
        if (prev.live !== false && misses >= MISS_BEFORE_FADE) {
          byId.set(id, {
            ...prev,
            live: false,
            createdAt: now,
            ttl: linger,
            missCount: misses,
          });
        } else if (prev.live !== false) {
          byId.set(id, { ...prev, missCount: misses });
        }
      }

      const merged = [...byId.values()].filter((c) => {
        if (!c.real) return false;
        if (c.live !== false) return true;
        return now - c.createdAt < c.ttl;
      });

      // Keep fading arcs so they can ease out (don't drop them for live-only cap)
      const liveOnes = merged
        .filter((c) => c.live !== false)
        .sort((a, b) => b.createdAt - a.createdAt);
      const dyingOnes = merged
        .filter((c) => c.live === false)
        .sort((a, b) => b.createdAt - a.createdAt);
      const sliced = [...liveOnes.slice(0, 90), ...dyingOnes.slice(0, 30)];
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
      // Live sockets never expire by age — only dying ones fade out via ttl
      const next = s.connections.filter((c) => {
        if (c.live !== false) return true;
        return now - c.createdAt < c.ttl;
      });
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
  const age = Math.max(0, now - c.createdAt);

  // Live real sockets: brief fade-in, then full
  if (c.real && c.live !== false) {
    const fadeIn = 400;
    if (age < fadeIn) return age / fadeIn;
    return 1;
  }

  // Dying / closed: entire ttl is a smooth fade-out (never hard-pop)
  const duration = Math.max(c.ttl || 1, 1);
  const tNorm = age / duration;
  if (tNorm >= 1) return 0;
  if (tNorm <= 0) return 1;
  // smoothstep ease-out
  const u = 1 - tNorm;
  return u * u * (3 - 2 * u);
}

export { isIpMuted };
export type { MutedPeer };
