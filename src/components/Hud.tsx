import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  Bell,
  BellOff,
  ChevronDown,
  Crosshair,
  Eye,
  EyeOff,
  Expand,
  Globe2,
  History,
  MapPin,
  Minimize2,
  Pause,
  Play,
  Plus,
  Radio,
  Server,
  Shield,
  Trash2,
  Volume2,
  VolumeX,
  Zap,
  X,
} from "lucide-react";
import {
  isIpMuted,
  matchesSecurityPreset,
  useConnectionStore,
  type Connection,
  type SecurityPreset,
} from "@/lib/connection-store";
import { refreshHomeLocation } from "@/components/HomeLocator";
import { resumeFxAudio } from "@/lib/fx-audio";
import { pullServerMutes, syncMuteToServer } from "@/lib/server-mute";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRate(n: number): string {
  if (!n || n < 1) return "—";
  if (n < 1024) return `${n.toFixed(0)} B/s`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB/s`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB/s`;
}

function formatAge(ms: number): string {
  return `${Math.max(0, ms / 1000).toFixed(1)}s`;
}

type ConnFilter = string;

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
    <div className="flex h-8 items-end gap-px" aria-hidden>
      {samples.map((v, i) => {
        const h = Math.max(8, Math.round((v / max) * 100));
        return (
          <div
            key={i}
            className={`spark-bar w-1 rounded-sm ${
              i > samples.length - 4 ? "bg-primary/80" : "bg-accent/35"
            }`}
            style={{ height: `${h}%` }}
          />
        );
      })}
    </div>
  );
}

const PRESETS: { id: SecurityPreset; label: string }[] = [
  { id: "all", label: "All" },
  { id: "security", label: "Security" },
  { id: "web", label: "Web" },
  { id: "noise-off", label: "Noise off" },
];

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
  const mutedActiveCount = useConnectionStore((s) => s.mutedActiveCount);
  const events = useConnectionStore((s) => s.events);
  const selectedId = useConnectionStore((s) => s.selectedId);
  const soundEnabled = useConnectionStore((s) => s.soundEnabled);
  const activityHistory = useConnectionStore((s) => s.activityHistory);
  const mutedPeers = useConnectionStore((s) => s.mutedPeers);
  const topTalkers = useConnectionStore((s) => s.topTalkers);
  const securityPreset = useConnectionStore((s) => s.securityPreset);
  const kiosk = useConnectionStore((s) => s.kiosk);
  const alerts = useConnectionStore((s) => s.alerts);
  const alertsEnabled = useConnectionStore((s) => s.alertsEnabled);
  const history = useConnectionStore((s) => s.history);
  const replayMs = useConnectionStore((s) => s.replayMs);
  const replayWindowMs = useConnectionStore((s) => s.replayWindowMs);
  const hostId = useConnectionStore((s) => s.hostId);

  const setPaused = useConnectionStore((s) => s.setPaused);
  const setIntensity = useConnectionStore((s) => s.setIntensity);
  const setMode = useConnectionStore((s) => s.setMode);
  const spawnConnection = useConnectionStore((s) => s.spawnConnection);
  const clear = useConnectionStore((s) => s.clear);
  const setHome = useConnectionStore((s) => s.setHome);
  const setSelectedId = useConnectionStore((s) => s.setSelectedId);
  const setSoundEnabled = useConnectionStore((s) => s.setSoundEnabled);
  const hydrateMutes = useConnectionStore((s) => s.hydrateMutes);
  const muteIp = useConnectionStore((s) => s.muteIp);
  const unmuteIp = useConnectionStore((s) => s.unmuteIp);
  const setMuteEnabled = useConnectionStore((s) => s.setMuteEnabled);
  const addMuteFromInput = useConnectionStore((s) => s.addMuteFromInput);
  const setSecurityPreset = useConnectionStore((s) => s.setSecurityPreset);
  const setKiosk = useConnectionStore((s) => s.setKiosk);
  const setAlertsEnabled = useConnectionStore((s) => s.setAlertsEnabled);
  const setReplayMs = useConnectionStore((s) => s.setReplayMs);
  const clearAlerts = useConnectionStore((s) => s.clearAlerts);

  const [now, setNow] = useState(() => performance.now());
  const [locating, setLocating] = useState(false);
  const [connFilter, setConnFilter] = useState<ConnFilter>("all");
  const [muteInput, setMuteInput] = useState("");
  const [showMuted, setShowMuted] = useState(true);
  const [showReplay, setShowReplay] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 200);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    hydrateMutes();
    let cancelled = false;
    (async () => {
      const ips = await pullServerMutes();
      if (cancelled) return;
      for (const ip of ips) muteIp(ip, { note: "server" });
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateMutes, muteIp]);

  useEffect(() => {
    if (!alertsEnabled || !alerts[0] || alerts[0].level !== "danger") return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      try {
        new Notification("Earthlink", { body: alerts[0].text });
      } catch {
        /* ignore */
      }
    } else if (Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, [alerts, alertsEnabled]);

  const unmuted = useMemo(
    () =>
      connections
        .filter((c) => !isIpMuted(c.ip, mutedPeers))
        .filter((c) => matchesSecurityPreset(c, securityPreset)),
    [connections, mutedPeers, securityPreset],
  );

  const filtered = useMemo(
    () => unmuted.filter((c) => matchesFilter(c, connFilter)),
    [unmuted, connFilter],
  );

  const selected = useMemo(
    () => unmuted.find((c) => c.id === selectedId) ?? null,
    [unmuted, selectedId],
  );

  const topCountries = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of unmuted) {
      if (c.live === false) continue;
      map.set(c.country, (map.get(c.country) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [unmuted]);

  const historyMin = useMemo(() => {
    if (!history.length) return Date.now() - replayWindowMs;
    return Math.min(...history.map((h) => h.at));
  }, [history, replayWindowMs]);
  const historyMax = Date.now();

  const onMute = (ip: string, label?: string) => {
    muteIp(ip, { label });
    void syncMuteToServer("mute", ip);
    setShowMuted(true);
  };
  const onUnmute = (ip: string) => {
    unmuteIp(ip);
    void syncMuteToServer("unmute", ip);
  };
  const onToggleMuteEnabled = (ip: string, enabled: boolean) => {
    setMuteEnabled(ip, enabled);
    void syncMuteToServer(enabled ? "mute" : "unmute", ip);
  };

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
  const enabledMutes = mutedPeers.filter((p) => p.enabled).length;
  const isReplay = replayMs != null;
  const active =
    agentActiveCount || unmuted.filter((c) => c.live !== false).length;

  if (kiosk) {
    return (
      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-4">
        <div className="vignette absolute inset-0" />
        <header className="pointer-events-auto flex items-start justify-between">
          <div className="panel-glass rounded-xl px-4 py-3">
            <div className="flex items-center gap-2">
              <Globe2 className="size-5 text-primary" />
              <h1 className="text-lg font-semibold text-fg">Earthlink NOC</h1>
              <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                {modeLabel}
              </span>
              {hostId && (
                <span className="font-mono text-[10px] text-faint">{hostId}</span>
              )}
            </div>
            <div className="mt-2 flex gap-6 font-mono text-sm">
              <span className="text-primary">IN {inboundCount}</span>
              <span className="text-warn">OUT {outboundCount}</span>
              <span className="text-fg">ACTIVE {active}</span>
            </div>
            <div className="mt-2">
              <ActivitySpark samples={activityHistory} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => setKiosk(false)}
            className="pointer-events-auto panel-glass inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm text-muted hover:text-fg"
          >
            <Minimize2 className="size-4" />
            Exit kiosk
          </button>
        </header>
        <div className="pointer-events-auto panel-glass ticker-track rounded-xl px-4 py-3">
          <ul className="flex gap-8 overflow-x-auto font-mono text-sm">
            {events.slice(0, 10).map((ev) => (
              <li key={`${ev.id}-${ev.at}`} className="shrink-0">
                <span
                  className={
                    ev.direction === "inbound" ? "text-primary" : "text-warn"
                  }
                >
                  {ev.direction === "inbound" ? "↓" : "↑"}
                </span>{" "}
                <span className="text-fg">{ev.protocol}</span>
                <span className="text-muted">
                  {" "}
                  · {ev.city}, {ev.country}
                  {ev.process ? ` · ${ev.process}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-3 sm:p-5">
      <div className="vignette absolute inset-0" />
      <div className="scanlines absolute inset-0" />

      {/* TOP — full brand + tools (same richness as before) */}
      <header className="pointer-events-auto relative flex flex-wrap items-start justify-between gap-3">
        <div className="panel-glass panel-glow-in max-w-lg rounded-xl px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <Globe2 className="size-5 text-primary" strokeWidth={1.75} />
            <h1 className="text-base font-semibold tracking-tight text-fg sm:text-lg">
              Earthlink
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                mode === "real"
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-surface-elevated text-muted"
              }`}
            >
              {mode === "real" && (
                <span className="pulse-dot size-1.5 rounded-full bg-primary" />
              )}
              {isReplay ? "REPLAY" : modeLabel}
            </span>
          </div>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-muted sm:text-sm">
            Process · ASN · fat arcs · heat trails · mute · presets · replay ·
            alerts
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <ActivitySpark samples={activityHistory} />
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSecurityPreset(p.id)}
                  className={`rounded-md border px-2 py-1 font-mono text-[10px] uppercase transition ${
                    securityPreset === p.id
                      ? "border-primary/50 bg-primary/15 text-primary"
                      : "border-border bg-surface text-muted hover:border-border-strong"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="panel-glass flex flex-wrap items-center gap-2 rounded-xl px-3 py-2">
          <ToolBtn title="Kiosk" onClick={() => setKiosk(true)}>
            <Expand className="size-4" />
          </ToolBtn>
          <ToolBtn
            title="Replay"
            active={showReplay || isReplay}
            onClick={() => {
              setShowReplay((v) => !v);
              if (replayMs != null) setReplayMs(null);
            }}
          >
            <History className="size-4" />
          </ToolBtn>
          <ToolBtn
            title="Alerts"
            active={alertsEnabled}
            onClick={() => setAlertsEnabled(!alertsEnabled)}
          >
            {alertsEnabled ? (
              <Bell className="size-4" />
            ) : (
              <BellOff className="size-4" />
            )}
            {alerts.length > 0 && (
              <span className="font-mono text-[10px] text-danger">
                {alerts.length}
              </span>
            )}
          </ToolBtn>
          <ToolBtn
            title="Muted"
            active={showMuted || enabledMutes > 0}
            warn
            onClick={() => setShowMuted((v) => !v)}
          >
            <Ban className="size-4" />
            <span className="hidden font-mono text-xs sm:inline">
              {enabledMutes || mutedPeers.length}
            </span>
          </ToolBtn>
          <ToolBtn
            title="Sound"
            onClick={() => {
              resumeFxAudio();
              setSoundEnabled(!soundEnabled);
            }}
          >
            {soundEnabled ? (
              <Volume2 className="size-4" />
            ) : (
              <VolumeX className="size-4" />
            )}
          </ToolBtn>
          <ToolBtn
            title="Pause"
            disabled={mode === "real"}
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          </ToolBtn>
          {mode !== "real" && (
            <ToolBtn
              title="Pulse"
              onClick={() => {
                resumeFxAudio();
                spawnConnection();
              }}
            >
              <Zap className="size-4" />
            </ToolBtn>
          )}
          {mode === "demo" && (
            <ToolBtn
              title="Retry agent"
              onClick={() => {
                setMode("connecting");
                window.location.reload();
              }}
            >
              <Server className="size-4" />
            </ToolBtn>
          )}
          <ToolBtn title="Clear" onClick={() => clear()}>
            <Trash2 className="size-4" />
          </ToolBtn>
        </div>
      </header>

      {/*
        MIDDLE: three-column ring around the globe
        Left stack = ALL panels visible (not tabbed)
        Center = empty for globe + optional focus
        Right = full connections
      */}
      <div className="pointer-events-none relative flex min-h-0 flex-1 items-stretch justify-between gap-3 py-3">
        {/* LEFT COLUMN — traffic + talkers + alerts + home + mute, all open */}
        <aside className="pointer-events-auto flex w-[min(100%,16.5rem)] shrink-0 flex-col gap-2.5 self-stretch overflow-y-auto">
          {/* Traffic */}
          <div className="panel-glass rounded-xl p-3 sm:p-4">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-faint">
              <Activity className="size-3.5 text-accent" />
              Traffic
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] uppercase text-faint">Active</p>
                <p className="font-mono text-2xl font-semibold text-primary text-glow">
                  {active}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-faint">Seen</p>
                <p className="font-mono text-2xl font-semibold text-fg">
                  {totalSeen}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-primary/25 bg-primary/10 px-2 py-1.5">
                <p className="flex items-center gap-1 text-[9px] uppercase text-primary">
                  <ArrowDownLeft className="size-3" /> In
                </p>
                <p className="font-mono text-lg font-semibold text-primary">
                  {inboundCount}
                </p>
              </div>
              <div className="rounded-lg border border-warn/25 bg-warn/10 px-2 py-1.5">
                <p className="flex items-center gap-1 text-[9px] uppercase text-warn">
                  <ArrowUpRight className="size-3" /> Out
                </p>
                <p className="font-mono text-lg font-semibold text-warn">
                  {outboundCount}
                </p>
              </div>
            </div>
            {(enabledMutes > 0 || mutedActiveCount > 0) && (
              <p className="mt-2 font-mono text-[10px] text-faint">
                {enabledMutes} muted
                {mutedActiveCount ? ` · ${mutedActiveCount} hidden live` : ""}
              </p>
            )}
            {topCountries.length > 0 && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-[10px] uppercase text-faint">Hot countries</p>
                <ul className="mt-1.5 space-y-1">
                  {topCountries.map(([cc, n]) => (
                    <li
                      key={cc}
                      className="flex justify-between font-mono text-xs text-muted"
                    >
                      <span className="text-fg">{cc}</span>
                      <span className="text-primary">{n}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {mode !== "real" && (
              <div className="mt-3">
                <p className="text-[10px] uppercase text-faint">Demo intensity</p>
                <div className="mt-1.5 flex gap-1">
                  {(["calm", "normal", "busy"] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setIntensity(level)}
                      className={`flex-1 rounded-md border px-2 py-1.5 font-mono text-[10px] uppercase ${
                        intensity === level
                          ? "border-primary/50 bg-primary/15 text-primary"
                          : "border-border bg-surface text-muted"
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {agentError && mode !== "real" && (
              <p className="mt-2 font-mono text-[10px] text-danger">
                Agent: {agentError}
              </p>
            )}
          </div>

          {/* Top talkers — always visible */}
          <div className="panel-glass rounded-xl p-3 sm:p-4">
            <p className="text-[10px] font-medium uppercase tracking-wider text-faint">
              Top talkers
            </p>
            <ul className="mt-2 space-y-1.5">
              {topTalkers.length === 0 ? (
                <li className="text-xs text-muted">Waiting for rates…</li>
              ) : (
                topTalkers.slice(0, 6).map((t) => (
                  <li key={t.ip} className="font-mono text-[10px]">
                    <div className="flex justify-between gap-1 text-fg">
                      <span className="truncate">
                        {t.city || t.ip}
                        {t.process ? ` · ${t.process}` : ""}
                      </span>
                      <span className="shrink-0 text-accent">
                        {formatRate(t.bytesPerSec)}
                      </span>
                    </div>
                    <p className="truncate text-faint">
                      {t.org || t.protocol} · {t.ip}
                    </p>
                  </li>
                ))
              )}
            </ul>
          </div>

          {/* Alerts — always visible */}
          <div className="panel-glass rounded-xl p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium uppercase text-faint">
                <Shield className="size-3.5 text-danger" />
                Alerts
                {alerts.length > 0 && (
                  <span className="rounded-full bg-danger/15 px-1.5 font-mono text-[10px] text-danger">
                    {alerts.length}
                  </span>
                )}
              </div>
              {alerts.length > 0 && (
                <button
                  type="button"
                  onClick={() => clearAlerts()}
                  className="text-[10px] text-muted hover:text-fg"
                >
                  Clear
                </button>
              )}
            </div>
            <ul className="mt-2 max-h-28 space-y-1.5 overflow-y-auto">
              {alerts.length === 0 ? (
                <li className="text-xs text-muted">No alerts yet</li>
              ) : (
                alerts.slice(0, 8).map((a) => (
                  <li
                    key={a.id}
                    className={`rounded-md border px-2 py-1 font-mono text-[10px] ${
                      a.level === "danger"
                        ? "border-danger/30 bg-danger/10 text-danger"
                        : a.level === "warn"
                          ? "border-warn/30 bg-warn/10 text-warn"
                          : "border-border bg-surface text-muted"
                    }`}
                  >
                    {a.text}
                  </li>
                ))
              )}
            </ul>
          </div>

          {/* Home */}
          <div className="panel-glass rounded-xl p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium uppercase text-faint">
                <MapPin className="size-3.5 text-accent" />
                Home
              </div>
              <button
                type="button"
                onClick={onRelocate}
                disabled={locating || mode === "real"}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-elevated px-2 text-[11px] text-muted disabled:opacity-50"
              >
                <Crosshair
                  className={`size-3.5 ${locating ? "animate-spin" : ""}`}
                />
                {locating ? "…" : "Locate"}
              </button>
            </div>
            <p className="mt-2 text-sm font-medium text-fg">
              {homeReady || home.source !== "default"
                ? home.label
                : "Locating…"}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-muted">
              {home.lat.toFixed(4)}°, {home.lon.toFixed(4)}°
            </p>
            {home.ip && (
              <p className="mt-0.5 font-mono text-[11px] text-faint">
                IP {home.ip}
              </p>
            )}
            {home.org && (
              <p className="mt-0.5 font-mono text-[10px] text-faint">{home.org}</p>
            )}
          </div>

          {/* Muted — open by default when any mutes exist */}
          {(showMuted || mutedPeers.length > 0) && (
            <div className="panel-glass rounded-xl p-3 sm:p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium uppercase text-faint">
                  <Ban className="size-3.5 text-warn" />
                  Muted IPs
                </div>
                <button type="button" onClick={() => setShowMuted(false)}>
                  <X className="size-3.5 text-muted" />
                </button>
              </div>
              <form
                className="mt-2 flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  const raw = muteInput.trim();
                  if (addMuteFromInput(raw)) {
                    void syncMuteToServer("mute", raw);
                    setMuteInput("");
                  }
                }}
              >
                <input
                  value={muteInput}
                  onChange={(e) => setMuteInput(e.target.value)}
                  placeholder="8.8.8.8"
                  className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface-elevated px-2 font-mono text-[11px] text-fg outline-none"
                />
                <button
                  type="submit"
                  className="inline-flex h-8 items-center rounded-md border border-warn/30 bg-warn/10 px-2 text-warn"
                >
                  <Plus className="size-3.5" />
                </button>
              </form>
              <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto">
                {mutedPeers.length === 0 ? (
                  <li className="text-xs text-muted">None muted</li>
                ) : (
                  mutedPeers.map((p) => (
                    <li
                      key={p.ip}
                      className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5"
                    >
                      <button
                        type="button"
                        onClick={() => onToggleMuteEnabled(p.ip, !p.enabled)}
                        className={p.enabled ? "text-warn" : "text-faint"}
                      >
                        {p.enabled ? (
                          <EyeOff className="size-3.5" />
                        ) : (
                          <Eye className="size-3.5" />
                        )}
                      </button>
                      <span
                        className={`min-w-0 flex-1 truncate font-mono text-[11px] ${
                          p.enabled ? "text-fg" : "text-faint line-through"
                        }`}
                      >
                        {p.ip}
                      </span>
                      <button type="button" onClick={() => onUnmute(p.ip)}>
                        <Trash2 className="size-3 text-muted hover:text-danger" />
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}

          {/* Focus under left stack on narrow; also bottom-center on wide */}
          {selected && (
            <div className="panel-glass panel-glow-in rounded-xl p-3 sm:p-4 lg:hidden">
              <FocusCard
                selected={selected}
                onClose={() => setSelectedId(null)}
                onMute={() =>
                  onMute(
                    selected.ip,
                    `${selected.city} · ${selected.protocol}`,
                  )
                }
              />
            </div>
          )}
        </aside>

        {/* CENTER — free for globe; focus floats here on large screens */}
        <div className="pointer-events-none relative hidden min-w-0 flex-1 lg:block">
          {selected && (
            <div className="pointer-events-auto absolute bottom-0 left-1/2 w-[min(100%,20rem)] -translate-x-1/2">
              <div className="panel-glass panel-glow-in rounded-xl p-3 sm:p-4">
                <FocusCard
                  selected={selected}
                  onClose={() => setSelectedId(null)}
                  onMute={() =>
                    onMute(
                      selected.ip,
                      `${selected.city} · ${selected.protocol}`,
                    )
                  }
                />
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — connections full height (fills right empty band) */}
        <aside className="pointer-events-auto hidden w-[min(100%,18rem)] shrink-0 flex-col self-stretch md:flex">
          <div className="panel-glass flex min-h-0 flex-1 flex-col rounded-xl">
            <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium uppercase text-faint">
                  <Radio className="size-3.5 text-primary" />
                  Connections
                </div>
                <span className="font-mono text-[10px] text-muted">
                  {filtered.length}
                </span>
              </div>
              <label className="relative block">
                <select
                  value={connFilter}
                  onChange={(e) => setConnFilter(e.target.value)}
                  className="h-9 w-full appearance-none rounded-lg border border-border bg-surface-elevated py-1.5 pl-3 pr-8 font-mono text-[11px] text-fg outline-none"
                >
                  {STATIC_FILTERS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
              </label>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {filtered.length === 0 ? (
                <li className="px-2 py-6 text-center text-xs text-muted">
                  No visible connections
                </li>
              ) : (
                filtered.slice(0, 48).map((c) => {
                  const age = now - c.createdAt;
                  const remaining = Math.max(0, c.ttl - age);
                  const inbound = c.direction === "inbound";
                  const isSel = c.id === selectedId;
                  return (
                    <li key={c.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => {
                          resumeFxAudio();
                          setSelectedId(isSel ? null : c.id);
                        }}
                        className={`w-full rounded-lg px-2.5 py-2 pr-9 text-left hover:bg-surface-elevated/80 ${
                          isSel ? "conn-row-selected" : ""
                        }`}
                      >
                        <p className="truncate text-sm font-medium text-fg">
                          <span
                            className={`mr-1.5 inline-flex items-center rounded px-1 py-0.5 font-mono text-[9px] uppercase ${
                              inbound
                                ? "bg-primary/15 text-primary"
                                : "bg-warn/15 text-warn"
                            }`}
                          >
                            {inbound ? "in" : "out"}
                          </span>
                          {c.city}
                          <span className="ml-1 font-normal text-muted">
                            {c.country}
                          </span>
                        </p>
                        <p className="truncate font-mono text-[11px] text-faint">
                          {c.ip}:{c.port} · {c.protocol}
                          {c.process ? ` · ${c.process}` : ""}
                        </p>
                        {(c.org || c.bytesPerSec) && (
                          <p className="truncate font-mono text-[10px] text-faint">
                            {c.org || "—"}
                            {c.bytesPerSec
                              ? ` · ${formatRate(c.bytesPerSec)}`
                              : ""}
                          </p>
                        )}
                        <div className="mt-1 flex justify-between text-[10px] text-muted">
                          <span>{c.distanceKm.toLocaleString()} km</span>
                          <span className="text-primary">
                            {c.real && c.live ? "●" : formatAge(remaining)}
                          </span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onMute(c.ip, `${c.city} · ${c.protocol}`);
                        }}
                        className="absolute right-1.5 top-2 rounded-md p-1.5 text-faint hover:bg-warn/10 hover:text-warn"
                        title={`Mute ${c.ip}`}
                      >
                        <Ban className="size-3.5" />
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </aside>
      </div>

      {/* BOTTOM — replay + feed */}
      <div className="pointer-events-auto relative z-10 space-y-2">
        {showReplay && (
          <div className="panel-glass rounded-xl px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <History className="size-4 text-accent" />
              <span className="text-xs font-medium uppercase text-faint">
                Replay
              </span>
              <input
                type="range"
                min={historyMin}
                max={historyMax}
                value={replayMs ?? historyMax}
                onChange={(e) => setReplayMs(Number(e.target.value))}
                className="min-w-[12rem] flex-1 accent-[var(--color-accent)]"
              />
              <button
                type="button"
                onClick={() => setReplayMs(null)}
                className={`rounded-md border px-2 py-1 font-mono text-[10px] uppercase ${
                  replayMs == null
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted"
                }`}
              >
                Live
              </button>
              <span className="font-mono text-[10px] text-faint">
                {history.length} events
              </span>
            </div>
          </div>
        )}

        <div className="panel-glass ticker-track overflow-hidden rounded-xl px-3 py-2">
          <div className="flex items-center gap-3">
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-accent">
              Feed
            </span>
            <ul className="flex min-w-0 flex-1 gap-6 overflow-x-auto">
              {events.length === 0 ? (
                <li className="font-mono text-[11px] text-faint">
                  Waiting for peers…
                </li>
              ) : (
                events.slice(0, 12).map((ev) => (
                  <li
                    key={`${ev.id}-${ev.at}`}
                    className="shrink-0 font-mono text-[11px]"
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
                      · {ev.city}
                      {ev.process ? ` · ${ev.process}` : ""}
                      {ev.org ? ` · ${ev.org}` : ""}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>

        {/* Mobile connections */}
        <div className="panel-glass rounded-xl md:hidden">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <span className="flex items-center gap-1 text-[10px] uppercase text-faint">
              <Radio className="size-3 text-primary" /> Connections
            </span>
            <select
              value={connFilter}
              onChange={(e) => setConnFilter(e.target.value)}
              className="h-7 rounded-md border border-border bg-surface-elevated px-1.5 font-mono text-[10px] text-fg"
            >
              {STATIC_FILTERS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <ul className="flex gap-2 overflow-x-auto px-2 py-2">
            {filtered.slice(0, 8).map((c) => (
              <li key={c.id} className="min-w-[9rem] shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedId(c.id === selectedId ? null : c.id)
                  }
                  className={`w-full rounded-lg border px-2 py-1.5 text-left ${
                    c.id === selectedId
                      ? "border-primary/40 bg-primary/10"
                      : "border-border bg-surface"
                  }`}
                >
                  <p className="truncate text-xs font-medium text-fg">
                    {c.city}, {c.country}
                  </p>
                  <p className="truncate font-mono text-[10px] text-muted">
                    {c.protocol}
                    {c.process ? ` · ${c.process}` : ""}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function FocusCard({
  selected,
  onClose,
  onMute,
}: {
  selected: Connection;
  onClose: () => void;
  onMute: () => void;
}) {
  return (
    <>
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase text-faint">Focus</p>
        <button type="button" onClick={onClose}>
          <X className="size-3.5 text-muted" />
        </button>
      </div>
      <p className="mt-1 text-sm font-semibold text-fg">
        {selected.city}, {selected.country}
      </p>
      <p className="mt-0.5 font-mono text-[11px] text-accent">
        {selected.protocol} · {selected.direction}
        {selected.process ? ` · ${selected.process}` : ""}
      </p>
      {selected.org && (
        <p className="mt-0.5 font-mono text-[10px] text-muted">
          {selected.as || selected.org}
        </p>
      )}
      <p className="mt-1 font-mono text-[11px] text-muted">
        {selected.ip}:{selected.port}
      </p>
      {selected.httpPath && (
        <p className="mt-1 truncate font-mono text-[10px] text-primary">
          {selected.httpMethod} {selected.httpPath}
        </p>
      )}
      {selected.iface && (
        <p className="mt-0.5 font-mono text-[10px] text-faint">
          iface {selected.iface}
        </p>
      )}
      <p className="mt-1 text-[11px] text-faint">
        {selected.distanceKm.toLocaleString()} km ·{" "}
        {formatRate(selected.bytesPerSec || 0)} ·{" "}
        {formatBytes(selected.bytes || 0)}
      </p>
      <button
        type="button"
        onClick={onMute}
        className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-warn/35 bg-warn/10 text-xs text-warn"
      >
        <Ban className="size-3.5" />
        Mute this IP
      </button>
    </>
  );
}

function ToolBtn({
  children,
  onClick,
  title,
  active,
  warn,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
  warn?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm transition disabled:opacity-40 ${
        active
          ? warn
            ? "border-warn/40 bg-warn/10 text-warn"
            : "border-accent/40 bg-accent/10 text-accent"
          : "border-border bg-surface-elevated text-fg hover:border-border-strong"
      }`}
    >
      {children}
    </button>
  );
}
