import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Crosshair,
  Globe2,
  MapPin,
  Pause,
  Play,
  Radio,
  Server,
  Trash2,
  Zap,
} from "lucide-react";
import { useConnectionStore } from "@/lib/connection-store";
import { refreshHomeLocation } from "@/components/HomeLocator";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatAge(ms: number): string {
  const s = Math.max(0, ms / 1000);
  return `${s.toFixed(1)}s`;
}

function sourceBlurb(source: string, accuracyM?: number): string {
  switch (source) {
    case "geo":
      return accuracyM != null
        ? `GPS pin · ~${Math.round(accuracyM)} m accuracy`
        : "GPS pin on your device";
    case "ip":
      return "From this host’s public IP";
    case "config":
      return "Pinned via server config";
    case "cached":
      return "Restored from last session";
    case "manual":
      return "Manually set";
    default:
      return "Waiting for location…";
  }
}

export function Hud() {
  const home = useConnectionStore((s) => s.home);
  const homeReady = useConnectionStore((s) => s.homeReady);
  const connections = useConnectionStore((s) => s.connections);
  const totalSeen = useConnectionStore((s) => s.totalSeen);
  const paused = useConnectionStore((s) => s.paused);
  const intensity = useConnectionStore((s) => s.intensity);
  const mode = useConnectionStore((s) => s.mode);
  const agentError = useConnectionStore((s) => s.agentError);
  const agentActiveCount = useConnectionStore((s) => s.agentActiveCount);
  const inboundCount = useConnectionStore((s) => s.inboundCount);
  const outboundCount = useConnectionStore((s) => s.outboundCount);
  const setPaused = useConnectionStore((s) => s.setPaused);
  const setIntensity = useConnectionStore((s) => s.setIntensity);
  const setMode = useConnectionStore((s) => s.setMode);
  const spawnConnection = useConnectionStore((s) => s.spawnConnection);
  const clear = useConnectionStore((s) => s.clear);
  const setHome = useConnectionStore((s) => s.setHome);

  const [now, setNow] = useState(() => performance.now());
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 200);
    return () => window.clearInterval(id);
  }, []);

  const activeCount = connections.filter((c) => c.live !== false).length;
  const topCountries = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of connections) {
      if (c.live === false) continue;
      map.set(c.country, (map.get(c.country) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [connections]);

  const onRelocate = async () => {
    setLocating(true);
    try {
      await refreshHomeLocation(setHome, { gpsOnly: false });
    } finally {
      setLocating(false);
    }
  };

  const modeLabel =
    mode === "real" ? "REAL" : mode === "connecting" ? "LINK…" : "DEMO";
  const modeClass =
    mode === "real"
      ? "border-accent/40 bg-accent/10 text-accent"
      : mode === "connecting"
        ? "border-warn/40 bg-warn/10 text-warn"
        : "border-border bg-surface-elevated text-muted";

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-3 sm:p-5">
      <header className="pointer-events-auto flex flex-wrap items-start justify-between gap-3">
        <div className="panel-glass max-w-md rounded-xl px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <Globe2 className="size-5 text-primary" strokeWidth={1.75} />
            <h1 className="text-base font-semibold tracking-tight text-fg sm:text-lg">
              Earthlink
            </h1>
            <span
              className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${modeClass}`}
            >
              {modeLabel}
            </span>
          </div>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted sm:text-sm">
            {mode === "real"
              ? "Live inbound + outbound TCP — green arcs in, amber arcs out."
              : mode === "connecting"
                ? "Connecting to the traffic agent on this server…"
                : "Demo traffic (agent offline). Install on your server for real sockets."}
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] font-mono uppercase tracking-wide">
            <span className="inline-flex items-center gap-1 text-primary">
              <span className="size-1.5 rounded-full bg-primary" />
              Inbound
            </span>
            <span className="inline-flex items-center gap-1 text-warn">
              <span className="size-1.5 rounded-full bg-warn" />
              Outbound
            </span>
          </div>
        </div>

        <div className="panel-glass flex flex-wrap items-center gap-2 rounded-xl px-3 py-2">
          <button
            type="button"
            onClick={() => setPaused(!paused)}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface-elevated px-3 text-sm text-fg transition hover:border-primary/40 hover:text-primary"
            aria-label={paused ? "Resume" : "Pause"}
            disabled={mode === "real"}
            title={mode === "real" ? "Live sockets can’t be paused" : undefined}
          >
            {paused ? (
              <Play className="size-4" />
            ) : (
              <Pause className="size-4" />
            )}
            <span className="hidden sm:inline">{paused ? "Resume" : "Pause"}</span>
          </button>
          {mode !== "real" && (
            <button
              type="button"
              onClick={() => spawnConnection()}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 text-sm text-primary transition hover:bg-primary/20"
            >
              <Zap className="size-4" />
              <span className="hidden sm:inline">Pulse</span>
            </button>
          )}
          {mode === "demo" && (
            <button
              type="button"
              onClick={() => {
                setMode("connecting");
                window.location.reload();
              }}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 text-sm text-accent transition hover:bg-accent/20"
            >
              <Server className="size-4" />
              <span className="hidden sm:inline">Retry agent</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => clear()}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface-elevated px-3 text-sm text-muted transition hover:border-danger/40 hover:text-danger"
            aria-label="Clear"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </header>

      <div className="pointer-events-none flex flex-1 items-stretch justify-between gap-3 py-3">
        <aside className="pointer-events-auto flex w-[min(100%,16.5rem)] flex-col gap-3 self-end sm:self-center">
          <div className="panel-glass rounded-xl p-3 sm:p-4">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-faint">
              <Activity className="size-3.5 text-accent" />
              Traffic
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Stat
                label="Active"
                value={String(
                  mode === "real" ? agentActiveCount || activeCount : activeCount,
                )}
                accent
              />
              <Stat label="Seen" value={String(totalSeen)} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-2 py-1.5">
                <p className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-primary">
                  <ArrowDownLeft className="size-3" />
                  In
                </p>
                <p className="font-mono text-lg font-semibold tabular-nums text-primary">
                  {inboundCount}
                </p>
              </div>
              <div className="rounded-lg border border-warn/20 bg-warn/5 px-2 py-1.5">
                <p className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-warn">
                  <ArrowUpRight className="size-3" />
                  Out
                </p>
                <p className="font-mono text-lg font-semibold tabular-nums text-warn">
                  {outboundCount}
                </p>
              </div>
            </div>
            {mode !== "real" && (
              <div className="mt-3">
                <p className="text-[10px] uppercase tracking-wider text-faint">
                  Demo intensity
                </p>
                <div className="mt-1.5 flex gap-1">
                  {(["calm", "normal", "busy"] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setIntensity(level)}
                      className={`flex-1 rounded-md border px-2 py-1.5 font-mono text-[10px] uppercase tracking-wide transition ${
                        intensity === level
                          ? "border-primary/50 bg-primary/15 text-primary"
                          : "border-border bg-surface text-muted hover:border-border-strong"
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {topCountries.length > 0 && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-[10px] uppercase tracking-wider text-faint">
                  Active peers
                </p>
                <ul className="mt-1.5 space-y-1">
                  {topCountries.map(([cc, n]) => (
                    <li
                      key={cc}
                      className="flex items-center justify-between font-mono text-xs text-muted"
                    >
                      <span className="text-fg">{cc}</span>
                      <span className="text-primary">{n}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {agentError && mode !== "real" && (
              <p className="mt-3 border-t border-border pt-2 font-mono text-[10px] text-danger">
                Agent: {agentError}
              </p>
            )}
          </div>

          <div className="panel-glass rounded-xl p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-faint">
                <MapPin className="size-3.5 text-warn" />
                Home
              </div>
              <button
                type="button"
                onClick={onRelocate}
                disabled={locating || mode === "real"}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-elevated px-2 text-[11px] text-muted transition hover:border-warn/40 hover:text-warn disabled:opacity-50"
                title={
                  mode === "real"
                    ? "Home is this server’s location"
                    : "Re-detect your location"
                }
              >
                <Crosshair
                  className={`size-3.5 ${locating ? "animate-spin" : ""}`}
                />
                {locating ? "…" : "Locate"}
              </button>
            </div>
            <p className="mt-2 text-sm font-medium text-fg">
              {homeReady || home.source !== "default" ? home.label : "Locating…"}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-muted">
              {home.lat.toFixed(4)}°, {home.lon.toFixed(4)}°
            </p>
            {home.ip && (
              <p className="mt-0.5 font-mono text-[11px] text-faint">
                IP {home.ip}
              </p>
            )}
            <p className="mt-2 text-[11px] leading-snug text-faint">
              {mode === "real"
                ? "Server pin — all arcs meet here"
                : sourceBlurb(home.source, home.accuracyM)}
            </p>
          </div>
        </aside>

        <aside className="pointer-events-auto hidden w-[min(100%,18rem)] flex-col self-center md:flex">
          <div className="panel-glass flex max-h-[min(58vh,28rem)] flex-col rounded-xl">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-wider text-faint">
              <Radio className="size-3.5 text-primary" />
              Connections
            </div>
            <ul className="flex-1 space-y-0 overflow-y-auto overscroll-contain px-2 py-2">
              {connections.length === 0 ? (
                <li className="px-2 py-6 text-center text-xs text-muted">
                  {mode === "real"
                    ? "No public remote sockets right now — waiting…"
                    : "Waiting for traffic…"}
                </li>
              ) : (
                connections.slice(0, 24).map((c) => {
                  const age = now - c.createdAt;
                  const remaining = Math.max(0, c.ttl - age);
                  const inbound = c.direction === "inbound";
                  return (
                    <li
                      key={c.id}
                      className="rounded-lg px-2.5 py-2 transition hover:bg-surface-elevated/60"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-fg">
                            <span
                              className={`mr-1.5 inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-[9px] uppercase ${
                                inbound
                                  ? "bg-primary/15 text-primary"
                                  : "bg-warn/15 text-warn"
                              }`}
                            >
                              {inbound ? (
                                <ArrowDownLeft className="size-2.5" />
                              ) : (
                                <ArrowUpRight className="size-2.5" />
                              )}
                              {inbound ? "in" : "out"}
                            </span>
                            {c.city}
                            <span className="ml-1 font-normal text-muted">
                              {c.country}
                            </span>
                          </p>
                          <p className="font-mono text-[11px] text-faint">
                            {c.ip}:{c.port} · {c.protocol}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono text-[10px] text-primary">
                          {c.real && c.live ? "●" : formatAge(remaining)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-muted">
                        <span>{c.distanceKm.toLocaleString()} km</span>
                        {!c.real && <span>{formatBytes(c.bytes)}</span>}
                      </div>
                      {!(c.real && c.live) && (
                        <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-border">
                          <div
                            className={`h-full rounded-full transition-[width] duration-200 ${
                              inbound ? "bg-primary/70" : "bg-warn/70"
                            }`}
                            style={{
                              width: `${Math.max(0, Math.min(100, (remaining / c.ttl) * 100))}%`,
                            }}
                          />
                        </div>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </aside>
      </div>

      <div className="pointer-events-auto panel-glass rounded-xl md:hidden">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-faint">
          <Radio className="size-3 text-primary" />
          Recent · In {inboundCount} · Out {outboundCount}
        </div>
        <ul className="flex gap-2 overflow-x-auto px-2 py-2">
          {connections.slice(0, 8).map((c) => (
            <li
              key={c.id}
              className="min-w-[9.5rem] shrink-0 rounded-lg border border-border bg-surface-elevated/50 px-2.5 py-2"
            >
              <p className="truncate text-xs font-medium text-fg">
                <span
                  className={
                    c.direction === "inbound" ? "text-primary" : "text-warn"
                  }
                >
                  {c.direction === "inbound" ? "↓" : "↑"}
                </span>{" "}
                {c.city}, {c.country}
              </p>
              <p className="font-mono text-[10px] text-muted">{c.ip}</p>
            </li>
          ))}
          {connections.length === 0 && (
            <li className="px-2 py-3 text-xs text-muted">No active links</li>
          )}
        </ul>
      </div>

      <p className="pointer-events-none mt-2 hidden text-center text-[11px] text-faint sm:block">
        Drag to orbit · Scroll to zoom · Green = inbound · Amber = outbound
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-faint">{label}</p>
      <p
        className={`mt-0.5 font-mono text-2xl font-semibold tabular-nums ${
          accent ? "text-primary text-glow" : "text-fg"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
