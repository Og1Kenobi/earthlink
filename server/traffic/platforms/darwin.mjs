/**
 * macOS connection reader — netstat + optional lsof process names.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  enrichSocket,
  isLoopback,
  isPrivateIp,
  parseEndpoint,
} from "../connections.mjs";

const execFileAsync = promisify(execFile);

async function runNetstat(args) {
  try {
    const r = await execFileAsync("netstat", args, {
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return r.stdout || "";
  } catch (e) {
    return e?.stdout || "";
  }
}

/**
 * Parse macOS `netstat -an -p tcp|udp` lines.
 * Local/foreign often look like: 192.168.1.10.54321  or  *.443
 */
export function parseDarwinNetstat(stdout, transport = "tcp") {
  const out = [];
  const listening = new Set();
  const seen = new Set();

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^Active |^Proto |^tcp[46]?\s+0\s+0\s+\*\.\*/i.test(trimmed) && /LISTEN/i.test(trimmed) === false) {
      // header-ish
    }
    if (!/^(tcp|udp|tcp4|tcp6|udp4|udp6)/i.test(trimmed)) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;

    // Proto Recv-Q Send-Q Local Address Foreign Address (state)
    // indices: 0=proto 1=rq 2=sq 3=local 4=foreign 5=state?
    let localRaw = parts[3];
    let foreignRaw = parts[4];
    let state = parts[5] || "";

    // Sometimes columns shift
    if (!localRaw || !foreignRaw) continue;

    if (/LISTEN/i.test(trimmed)) {
      const local = parseEndpoint(localRaw);
      if (local?.port) listening.add(local.port);
      continue;
    }

    if (transport === "tcp" || /^tcp/i.test(parts[0])) {
      if (state && !/ESTABLISHED|SYN|TIME_WAIT|FIN_WAIT|CLOSE_WAIT|LAST_ACK|CLOSING/i.test(state)) {
        // udp has no state
        if (/^(tcp)/i.test(parts[0])) continue;
      }
    }

    const local = parseEndpoint(localRaw);
    const peer = parseEndpoint(foreignRaw);
    if (!local || !peer) continue;
    if (isLoopback(peer.ip) || isLoopback(local.ip)) continue;
    if (!peer.ip || peer.ip === "0.0.0.0" || peer.ip === "*") continue;
    if (peer.port === 0 && transport !== "udp") continue;

    const t = /^udp/i.test(parts[0]) ? "udp" : "tcp";
    const key = `${t}|${peer.ip}|${peer.port}|${local.ip}|${local.port}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      transport: t,
      localIp: local.ip,
      localPort: local.port,
      remoteIp: peer.ip,
      remotePort: peer.port,
      key,
      private: isPrivateIp(peer.ip),
    });
  }

  return out.map((s) => enrichSocket(s, listening));
}

export async function readDarwinConnections() {
  const [tcpOut, udpOut] = await Promise.all([
    runNetstat(["-an", "-p", "tcp"]),
    runNetstat(["-an", "-p", "udp"]),
  ]);

  const tcp = parseDarwinNetstat(tcpOut, "tcp");
  const udp = parseDarwinNetstat(udpOut, "udp");

  const seen = new Set();
  const merged = [];
  for (const s of [...tcp, ...udp]) {
    if (seen.has(s.key)) continue;
    seen.add(s.key);
    merged.push(s);
  }

  // Attach process names via lsof when possible
  try {
    const procMap = await loadDarwinProcessMap();
    for (const s of merged) {
      const k1 = `${s.localIp}:${s.localPort}-${s.remoteIp}:${s.remotePort}`;
      const k2 = `${s.remoteIp}:${s.remotePort}-${s.localIp}:${s.localPort}`;
      const hit = procMap.get(k1) || procMap.get(k2);
      if (hit) {
        s.process = hit.process;
        s.pid = hit.pid;
      }
    }
  } catch {
    // optional
  }

  return merged;
}

export async function loadDarwinProcessMap() {
  const map = new Map();
  try {
    const r = await execFileAsync("lsof", ["-nP", "-iTCP", "-iUDP", "-sTCP:ESTABLISHED"], {
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
    for (const line of (r.stdout || "").split("\n").slice(1)) {
      // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
      // Chrome  123 user  12u IPv4 ... TCP 10.0.0.1:54321->1.2.3.4:443 (ESTABLISHED)
      const m =
        /^(\S+)\s+(\d+)\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(?:TCP|UDP)\s+(\S+?)(?:->(\S+))?(?:\s+\(.*\))?$/.exec(
          line.trim(),
        );
      if (!m) continue;
      const process = m[1];
      const pid = Number(m[2]);
      const left = parseEndpoint(m[3]?.replace(/^[A-Z]+/, "") || m[3]);
      // NAME is like 10.0.0.1:54321->1.2.3.4:443
      const namePart = line.includes("->")
        ? line.split(/\s+/).pop()?.replace(/\(.*\)/, "").trim()
        : null;
      let local = left;
      let remote = m[4] ? parseEndpoint(m[4]) : null;
      if (namePart && namePart.includes("->")) {
        const [a, b] = namePart.split("->");
        local = parseEndpoint(a);
        remote = parseEndpoint(b);
      }
      if (!local || !remote) continue;
      const k = `${local.ip}:${local.port}-${remote.ip}:${remote.port}`;
      map.set(k, { process, pid });
    }
  } catch {
    // lsof may need permissions
  }
  return map;
}
