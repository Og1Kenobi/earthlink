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
  createdAt: number;
  ttl: number;
  distanceKm: number;
  real?: boolean;
  live?: boolean;
  direction?: TrafficDirection;
  impactAt?: number;
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
};

export type TrafficMode = "real" | "demo" | "connecting";

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
};

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
  pushActivitySample: (n: number) => void;
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
}): string {
  const dir = c.direction === "inbound" ? "IN" : "OUT";
  return `${dir} ${c.protocol} · ${c.city}, ${c.country} · ${c.ip}${c.port ? `:${c.port}` : ""}`;
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
  pushActivitySample: (n) =>
    set((s) => ({
      activityHistory: [...s.activityHistory.slice(-31), n],
    })),

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
      createdAt: now,
      ttl: ttlForIntensity(intensity),
      distanceKm: Math.round(
        haversineKm(city.lat, city.lon, home.lat, home.lon),
      ),
      real: false,
      live: true,
      direction,
      impactAt: now,
    };

    const muted = isIpMuted(conn.ip, mutedPeers);
    if (soundEnabled && !muted) playConnectionBlip(direction, protocol);

    set((s) => {
      const connections = [conn, ...s.connections].slice(0, 80);
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
        ...recount(connections, s.mutedPeers),
      };
    });
  },

  upsertRealConnections: (rows) => {
    const { home, soundEnabled, mutedPeers } = get();
    const now = performance.now();
    const linger = 4500;
    let newCount = 0;
    const freshEvents: TrafficEvent[] = [];

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
            bytes: 0,
            createdAt: now,
            ttl: row.live ? 60_000 : (row.lingerMs ?? linger),
            distanceKm: Math.round(
              haversineKm(row.lat, row.lon, home.lat, home.lon),
            ),
            real: true,
            live: row.live,
            direction,
            impactAt: isNew && !muted ? now : undefined,
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
              }),
              direction,
              protocol: row.protocol,
              city: row.city,
              country: row.country,
              ip: row.ip,
            });
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

      const sliced = merged.slice(0, 100);
      const counts = recount(sliced, mutedPeers);
      const history = [
        ...s.activityHistory.slice(-31),
        counts.agentActiveCount,
      ];
      return {
        connections: sliced,
        totalSeen: s.totalSeen + newCount,
        mode: "real" as const,
        agentError: null,
        events: [...freshEvents, ...s.events].slice(0, 40),
        activityHistory: history,
        ...counts,
      };
    });
  },

  tick: (now) => {
    set((s) => {
      const next = s.connections.filter((c) => now - c.createdAt < c.ttl);
      if (next.length === s.connections.length) return s;
      return {
        connections: next,
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
      mutedPeers: s.mutedPeers,
    })),
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

export function protocolWeight(protocol: string): number {
  const p = (protocol || "").toUpperCase();
  if (p.includes("SSH") || p.includes("RDP")) return 1.35;
  if (p.includes("DNS") || p.includes("PING") || p.includes("ICMP")) return 0.75;
  if (p.includes("HTTPS") || p.includes("HTTP")) return 1.1;
  if (p.includes("QUIC")) return 1.0;
  return 0.95;
}

export { isIpMuted };
export type { MutedPeer };
