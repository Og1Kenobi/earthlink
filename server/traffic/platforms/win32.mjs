/**
 * Windows connection reader — netstat -ano / PowerShell fallback.
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

async function run(cmd, args) {
  try {
    const r = await execFileAsync(cmd, args, {
      timeout: 8000,
      maxBuffer: 12 * 1024 * 1024,
      windowsHide: true,
    });
    return r.stdout || "";
  } catch (e) {
    return e?.stdout || "";
  }
}

/**
 * Parse Windows `netstat -ano` output.
 * TCP    192.168.1.5:54321    1.2.3.4:443    ESTABLISHED    1234
 */
export function parseWinNetstat(stdout) {
  const out = [];
  const listening = new Set();
  const seen = new Set();
  const pidByKey = new Map();

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!/^(TCP|UDP)/i.test(trimmed)) continue;

    const parts = trimmed.split(/\s+/);
    // TCP local foreign state pid  OR  UDP local *:* pid
    const proto = parts[0].toUpperCase();
    if (proto === "TCP" && parts.length >= 5) {
      const local = parseEndpoint(parts[1]);
      const foreign = parseEndpoint(parts[2]);
      const state = parts[3];
      const pid = Number(parts[4]);

      if (/LISTENING/i.test(state)) {
        if (local?.port) listening.add(local.port);
        continue;
      }
      // Skip short-lived states that flicker each netstat poll
      if (!/ESTABLISHED|SYN_SENT|SYN_RECV/i.test(state)) {
        continue;
      }
      if (!local || !foreign) continue;
      if (isLoopback(foreign.ip) || isLoopback(local.ip)) continue;
      if (!foreign.ip || foreign.ip === "0.0.0.0" || foreign.ip === "*") continue;

      // Sticky peer key (no local port) — one arc per remote endpoint
      const key = `tcp|${foreign.ip}|${foreign.port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        transport: "tcp",
        localIp: local.ip,
        localPort: local.port,
        remoteIp: foreign.ip,
        remotePort: foreign.port,
        key,
        private: isPrivateIp(foreign.ip),
        pid: Number.isFinite(pid) ? pid : null,
      });
      if (Number.isFinite(pid)) pidByKey.set(key, pid);
    } else if (proto === "UDP" && parts.length >= 3) {
      const local = parseEndpoint(parts[1]);
      // foreign may be *:* and pid last
      let foreignRaw = parts[2];
      let pid = Number(parts[parts.length - 1]);
      if (parts.length >= 4 && !Number.isFinite(Number(parts[2]))) {
        foreignRaw = parts[2];
        pid = Number(parts[3]);
      } else if (parts.length === 3) {
        // UDP 0.0.0.0:53  *:*  1234  — wait, usually 4 cols
        foreignRaw = "*:*";
        pid = Number(parts[2]);
      }
      const foreign = parseEndpoint(foreignRaw);
      if (!local) continue;
      if (!foreign || foreign.ip === "*" || foreign.ip === "0.0.0.0") {
        if (local.port) listening.add(local.port);
        continue;
      }
      if (isLoopback(foreign.ip) || isLoopback(local.ip)) continue;
      const key = `udp|${foreign.ip}|${foreign.port}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        transport: "udp",
        localIp: local.ip,
        localPort: local.port,
        remoteIp: foreign.ip,
        remotePort: foreign.port,
        key,
        private: isPrivateIp(foreign.ip),
        pid: Number.isFinite(pid) ? pid : null,
      });
    }
  }

  return {
    sockets: out.map((s) => enrichSocket(s, listening)),
    pidByKey,
  };
}

async function loadPidNames(pids) {
  /** @type {Map<number, string>} */
  const map = new Map();
  if (!pids.length) return map;
  // tasklist /FO CSV /NH
  try {
    const out = await run("tasklist", ["/FO", "CSV", "/NH"]);
    for (const line of out.split("\n")) {
      // "chrome.exe","1234","Session Name","0","12,345 K"
      const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
      if (!m) continue;
      map.set(Number(m[2]), m[1].replace(/\.exe$/i, ""));
    }
  } catch {
    // ignore
  }
  return map;
}

export async function readWin32Connections() {
  let stdout = await run("netstat", ["-ano"]);
  if (!stdout) {
    // PowerShell fallback
    stdout = await run("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-NetTCPConnection -ErrorAction SilentlyContinue | ForEach-Object { 'TCP {0}:{1} {2}:{3} {4} {5}' -f $_.LocalAddress,$_.LocalPort,$_.RemoteAddress,$_.RemotePort,$_.State,$_.OwningProcess }; Get-NetUDPEndpoint -ErrorAction SilentlyContinue | ForEach-Object { 'UDP {0}:{1} *:* {2}' -f $_.LocalAddress,$_.LocalPort,$_.OwningProcess }",
    ]);
  }

  const { sockets } = parseWinNetstat(stdout);
  const pids = [
    ...new Set(sockets.map((s) => s.pid).filter((p) => Number.isFinite(p))),
  ];
  const names = await loadPidNames(pids);
  for (const s of sockets) {
    if (s.pid && names.has(s.pid)) {
      s.process = names.get(s.pid);
    }
  }
  return sockets;
}

export async function loadWin32ProcessMap() {
  const socks = await readWin32Connections();
  const map = new Map();
  for (const s of socks) {
    if (!s.process) continue;
    const k = `${s.localIp}:${s.localPort}-${s.remoteIp}:${s.remotePort}`;
    map.set(k, { process: s.process, pid: s.pid });
  }
  return map;
}
