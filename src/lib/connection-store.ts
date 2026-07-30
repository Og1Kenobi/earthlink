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
  setHome: (home: Partial<Home> & { lat: number; lon: number }) => void;
  setHomeReady: (ready: boolean) => void;
  setPaused: (paused: boolean) => void;
  setIntensity: (intensity: State["intensity"]) => void;
  setMode: (mode: TrafficMode) => void;
  setAgentError: (error: string | null) => void;
  setAgentActiveCount: (n: number) => void;
  setDirectionCounts: (inb: number, out: number) => void;
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

  spawnConnection: (override) => {
    const { home, intensity, mode } = get();
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
      createdAt: performance.now(),
      ttl: ttlForIntensity(intensity),
      distanceKm: Math.round(
        haversineKm(city.lat, city.lon, home.lat, home.lon),
      ),
      real: false,
      live: true,
      direction,
    };

    set((s) => {
      const connections = [conn, ...s.connections].slice(0, 80);
      const live = connections.filter((c) => c.live !== false);
      return {
        connections,
        totalSeen: s.totalSeen + 1,
        inboundCount: live.filter((c) => c.direction === "inbound").length,
        outboundCount: live.filter((c) => c.direction !== "inbound").length,
      };
    });
  },

  upsertRealConnections: (rows) => {
    const { home } = get();
    const now = performance.now();
    const linger = 4500;
    let newCount = 0;

    set((s) => {
      const byId = new Map(s.connections.map((c) => [c.id, c]));
      const nextIds = new Set(rows.map((r) => r.id));

      for (const row of rows) {
        const prev = byId.get(row.id);
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
          if (!seenRealIds.has(row.id)) {
            seenRealIds.add(row.id);
            newCount += 1;
          }
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
            direction: row.direction ?? "outbound",
          });
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

      const live = merged.filter((c) => c.live !== false);
      return {
        connections: merged.slice(0, 100),
        totalSeen: s.totalSeen + newCount,
        mode: "real" as const,
        agentError: null,
        inboundCount: live.filter((c) => c.direction === "inbound").length,
        outboundCount: live.filter((c) => c.direction !== "inbound").length,
      };
    });
  },

  tick: (now) => {
    set((s) => {
      const next = s.connections.filter((c) => now - c.createdAt < c.ttl);
      if (next.length === s.connections.length) return s;
      const live = next.filter((c) => c.live !== false);
      return {
        connections: next,
        inboundCount: live.filter((c) => c.direction === "inbound").length,
        outboundCount: live.filter((c) => c.direction !== "inbound").length,
      };
    });
  },

  clear: () =>
    set({ connections: [], totalSeen: 0, inboundCount: 0, outboundCount: 0 }),
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
