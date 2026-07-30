#!/usr/bin/env node
/**
 * Earthlink edge agent — runs on Linux, macOS, or Windows and pushes
 * live sockets to a central Earthlink hub (the machine running `npm start`).
 *
 * Usage:
 *   EARTHLINK_HUB=http://10.11.12.62:8080 \
 *   EARTHLINK_HOST_ID=laptop-mac \
 *   EARTHLINK_AGENT_TOKEN=secret \
 *   node agents/earthlink-agent.mjs
 *
 * Env:
 *   EARTHLINK_HUB          Hub base URL (required)
 *   EARTHLINK_HOST_ID      Agent name (default: hostname)
 *   EARTHLINK_AGENT_TOKEN  Shared secret (must match hub if set)
 *   EARTHLINK_POLL_MS      Push interval (default 2000)
 *   EARTHLINK_INCLUDE_PRIVATE  1 to include LAN peers
 */
import os from "node:os";
import { readAllConnections, platformId, isPrivateIp } from "../server/traffic/connections.mjs";
import { osLabel } from "../server/traffic/platforms/index.mjs";

const hub = (process.env.EARTHLINK_HUB || "").replace(/\/$/, "");
const hostId =
  process.env.EARTHLINK_HOST_ID ||
  process.env.EARTHLINK_HOSTNAME ||
  os.hostname() ||
  "agent";
const token = process.env.EARTHLINK_AGENT_TOKEN || "";
const pollMs = Number(process.env.EARTHLINK_POLL_MS || 2000);
const includePrivate = process.env.EARTHLINK_INCLUDE_PRIVATE === "1";

if (!hub) {
  console.error(
    "[earthlink-agent] set EARTHLINK_HUB=http://your-hub:8080",
  );
  process.exit(1);
}

const osId = platformId();

console.log(
  `[earthlink-agent] ${osLabel(osId)} → ${hub}/api/traffic/ingest as ${hostId}`,
);

async function pushOnce() {
  let socks = [];
  try {
    socks = await readAllConnections();
  } catch (e) {
    console.error("[earthlink-agent] read sockets:", e?.message ?? e);
    return;
  }

  const sockets = socks
    .filter((s) => {
      if (!s.remoteIp) return false;
      if (!includePrivate && (s.private || isPrivateIp(s.remoteIp))) return false;
      return true;
    })
    .map((s) => ({
      key: s.key,
      transport: s.transport,
      localIp: s.localIp,
      localPort: s.localPort,
      remoteIp: s.remoteIp,
      remotePort: s.remotePort,
      direction: s.direction,
      protocol: s.protocol,
      servicePort: s.servicePort,
      displayPort: s.displayPort,
      private: s.private,
      process: s.process || null,
      pid: s.pid ?? null,
      bytes: s.bytes || 0,
    }));

  const body = {
    hostId,
    os: osId,
    hostname: os.hostname(),
    arch: process.arch,
    node: process.version,
    token: token || undefined,
    sockets,
  };

  try {
    const r = await fetch(`${hub}/api/traffic/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-earthlink-token": token } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("[earthlink-agent] hub", r.status, j.error || j);
      return;
    }
    console.log(
      `[earthlink-agent] pushed ${j.accepted ?? sockets.length} sockets · agents=${j.agents?.length ?? "?"}`,
    );
  } catch (e) {
    console.error("[earthlink-agent] push failed:", e?.message ?? e);
  }
}

await pushOnce();
setInterval(() => void pushOnce(), pollMs);
