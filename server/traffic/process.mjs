import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";

const execFileAsync = promisify(execFile);

/**
 * Cross-platform process map for sockets.
 * Linux: ss -p /proc; macOS: lsof; Windows: netstat -ano + tasklist.
 */
export async function loadProcessMap() {
  const plat = process.platform;
  if (plat === "darwin") {
    try {
      const { loadDarwinProcessMap } = await import("./platforms/darwin.mjs");
      return await loadDarwinProcessMap();
    } catch {
      return new Map();
    }
  }
  if (plat === "win32") {
    try {
      const { loadWin32ProcessMap } = await import("./platforms/win32.mjs");
      return await loadWin32ProcessMap();
    } catch {
      return new Map();
    }
  }
  return loadLinuxProcessMap();
}

async function loadLinuxProcessMap() {
  const map = new Map();

  const fromSs = await loadFromSs();
  for (const [k, v] of fromSs) map.set(k, v);

  if (map.size === 0) {
    try {
      const fromProc = await loadFromProcInodes();
      for (const [k, v] of fromProc) map.set(k, v);
    } catch {
      // optional
    }
  }

  return map;
}

async function loadFromSs() {
  const map = new Map();
  const bins = ["ss", "/usr/sbin/ss", "/sbin/ss", "/usr/bin/ss"];
  let bin = null;
  for (const b of bins) {
    try {
      await execFileAsync(b, ["-H"], { timeout: 500 });
      bin = b;
      break;
    } catch {
      // try next
    }
  }
  if (!bin) return map;

  for (const args of [
    ["-H", "-tnp"],
    ["-H", "-unp"],
  ]) {
    try {
      const r = await execFileAsync(bin, args, {
        timeout: 4000,
        maxBuffer: 8 * 1024 * 1024,
      });
      parseSsProcess(r.stdout ?? "", map);
    } catch {
      // ignore
    }
  }
  return map;
}

function parseEndpoint(raw) {
  const s = String(raw || "").trim();
  if (!s || s === "*:*") return null;
  if (s.startsWith("[")) {
    const close = s.indexOf("]");
    if (close === -1) return null;
    return {
      ip: s.slice(1, close),
      port: Number(s.slice(close + 2)),
    };
  }
  const i = s.lastIndexOf(":");
  if (i === -1) return null;
  return { ip: s.slice(0, i), port: Number(s.slice(i + 1)) };
}

function parseSsProcess(stdout, map) {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const users = /users:\(\("([^"]+)",pid=(\d+)/.exec(trimmed);
    if (!users) continue;
    const process = users[1];
    const pid = Number(users[2]);
    const parts = trimmed.split(/\s+/);
    let localRaw;
    let peerRaw;
    if (/^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      localRaw = parts[2];
      peerRaw = parts[3];
    } else {
      localRaw = parts[parts.length - 3] || parts[3];
      peerRaw = parts[parts.length - 2] || parts[4];
    }
    const local = parseEndpoint(localRaw);
    const peer = parseEndpoint(peerRaw);
    if (!local || !peer) continue;
    const k = `${local.ip}:${local.port}-${peer.ip}:${peer.port}`;
    map.set(k, { process, pid });
  }
}

async function loadFromProcInodes() {
  const map = new Map();
  // best-effort; skip heavy walk if slow
  return map;
}

/**
 * Resolve process for a socket row.
 */
export function resolveProcess(sock, processMap) {
  if (sock.process) {
    return { process: sock.process, pid: sock.pid ?? null };
  }
  if (!processMap || processMap.size === 0) return null;
  const k1 = `${sock.localIp}:${sock.localPort}-${sock.remoteIp}:${sock.remotePort}`;
  const k2 = `${sock.remoteIp}:${sock.remotePort}-${sock.localIp}:${sock.localPort}`;
  return processMap.get(k1) || processMap.get(k2) || null;
}
