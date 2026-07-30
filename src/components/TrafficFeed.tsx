import { useEffect, useRef } from "react";
import { useConnectionStore, type TrafficDirection } from "@/lib/connection-store";

type TrafficSnapshot = {
  ok: boolean;
  mode: string;
  error: string | null;
  home: {
    lat: number;
    lon: number;
    label: string;
    source?: string;
    ip?: string;
    city?: string;
    region?: string;
    country?: string;
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
  }>;
  activeCount: number;
  inboundCount?: number;
  outboundCount?: number;
};

const DEMO_INTERVALS: Record<"calm" | "normal" | "busy", [number, number]> = {
  calm: [1800, 4200],
  normal: [600, 1800],
  busy: [180, 700],
};

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
  const demoTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollId: number | null = null;
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
        });
      }
      setAgentActiveCount(snap.activeCount ?? 0);
      setDirectionCounts(snap.inboundCount ?? 0, snap.outboundCount ?? 0);
      setAgentError(snap.error);
      upsertRealConnections(
        (snap.connections ?? []).map((c) => ({
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
        })),
      );
      setMode("real");
      failStreak = 0;
    };

    const fail = (msg: string) => {
      failStreak += 1;
      setAgentError(msg);
      if (failStreak >= 3) {
        setMode("demo");
      } else {
        setMode("connecting");
      }
    };

    const poll = async () => {
      try {
        const res = await fetch("/api/traffic", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const snap = (await res.json()) as TrafficSnapshot;
        apply(snap);
      } catch (e) {
        fail(e instanceof Error ? e.message : "agent offline");
      }
    };

    void poll();
    pollId = window.setInterval(() => void poll(), 1500);

    return () => {
      cancelled = true;
      if (pollId) window.clearInterval(pollId);
    };
  }, [
    setAgentActiveCount,
    setAgentError,
    setDirectionCounts,
    setHome,
    setMode,
    upsertRealConnections,
  ]);

  useEffect(() => {
    if (mode === "real" || mode === "connecting") {
      if (demoTimer.current) window.clearTimeout(demoTimer.current);
      demoTimer.current = null;
      return;
    }
    if (paused) {
      if (demoTimer.current) window.clearTimeout(demoTimer.current);
      demoTimer.current = null;
      return;
    }

    const seed = window.setTimeout(() => {
      for (let i = 0; i < 3; i++) {
        window.setTimeout(
          () =>
            spawnConnection({
              direction: i % 2 === 0 ? "inbound" : "outbound",
            }),
          i * 280,
        );
      }
    }, 400);

    const schedule = () => {
      const [min, max] = DEMO_INTERVALS[intensity];
      const delay = min + Math.random() * (max - min);
      demoTimer.current = window.setTimeout(() => {
        spawnConnection();
        if (Math.random() < 0.12) {
          const burst = 1 + Math.floor(Math.random() * 3);
          for (let i = 0; i < burst; i++) {
            window.setTimeout(() => spawnConnection(), 80 + i * 120);
          }
        }
        schedule();
      }, delay);
    };
    schedule();

    return () => {
      window.clearTimeout(seed);
      if (demoTimer.current) window.clearTimeout(demoTimer.current);
    };
  }, [mode, paused, intensity, spawnConnection]);

  return null;
}
