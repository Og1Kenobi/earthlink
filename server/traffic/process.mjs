import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";

const execFileAsync = promisify(execFile);

/**
 * Map "localIp:localPort-remoteIp:remotePort" → { process, pid }
 * Uses `ss -p` when available; falls back to /proc inode walk.
 */
export async function loadProcessMap() {
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

    // find local peer columns — usually near end before users:
    const withoutUsers = trimmed.replace(/\s*users:.*$/, "");
    const parts = withoutUsers.split(/\s+/);
    if (parts.length < 4) continue;
    let localRaw = parts[parts.length - 2];
    let peerRaw = parts[parts.length - 1];
    // ss -H -tnp sometimes: Recv-Q Send-Q Local Peer
    if (/^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      localRaw = parts[2];
      peerRaw = parts[3];
    }
    const local = parseEndpoint(localRaw);
    const peer = parseEndpoint(peerRaw);
    if (!local || !peer) continue;

    const key = `${local.ip}|${local.port}|${peer.ip}|${peer.port}`;
    map.set(key, { process, pid });
    // also reverse-friendly key without local ip variance
    map.set(`${local.port}|${peer.ip}|${peer.port}`, { process, pid });
  }
}

async function loadFromProcInodes() {
  const map = new Map();
  // inode → process
  const inodeToProc = new Map();
  let pids;
  try {
    pids = await fs.readdir("/proc");
  } catch {
    return map;
  }

  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue;
    let fdEntries;
    try {
      fdEntries = await fs.readdir(`/proc/${pid}/fd`);
    } catch {
      continue;
    }
    let comm = "unknown";
    try {
      comm = (await fs.readFile(`/proc/${pid}/comm`, "utf8")).trim();
    } catch {
      // ignore
    }
    for (const fd of fdEntries) {
      try {
        const link = await fs.readlink(`/proc/${pid}/fd/${fd}`);
        const m = /^socket:\[(\d+)\]$/.exec(link);
        if (!m) continue;
        inodeToProc.set(m[1], { process: comm, pid: Number(pid) });
      } catch {
        // ignore
      }
    }
  }

  for (const file of ["/proc/net/tcp", "/proc/net/tcp6", "/proc/net/udp", "/proc/net/udp6"]) {
    let text;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].trim().split(/\s+/);
      if (cols.length < 10) continue;
      const inode = cols[9];
      const proc = inodeToProc.get(inode);
      if (!proc) continue;
      const [lAddr, lPortHex] = cols[1].split(":");
      const [rAddr, rPortHex] = cols[2].split(":");
      const localPort = parseInt(lPortHex, 16);
      const remotePort = parseInt(rPortHex, 16);
      // store by ports only as weak key
      map.set(`${localPort}|remotePort=${remotePort}`, proc);
      map.set(`inode:${inode}`, proc);
    }
  }

  return map;
}

export function resolveProcess(sock, processMap) {
  if (!processMap || processMap.size === 0) return null;
  const keys = [
    `${sock.localIp}|${sock.localPort}|${sock.remoteIp}|${sock.remotePort}`,
    `${sock.localPort}|${sock.remoteIp}|${sock.remotePort}`,
  ];
  for (const k of keys) {
    const hit = processMap.get(k);
    if (hit) return hit;
  }
  return null;
}
