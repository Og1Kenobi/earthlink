import { useEffect, useRef } from "react";
import {
  useConnectionStore,
  type TrafficDirection,
  type HistoryEvent,
  type TopTalker,
} from "@/lib/connection-store";

type TrafficSnapshot = {
  ok: boolean;
  mode: string;
  error: string | null;
  hostId?: string;
  includePrivate?: boolean;
  home: {
    lat: number;
    lon: number;
    label: string;
    source?: string;
    ip?: string;
    city?: string;
    region?: string;
    country?: string;
    org?: string;
  } | null;
  connections: Array<{
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
    isPrivate?: boolean;
  }>;
  activeCount: number;
  inboundCount?: number;
  outboundCount?: number;
  topTalkers?: TopTalker[];
};

const DEMO_INTERVALS: Record<"calm" | "normal" | "busy", [number, number]> = {
  calm: [1800, 4200],
  normal: [600, 1800],
  busy: [180, 700],
};

function mapRow(c: TrafficSnapshot["connections"][number]) {
  return {
    id: c.id,
    ip: c.ip,
    city: c.city,
    country: c.country,
    lat: c.lat,
    lon: c.lon,
    protocol: c.protocol,
    port: c.port,
    live: c.live,
    lingerMs: c.lingerMs,
    direction: c.direction ?? "outbound",
    org: c.org,
    as: c.as,
    asn: c.asn,
    process: c.process,
    pid: c.pid,
    iface: c.iface,
    httpPath: c.httpPath,
    httpMethod: c.httpMethod,
    bytes: c.bytes,
    bytesPerSec: c.bytesPerSec,
    hostId: c.hostId,
    transport: c.transport,
    isPrivate: c.isPrivate,
  };
}

export function TrafficFeed() {
  const paused = useConnectionStore((s) => s.paused);
  const intensity = useConnectionStore((s) => s.intensity);
  const mode = useConnectionStore((s) => s.mode);
  const spawnConnection = useConnectionStore((s) => s.spawnConnection);
  const upsertRealConnections = useConnectionStore(
    (s) => s.upsertRealConnections,
  );
  const setMode = useConnectionStore((s) => s.setMode);
  const setAgentError = useConnectionStore((s) => s.setAgentError);
  const setAgentActiveCount = useConnectionStore((s) => s.setAgentActiveCount);
  const setDirectionCounts = useConnectionStore((s) => s.setDirectionCounts);
  const setHome = useConnectionStore((s) => s.setHome);
  const setTopTalkers = useConnectionStore((s) => s.setTopTalkers);
  const setHostId = useConnectionStore((s) => s.setHostId);
  const setIncludePrivate = useConnectionStore((s) => s.setIncludePrivate);
  const pushHistoryEvents = useConnectionStore((s) => s.pushHistoryEvents);
  const demoTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollId: number | null = null;
    let histId: number | null = null;
    let failStreak = 0;

    const apply = (snap: TrafficSnapshot) => {
      if (cancelled) return;
      if (snap.home?.lat != null && snap.home?.lon != null) {
        setHome({
          lat: snap.home.lat,
          lon: snap.home.lon,
          label: snap.home.label || "This server",
          source: (snap.home.source as "ip") || "ip",
          ip: snap.home.ip,
          city: snap.home.city,
          region: snap.home.region,
          country: snap.home.country,
          org: snap.home.org,
        });
      }
      if (snap.hostId) setHostId(snap.hostId);
      if (typeof snap.includePrivate === "boolean") {
        setIncludePrivate(snap.includePrivate);
      }
      setAgentActiveCount(snap.activeCount ?? 0);
      setDirectionCounts(snap.inboundCount ?? 0, snap.outboundCount ?? 0);
      setAgentError(snap.error);
      if (snap.topTalkers) setTopTalkers(snap.topTalkers);
      upsertRealConnections((snap.connections ?? []).map(mapRow));
      setMode("real");
      failStreak = 0;
    };

    const fail = (msg: string) => {
      failStreak += 1;
      setAgentError(msg);
      if (failStreak >= 3) setMode("demo");
    };

    const poll = async () => {
      try {
        const r = await fetch("/api/traffic", {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const snap = (await r.json()) as TrafficSnapshot;
        apply(snap);
      } catch (e) {
        fail(e instanceof Error ? e.message : "agent offline");
      }
    };

    const pollHistory = async () => {
      try {
        const r = await fetch("/api/traffic/history", {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) return;
        const j = (await r.json()) as { events?: HistoryEvent[] };
        if (j.events?.length) {
          pushHistoryEvents(
            j.events.map((e) => ({
              ...e,
              direction: (e.direction as TrafficDirection) || "outbound",
            })),
          );
        }
      } catch {
        // optional
      }
    };

    void poll();
    void pollHistory();
    pollId = window.setInterval(() => void poll(), 1500);
    histId = window.setInterval(() => void pollHistory(), 8000);

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      if (histId) clearInterval(histId);
    };
  }, [
    upsertRealConnections,
    setMode,
    setAgentError,
    setAgentActiveCount,
    setDirectionCounts,
    setHome,
    setTopTalkers,
    setHostId,
    setIncludePrivate,
    pushHistoryEvents,
  ]);

  useEffect(() => {
    if (mode === "real" || mode === "connecting") {
      if (demoTimer.current) {
        clearTimeout(demoTimer.current);
        demoTimer.current = null;
      }
      return;
    }
    if (paused) return;

    const schedule = () => {
      const [lo, hi] = DEMO_INTERVALS[intensity];
      const wait = lo + Math.random() * (hi - lo);
      demoTimer.current = window.setTimeout(() => {
        spawnConnection();
        schedule();
      }, wait);
    };
    schedule();
    return () => {
      if (demoTimer.current) clearTimeout(demoTimer.current);
    };
  }, [mode, paused, intensity, spawnConnection]);

  return null;
}
