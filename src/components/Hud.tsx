import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  Crosshair,
  Globe2,
  MapPin,
  Pause,
  Play,
  Radio,
  Server,
  Trash2,
  Volume2,
  VolumeX,
  Zap,
  X,
} from "lucide-react";
import {
  useConnectionStore,
  type Connection,
} from "@/lib/connection-store";
import { refreshHomeLocation } from "@/components/HomeLocator";
import { resumeFxAudio } from "@/lib/fx-audio";

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

type ConnFilter =
  | "all"
  | "live"
  | "inbound"
  | "outbound"
  | "proto:DNS"
  | "proto:PING"
  | "proto:HTTPS"
  | "proto:HTTP"
  | "proto:SSH"
  | "proto:NTP"
  | "proto:QUIC"
  | string;

const STATIC_FILTERS: { value: ConnFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "live", label: "Live only" },
  { value: "inbound", label: "Inbound" },
  { value: "outbound", label: "Outbound" },
  { value: "proto:DNS", label: "DNS" },
  { value: "proto:PING", label: "Ping" },
  { value: "proto:HTTPS", label: "HTTPS" },
  { value: "proto:HTTP", label: "HTTP" },
  { value: "proto:SSH", label: "SSH" },
  { value: "proto:NTP", label: "NTP" },
  { value: "proto:QUIC", label: "QUIC" },
];

function matchesFilter(c: Connection, filter: ConnFilter): boolean {
  if (filter === "all") return true;
  if (filter === "live") return c.live !== false;
  if (filter === "inbound") return c.direction === "inbound";
  if (filter === "outbound") return c.direction !== "inbound";
  if (filter.startsWith("proto:")) {
    const want = filter.slice(6).toUpperCase();
    const p = (c.protocol || "").toUpperCase();
    if (want === "HTTP") return p === "HTTP" || p.startsWith("HTTP/");
    if (want === "HTTPS") return p === "HTTPS" || p.includes("HTTPS");
    if (want === "DNS") return p === "DNS" || p.includes("DNS");
    if (want === "PING") return p === "PING" || p === "ICMP";
    return p === want || p.startsWith(want);
  }
  return true;
}

function ActivitySpark({ samples }: { samples: number[] }) {
  const max = Math.max(1, ...samples);
  return (
    <div
      className="flex h-8 items-end gap-px"
      aria-hidden
      title="Live activity"
    >
      {samples.map((v, i) => {
        const h = Math.max(8, Math.round((v / max) * 100));
        const hot = i > samples.length - 4;
        return (
          <div
            key={i}
            className={`spark-bar w-1 rounded-sm ${
              hot ? "bg-primary/80" : "bg-accent/35"
            }`}
            style={{ height: `${h}%` }}
          />
        );
      })}
    </div>
  );
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
  const events = useConnectionStore((s) => s.events);
  const selectedId = useConnectionStore((s) => s.selectedId);
  const soundEnabled = useConnectionStore((s) => s.soundEnabled);
  const activityHistory = useConnectionStore((s) => s.activityHistory);
  const setPaused = useConnectionStore((s) => s.setPaused);
  const setIntensity = useConnectionStore((s) => s.setIntensity);
  const setMode = useConnectionStore((s) => s.setMode);
  const spawnConnection = useConnectionStore((s) => s.spawnConnection);
  const clear = useConnectionStore((s) => s.clear);
  const setHome = useConnectionStore((s) => s.setHome);
  const setSelectedId = useConnectionStore((s) => s.setSelectedId);
  const setSoundEnabled = useConnectionStore((s) => s.setSoundEnabled);

  const [now, setNow] = useState(() => performance.now());
  const [locating, setLocating] = useState(false);
  const [connFilter, setConnFilter] = useState<ConnFilter>("all");

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
      .slice(0, 5);
  }, [connections]);

  const topProtocols = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of connections) {
      if (c.live === false) continue;
      const p = c.protocol || "TCP";
      map.set(p, (map.get(p) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [connections]);

  const filterOptions = useMemo(() => {
    const seen = new Set(STATIC_FILTERS.map((f) => f.value));
    const opts = [...STATIC_FILTERS];
    const protos = new Map<string, number>();
    for (const c of connections) {
      const p = (c.protocol || "TCP").trim();
      if (!p) continue;
      protos.set(p, (protos.get(p) ?? 0) + 1);
    }
    for (const [p, n] of [...protos.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)) {
      const value = `proto:${p}` as ConnFilter;
      const upper = p.toUpperCase();
      if (
        STATIC_FILTERS.some(
          (f) =>
            f.value === `proto:${upper}` || f.label.toUpperCase() === upper,
        )
      ) {
        continue;
      }
      if (seen.has(value)) continue;
      seen.add(value);
      opts.push({ value, label: `${p} (${n})` });
    }
    return opts;
  }, [connections]);

  const filteredConnections = useMemo(
    () => connections.filter((c) => matchesFilter(c, connFilter)),
    [connections, connFilter],
  );

  const selected = useMemo(
    () => connections.find((c) => c.id === selectedId) ?? null,
    [connections, selectedId],
  );

  const onRelocate = async () => {
    setLocating(true);
    try {
      await refreshHomeLocation(setHome, { gpsOnly: false });
    } finally {
      setLocating(false);
    }
  };

  const modeLabel =
    mode === "real" ? "LIVE" : mode === "connecting" ? "LINK…" : "DEMO";
  const modeClass =
    mode === "real"
      ? "border-primary/40 bg-primary/10 text-primary"
      : mode === "connecting"
        ? "border-warn/40 bg-warn/10 text-warn"
        : "border-border bg-surface-elevated text-muted";

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-3 sm:p-5">
      {/* Cinematic overlays */}
      <div className="vignette absolute inset-0" />
      <div className="scanlines absolute inset-0" />

      <header className="pointer-events-auto relative flex flex-wrap items-start justify-between gap-3">
        <div className="panel-glass panel-glow-in max-w-md rounded-xl px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <Globe2 className="size-5 text-primary" strokeWidth={1.75} />
            <h1 className="text-base font-semibold tracking-tight text-fg sm:text-lg">
              Earthlink
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${modeClass}`}
            >
              {mode === "real" && (
                <span className="pulse-dot size-1.5 rounded-full bg-primary" />
              )}
              {modeLabel}
            </span>
          </div>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted sm:text-sm">
            {mode === "real"
              ? "NOC globe · TCP · UDP/DNS · ping · click a row to focus the arc."
              : mode === "connecting"
                ? "Linking traffic agent…"
                : "Demo mode — install on your server for real sockets."}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <div className="flex gap-3 text-[10px] font-mono uppercase tracking-wide">
              <span className="inline-flex items-center gap-1 text-primary">
                <span className="size-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary)]" />
                In
              </span>
              <span className="inline-flex items-center gap-1 text-warn">
                <span className="size-1.5 rounded-full bg-warn shadow-[0_0_8px_var(--color-warn)]" />
                Out
              </span>
            </div>
            <ActivitySpark samples={activityHistory} />
          </div>
        </div>

        <div className="panel-glass flex flex-wrap items-center gap-2 rounded-xl px-3 py-2">
          <button
            type="button"
            onClick={() => {
              resumeFxAudio();
              setSoundEnabled(!soundEnabled);
            }}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface-elevated px-3 text-sm text-fg transition hover:border-accent/40 hover:text-accent"
            aria-label={soundEnabled ? "Mute" : "Unmute"}
            title={soundEnabled ? "Mute blips" : "Enable blips"}
          >
            {soundEnabled ? (
              <Volume2 className="size-4" />
            ) : (
              <VolumeX className="size-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setPaused(!paused)}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface-elevated px-3 text-sm text-fg transition hover:border-primary/40 hover:text-primary"
            aria-label={paused ? "Resume" : "Pause"}
            disabled={mode === "real"}
          >
            {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            <span className="hidden sm:inline">{paused ? "Resume" : "Pause"}</span>
          </button>
          {mode !== "real" && (
            <button
              type="button"
              onClick={() => {
                resumeFxAudio();
                spawnConnection();
              }}
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
              <span className="hidden sm:inline">Retry</span>
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

      <div className="pointer-events-none relative flex flex-1 items-stretch justify-between gap-3 py-3">
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
              <div className="rounded-lg border border-primary/25 bg-primary/10 px-2 py-1.5">
                <p className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-primary">
                  <ArrowDownLeft className="size-3" />
                  In
                </p>
                <p className="font-mono text-lg font-semibold tabular-nums text-primary text-glow">
                  {inboundCount}
                </p>
              </div>
              <div className="rounded-lg border border-warn/25 bg-warn/10 px-2 py-1.5">
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
                  Hot countries
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
            {topProtocols.length > 0 && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-[10px] uppercase tracking-wider text-faint">
                  Protocols
                </p>
                <ul className="mt-1.5 space-y-1">
                  {topProtocols.map(([p, n]) => (
                    <li
                      key={p}
                      className="flex items-center justify-between font-mono text-xs text-muted"
                    >
                      <span className="truncate text-fg">{p}</span>
                      <span className="text-accent">{n}</span>
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
                <MapPin className="size-3.5 text-accent" />
                Home
              </div>
              <button
                type="button"
                onClick={onRelocate}
                disabled={locating || mode === "real"}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-elevated px-2 text-[11px] text-muted transition hover:border-accent/40 hover:text-accent disabled:opacity-50"
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
                ? "Beacon — all arcs converge here"
                : sourceBlurb(home.source, home.accuracyM)}
            </p>
          </div>

          {selected && (
            <div className="panel-glass panel-glow-in event-flash rounded-xl p-3 sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wider text-faint">
                  Focus
                </p>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="rounded-md p-1 text-muted hover:text-fg"
                  aria-label="Close"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <p className="mt-1 text-sm font-semibold text-fg">
                {selected.city}, {selected.country}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-accent">
                {selected.protocol} ·{" "}
                {selected.direction === "inbound" ? "inbound" : "outbound"}
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted">
                {selected.ip}:{selected.port}
              </p>
              <p className="mt-1 text-[11px] text-faint">
                {selected.distanceKm.toLocaleString()} km from home
              </p>
            </div>
          )}
        </aside>

        <aside className="pointer-events-auto hidden w-[min(100%,18rem)] flex-col self-stretch md:flex">
          <div className="panel-glass flex h-full min-h-0 max-h-[min(78vh,44rem)] flex-1 flex-col rounded-xl">
            <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-3 sm:px-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-faint">
                  <Radio className="size-3.5 text-primary" />
                  Connections
                </div>
                <span className="font-mono text-[10px] tabular-nums text-muted">
                  {filteredConnections.length}
                  {connFilter !== "all" ? ` / ${connections.length}` : ""}
                </span>
              </div>
              <label className="relative block">
                <span className="sr-only">Filter connections</span>
                <select
                  value={connFilter}
                  onChange={(e) => setConnFilter(e.target.value as ConnFilter)}
                  className="h-9 w-full appearance-none rounded-lg border border-border bg-surface-elevated py-1.5 pl-3 pr-8 font-mono text-[11px] text-fg outline-none transition hover:border-border-strong focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                >
                  {filterOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint"
                  aria-hidden
                />
              </label>
            </div>
            <ul className="min-h-0 flex-1 space-y-0 overflow-y-auto overscroll-contain px-2 py-2">
              {connections.length === 0 ? (
                <li className="px-2 py-6 text-center text-xs text-muted">
                  {mode === "real"
                    ? "Waiting for public remotes…"
                    : "Waiting for traffic…"}
                </li>
              ) : filteredConnections.length === 0 ? (
                <li className="px-2 py-6 text-center text-xs text-muted">
                  No matches.
                  <button
                    type="button"
                    onClick={() => setConnFilter("all")}
                    className="mt-2 block w-full text-[11px] text-primary hover:underline"
                  >
                    Show all
                  </button>
                </li>
              ) : (
                filteredConnections.slice(0, 48).map((c) => {
                  const age = now - c.createdAt;
                  const remaining = Math.max(0, c.ttl - age);
                  const inbound = c.direction === "inbound";
                  const isSel = c.id === selectedId;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          resumeFxAudio();
                          setSelectedId(isSel ? null : c.id);
                        }}
                        className={`w-full rounded-lg px-2.5 py-2 text-left transition hover:bg-surface-elevated/80 ${
                          isSel ? "conn-row-selected" : ""
                        }`}
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
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </aside>
      </div>

      {/* Event ticker */}
      <div className="pointer-events-auto relative z-10">
        <div className="panel-glass ticker-track overflow-hidden rounded-xl px-3 py-2">
          <div className="flex items-center gap-3">
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-accent">
              Feed
            </span>
            <div className="min-w-0 flex-1 overflow-hidden">
              {events.length === 0 ? (
                <p className="truncate font-mono text-[11px] text-faint">
                  Events appear here as peers light up the globe…
                </p>
              ) : (
                <ul className="flex gap-6 overflow-x-auto pb-0.5">
                  {events.slice(0, 12).map((ev) => (
                    <li
                      key={`${ev.id}-${ev.at}`}
                      className="event-flash shrink-0 font-mono text-[11px]"
                    >
                      <span
                        className={
                          ev.direction === "inbound"
                            ? "text-primary"
                            : "text-warn"
                        }
                      >
                        {ev.direction === "inbound" ? "↓" : "↑"}
                      </span>{" "}
                      <span className="text-fg">{ev.protocol}</span>
                      <span className="text-muted">
                        {" "}
                        · {ev.city}, {ev.country}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Mobile strip */}
        <div className="panel-glass mt-2 rounded-xl md:hidden">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-faint">
              <Radio className="size-3 text-primary" />
              Recent
            </div>
            <select
              value={connFilter}
              onChange={(e) => setConnFilter(e.target.value as ConnFilter)}
              className="h-7 max-w-[9rem] rounded-md border border-border bg-surface-elevated px-2 font-mono text-[10px] text-fg"
            >
              {filterOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <ul className="flex gap-2 overflow-x-auto px-2 py-2">
            {filteredConnections.slice(0, 8).map((c) => (
              <li key={c.id} className="min-w-[9.5rem] shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left ${
                    c.id === selectedId
                      ? "border-primary/40 bg-primary/10"
                      : "border-border bg-surface"
                  }`}
                >
                  <p className="truncate text-xs font-medium text-fg">
                    {c.city}, {c.country}
                  </p>
                  <p className="font-mono text-[10px] text-muted">{c.protocol}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <p className="pointer-events-none mt-2 hidden text-center text-[11px] text-faint sm:block">
          Drag to orbit · Scroll to zoom · Click a connection to focus · Sound
          toggle for blips
        </p>
      </div>
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
