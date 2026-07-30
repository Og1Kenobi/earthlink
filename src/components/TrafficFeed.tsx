import { useEffect } from "react";
import {
  useConnectionStore,
  type TrafficDirection,
  type HistoryEvent,
  type TopTalker,
} from "@/lib/connection-store";

type AgentInfo = {
  hostId: string;
  os?: string;
  osLabel?: string;
  local?: boolean;
  socketCount?: number;
  stale?: boolean;
};

type TrafficSnapshot = {
  ok: boolean;
  mode: string;
  error: string | null;
  hostId?: string;
  os?: string;
  osLabel?: string;
  includePrivate?: boolean;
  agents?: AgentInfo[];
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
    os?: string;
    transport?: string;
    isPrivate?: boolean;
  }>;
  activeCount: number;
  inboundCount?: number;
  outboundCount?: number;
  topTalkers?: TopTalker[];
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
    os: c.os,
    transport: c.transport,
    isPrivate: c.isPrivate,
  };
}

export function TrafficFeed() {
  const mode = useConnectionStore((s) => s.mode);
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
  const setAgents = useConnectionStore((s) => s.setAgents);
  const pushHistoryEvents = useConnectionStore((s) => s.pushHistoryEvents);

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
      if (snap.agents) setAgents(snap.agents);
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
      // Stay in connecting — never invent fake traffic
      if (failStreak >= 3) setMode("connecting");
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
    setAgents,
    pushHistoryEvents,
  ]);


  return null;
}
