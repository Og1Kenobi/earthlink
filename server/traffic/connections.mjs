import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";

const execFileAsync = promisify(execFile);

/** Well-known ports → protocol label (TCP or UDP) */
const PORT_PROTO = {
  20: "FTP",
  21: "FTP",
  22: "SSH",
  23: "Telnet",
  25: "SMTP",
  53: "DNS",
  67: "DHCP",
  68: "DHCP",
  80: "HTTP",
  110: "POP3",
  123: "NTP",
  143: "IMAP",
  161: "SNMP",
  162: "SNMP",
  443: "HTTPS",
  465: "SMTPS",
  500: "IKE",
  587: "SMTP",
  853: "DoT",
  993: "IMAPS",
  995: "POP3S",
  1194: "OpenVPN",
  1433: "MSSQL",
  1521: "Oracle",
  3306: "MySQL",
  3389: "RDP",
  4500: "IPSec",
  51820: "WireGuard",
  5432: "Postgres",
  5900: "VNC",
  6379: "Redis",
  6443: "K8s",
  8080: "HTTP",
  8443: "HTTPS",
  9200: "ES",
  27017: "Mongo",
};

const UDP_PORT_PROTO = {
  53: "DNS",
  67: "DHCP",
  68: "DHCP",
  123: "NTP",
  161: "SNMP",
  443: "QUIC",
  853: "DoQ",
  1194: "OpenVPN",
  4500: "IPSec",
  51820: "WireGuard",
};

const EPHEMERAL_MIN = 32768;

/** Skip sudo conntrack after it fails (avoids journal spam). */
let conntrackSudoOk = null; // null unknown, true works, false no
let conntrackSudoRetryAt = 0;
const CONNTRACK_SUDO_RETRY_MS = 10 * 60 * 1000;

export function protocolForPort(port, transport = "tcp") {
  if (transport === "icmp") return "PING";
  if (transport === "udp") {
    return UDP_PORT_PROTO[port] ?? PORT_PROTO[port] ?? `UDP/${port}`;
  }
  return PORT_PROTO[port] ?? `TCP/${port}`;
}

export function isWellKnownPort(port) {
  return (
    PORT_PROTO[port] != null ||
    UDP_PORT_PROTO[port] != null ||
    (port > 0 && port < 1024)
  );
}

export function isLoopback(ip) {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "0.0.0.0" ||
    ip === "::" ||
    ip.startsWith("127.")
  );
}

export function isPrivateIp(ip) {
  if (isLoopback(ip)) return true;
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return (
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80") ||
      lower === "::1"
    );
  }
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function parseEndpoint(raw) {
  const s = String(raw || "").trim();
  if (!s || s === "*:*" || s === "*.*") return null;

  // macOS style: 1.2.3.4.443 or *.1234
  if (/^\d+\.\d+\.\d+\.\d+\.\d+$/.test(s) || /^\*\.\d+$/.test(s)) {
    const lastDot = s.lastIndexOf(".");
    const ip = s.slice(0, lastDot).replace(/^\*$/, "0.0.0.0");
    const port = Number(s.slice(lastDot + 1));
    if (!Number.isFinite(port)) return null;
    return { ip, port };
  }

  if (s.startsWith("[")) {
    const close = s.indexOf("]");
    if (close === -1) return null;
    const ip = s.slice(1, close);
    const rest = s.slice(close + 1);
    const port = Number(rest.startsWith(":") ? rest.slice(1) : rest);
    return { ip, port: Number.isFinite(port) ? port : 0 };
  }

  const v6DotPort = /^([0-9a-fA-F:]+)\.(\d+)$/.exec(s);
  if (v6DotPort && s.includes(":")) {
    return { ip: v6DotPort[1], port: Number(v6DotPort[2]) };
  }

  const i = s.lastIndexOf(":");
  if (i === -1) return null;
  const ip = s.slice(0, i);
  const port = Number(s.slice(i + 1));
  if (!ip || !Number.isFinite(port)) return null;
  return { ip: ip === "*" ? "0.0.0.0" : ip, port };
}

export function classifyDirection(localPort, remotePort, listeningPorts) {
  const localListen =
    listeningPorts.has(localPort) ||
    (localPort > 0 && localPort < 1024) ||
    isWellKnownPort(localPort);
  const remoteService =
    isWellKnownPort(remotePort) || (remotePort > 0 && remotePort < 1024);

  if (localListen && !remoteService) return "inbound";
  if (remoteService && !localListen) return "outbound";
  if (localListen && remoteService) {
    if (listeningPorts.has(localPort)) return "inbound";
    if (remotePort < localPort) return "outbound";
    return "inbound";
  }
  if (localPort >= EPHEMERAL_MIN && remotePort < EPHEMERAL_MIN) return "outbound";
  if (remotePort >= EPHEMERAL_MIN && localPort < EPHEMERAL_MIN) return "inbound";
  return "outbound";
}

export function enrichSocket(base, listeningPorts = new Set()) {
  const transport = base.transport || "tcp";
  const direction =
    base.direction ||
    classifyDirection(base.localPort, base.remotePort, listeningPorts);

  let servicePort;
  let peerPort;
  if (direction === "inbound") {
    servicePort = base.localPort;
    peerPort = base.remotePort;
  } else {
    servicePort = base.remotePort;
    peerPort = base.localPort;
  }

  const protocol =
    base.protocol ||
    protocolForPort(servicePort ?? base.remotePort ?? 0, transport);

  return {
    ...base,
    transport,
    direction,
    servicePort: servicePort ?? base.remotePort ?? 0,
    peerPort: peerPort ?? base.localPort ?? 0,
    protocol,
    displayPort: servicePort ?? base.remotePort ?? 0,
    private: base.private ?? isPrivateIp(base.remoteIp),
  };
}

function hexToIpv4(hex) {
  if (!hex || hex.length !== 8) return null;
  const n = parseInt(hex, 16);
  if (!Number.isFinite(n)) return null;
  return [
    n & 0xff,
    (n >> 8) & 0xff,
    (n >> 16) & 0xff,
    (n >> 24) & 0xff,
  ].join(".");
}

function hexToIpv6(hex) {
  if (!hex || hex.length !== 32) return null;
  try {
    const bytes = [];
    for (let i = 0; i < 32; i += 2) {
      bytes.push(parseInt(hex.slice(i, i + 2), 16));
    }
    const be = [];
    for (let i = 0; i < 16; i += 4) {
      be.push(bytes[i + 3], bytes[i + 2], bytes[i + 1], bytes[i]);
    }
    const hextets = [];
    for (let i = 0; i < 16; i += 2) {
      hextets.push(((be[i] << 8) | be[i + 1]).toString(16));
    }
    return hextets.join(":");
  } catch {
    return null;
  }
}

function isZeroRemote(ip, port, ipv6) {
  if (port === 0) return true;
  if (!ip) return true;
  if (ip === "0.0.0.0") return true;
  if (ipv6 && (ip === "::" || ip === "0:0:0:0:0:0:0:0")) return true;
  return false;
}

function parseProcTcp(text, ipv6 = false) {
  const established = [];
  const listeningPorts = new Set();
  const lines = text.split("\n");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(/\s+/);
    if (cols.length < 4) continue;
    const st = parseInt(cols[3], 16);

    const [lAddr, lPortHex] = cols[1].split(":");
    const [rAddr, rPortHex] = cols[2].split(":");
    const localPort = parseInt(lPortHex, 16);
    const remotePort = parseInt(rPortHex, 16);
    const localIp = ipv6 ? hexToIpv6(lAddr) : hexToIpv4(lAddr);
    const remoteIp = ipv6 ? hexToIpv6(rAddr) : hexToIpv4(rAddr);
    if (!localIp) continue;

    if (st === 0x0a) {
      if (Number.isFinite(localPort)) listeningPorts.add(localPort);
      continue;
    }
    if (![0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x08, 0x09].includes(st)) {
      continue;
    }
    if (!remoteIp || isZeroRemote(remoteIp, remotePort, ipv6)) continue;
    if (isLoopback(remoteIp) || isLoopback(localIp)) continue;

    const key = `tcp|${remoteIp}|${remotePort}|${localIp}|${localPort}`;
    established.push({
      transport: "tcp",
      localIp,
      localPort,
      remoteIp,
      remotePort,
      key,
      private: isPrivateIp(remoteIp),
    });
  }

  return { established, listeningPorts };
}

function parseProcUdp(text, ipv6 = false) {
  const rows = [];
  const listeningPorts = new Set();
  const lines = text.split("\n");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(/\s+/);
    if (cols.length < 3) continue;

    const [lAddr, lPortHex] = cols[1].split(":");
    const [rAddr, rPortHex] = cols[2].split(":");
    const localPort = parseInt(lPortHex, 16);
    const remotePort = parseInt(rPortHex, 16);
    const localIp = ipv6 ? hexToIpv6(lAddr) : hexToIpv4(lAddr);
    const remoteIp = ipv6 ? hexToIpv6(rAddr) : hexToIpv4(rAddr);
    if (!localIp) continue;

    if (!remoteIp || isZeroRemote(remoteIp, remotePort, ipv6)) {
      if (Number.isFinite(localPort) && localPort > 0) {
        listeningPorts.add(localPort);
      }
      continue;
    }
    if (isLoopback(remoteIp) || isLoopback(localIp)) continue;

    const key = `udp|${remoteIp}|${remotePort}|${localIp}|${localPort}`;
    rows.push({
      transport: "udp",
      localIp,
      localPort,
      remoteIp,
      remotePort,
      key,
      private: isPrivateIp(remoteIp),
    });
  }

  return { rows, listeningPorts };
}

export function parseConntrack(text, localIps = new Set()) {
  const out = [];
  const seen = new Set();

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("conntrack v")) continue;

    const protoMatch = /\b(tcp|udp|icmp|icmpv6)\b/i.exec(trimmed);
    if (!protoMatch) continue;
    const transport = protoMatch[1].toLowerCase().replace("icmpv6", "icmp");

    const pairs = [...trimmed.matchAll(/\b(src|dst|sport|dport|type)=([^\s]+)/g)];
    /** @type {Record<string, string[]>} */
    const bag = {};
    for (const m of pairs) {
      const k = m[1];
      const v = m[2];
      if (!bag[k]) bag[k] = [];
      bag[k].push(v);
    }
    const srcs = bag.src || [];
    const dsts = bag.dst || [];
    const sports = bag.sport || [];
    const dports = bag.dport || [];

    if (srcs.length < 1 || dsts.length < 1) continue;

    let localIp = srcs[0];
    let remoteIp = dsts[0];
    let localPort = Number(sports[0] || 0);
    let remotePort = Number(dports[0] || 0);
    let direction = "outbound";

    if (localIps.size && localIps.has(dsts[0]) && !localIps.has(srcs[0])) {
      remoteIp = srcs[0];
      localIp = dsts[0];
      remotePort = Number(sports[0] || 0);
      localPort = Number(dports[0] || 0);
      direction = "inbound";
    } else if (localIps.size && localIps.has(srcs[0])) {
      direction = "outbound";
    }

    if (transport === "icmp") {
      remotePort = 0;
      localPort = 0;
    }

    if (!remoteIp || isLoopback(remoteIp) || isLoopback(localIp)) continue;

    const key = `${transport}|${remoteIp}|${remotePort}|${localIp}|${localPort}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(
      enrichSocket(
        {
          transport,
          localIp,
          localPort,
          remoteIp,
          remotePort,
          key,
          direction,
          private: isPrivateIp(remoteIp),
          protocol:
            transport === "icmp"
              ? "PING"
              : protocolForPort(
                  direction === "inbound" ? localPort : remotePort,
                  transport,
                ),
        },
        new Set(),
      ),
    );
  }
  return out;
}

async function readLocalIps() {
  const ips = new Set();
  try {
    const os = await import("node:os");
    const ifs = os.networkInterfaces();
    for (const list of Object.values(ifs)) {
      for (const a of list || []) {
        if (a?.address) ips.add(a.address);
      }
    }
  } catch {
    // ignore
  }
  return ips;
}

async function tryExec(bin, args) {
  try {
    const r = await execFileAsync(bin, args, {
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return r.stdout || "";
  } catch {
    return "";
  }
}

async function execConntrackList() {
  // Prefer /proc (no sudo, no spam)
  try {
    const text = await fs.readFile("/proc/net/nf_conntrack", "utf8");
    if (text) return text;
  } catch {
    // missing on many systems
  }

  // Plain conntrack (may work if already root / caps)
  for (const bin of ["conntrack", "/usr/sbin/conntrack", "/sbin/conntrack"]) {
    const out = await tryExec(bin, ["-L"]);
    if (out) return out;
  }

  // sudo -n only when not known-bad (or retry after cooldown)
  const now = Date.now();
  const canTrySudo =
    conntrackSudoOk === true ||
    (conntrackSudoOk !== false && now >= conntrackSudoRetryAt) ||
    (conntrackSudoOk === false && now >= conntrackSudoRetryAt);

  if (canTrySudo && process.env.EARTHLINK_SKIP_CONNTRACK_SUDO !== "1") {
    for (const [bin, args] of [
      ["sudo", ["-n", "conntrack", "-L"]],
      ["sudo", ["-n", "/usr/sbin/conntrack", "-L"]],
    ]) {
      const out = await tryExec(bin, args);
      if (out) {
        conntrackSudoOk = true;
        return out;
      }
    }
    // Failed — back off so journal is not flooded every poll
    conntrackSudoOk = false;
    conntrackSudoRetryAt = now + CONNTRACK_SUDO_RETRY_MS;
  }

  return "";
}

async function readFromConntrack() {
  const text = await execConntrackList();
  if (!text) return [];
  const localIps = await readLocalIps();
  return parseConntrack(text, localIps);
}

async function readFromProc() {
  const out = [];
  const listening = new Set();
  try {
    const tcp = await fs.readFile("/proc/net/tcp", "utf8");
    const p = parseProcTcp(tcp, false);
    out.push(...p.established);
    for (const x of p.listeningPorts) listening.add(x);
  } catch {
    // not linux
  }
  try {
    const tcp6 = await fs.readFile("/proc/net/tcp6", "utf8");
    const p = parseProcTcp(tcp6, true);
    out.push(...p.established);
    for (const x of p.listeningPorts) listening.add(x);
  } catch {
    // optional
  }
  try {
    const udp = await fs.readFile("/proc/net/udp", "utf8");
    const p = parseProcUdp(udp, false);
    out.push(...p.rows);
    for (const x of p.listeningPorts) listening.add(x);
  } catch {
    // optional
  }
  try {
    const udp6 = await fs.readFile("/proc/net/udp6", "utf8");
    const p = parseProcUdp(udp6, true);
    out.push(...p.rows);
    for (const x of p.listeningPorts) listening.add(x);
  } catch {
    // optional
  }

  let ct = [];
  try {
    ct = await readFromConntrack();
  } catch {
    ct = [];
  }

  const seen = new Set(out.map((s) => s.key));
  for (const s of ct) {
    if (!seen.has(s.key)) {
      seen.add(s.key);
      out.push(s);
    }
  }

  return out.map((s) => enrichSocket(s, listening));
}

async function readListeningPortsFromSs(bin) {
  const listening = new Set();
  try {
    const r = await execFileAsync(bin, ["-H", "-tln"], {
      timeout: 3000,
      maxBuffer: 2 * 1024 * 1024,
    });
    for (const line of (r.stdout || "").split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      const local = parseEndpoint(parts[3] || parts[2]);
      if (local?.port) listening.add(local.port);
    }
  } catch {
    // ignore
  }
  return listening;
}

function parseSs(stdout, listeningPorts = new Set(), transport = "tcp") {
  const out = [];
  const seen = new Set();
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) continue;
    let localRaw;
    let peerRaw;
    if (/^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      localRaw = parts[2];
      peerRaw = parts[3];
    } else if (
      parts[0] === "tcp" ||
      parts[0] === "tcp6" ||
      parts[0] === "udp" ||
      parts[0] === "udp6"
    ) {
      localRaw = parts[3];
      peerRaw = parts[4];
    } else if (/^\d+$/.test(parts[1]) && /^\d+$/.test(parts[2])) {
      localRaw = parts[3];
      peerRaw = parts[4];
    } else {
      localRaw = parts[parts.length - 2];
      peerRaw = parts[parts.length - 1];
      if (peerRaw?.startsWith("users:")) {
        localRaw = parts[parts.length - 3];
        peerRaw = parts[parts.length - 2];
      }
    }

    const local = parseEndpoint(localRaw);
    const peer = parseEndpoint(peerRaw);
    if (!local || !peer) continue;
    if (isLoopback(peer.ip) || isLoopback(local.ip)) continue;
    if (peer.port === 0 && peer.ip === "0.0.0.0") continue;

    const key = `${transport}|${peer.ip}|${peer.port}|${local.ip}|${local.port}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(
      enrichSocket(
        {
          transport,
          localIp: local.ip,
          localPort: local.port,
          remoteIp: peer.ip,
          remotePort: peer.port,
          key,
          private: isPrivateIp(peer.ip),
        },
        listeningPorts,
      ),
    );
  }
  return out;
}

function parseNetstat(stdout, listeningPorts = new Set()) {
  const out = [];
  const seen = new Set();
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const isTcp = /^tcp/i.test(trimmed);
    const isUdp = /^udp/i.test(trimmed);
    if (!isTcp && !isUdp) continue;
    if (/LISTEN/i.test(trimmed)) {
      const parts = trimmed.split(/\s+/);
      const local = parseEndpoint(parts[3] || parts[1]);
      if (local?.port) listeningPorts.add(local.port);
      continue;
    }
    if (
      isTcp &&
      !/ESTABLISHED|SYN|TIME_WAIT|FIN_WAIT|CLOSE_WAIT/i.test(trimmed)
    ) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;
    const local = parseEndpoint(parts[3]);
    const peer = parseEndpoint(parts[4]);
    if (!local || !peer) continue;
    if (isLoopback(peer.ip) || isLoopback(local.ip)) continue;
    const transport = isUdp ? "udp" : "tcp";
    const key = `${transport}|${peer.ip}|${peer.port}|${local.ip}|${local.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      enrichSocket(
        {
          transport,
          localIp: local.ip,
          localPort: local.port,
          remoteIp: peer.ip,
          remotePort: peer.port,
          key,
          private: isPrivateIp(peer.ip),
        },
        listeningPorts,
      ),
    );
  }
  return out;
}

async function readFromSs() {
  const bins = ["ss", "/usr/sbin/ss", "/sbin/ss", "/usr/bin/ss"];
  let lastErr = null;
  for (const bin of bins) {
    try {
      const listening = await readListeningPortsFromSs(bin);
      const out = [];
      for (const [args, transport] of [
        [["-H", "-tn"], "tcp"],
        [["-H", "-un"], "udp"],
      ]) {
        try {
          const r = await execFileAsync(bin, args, {
            timeout: 4000,
            maxBuffer: 4 * 1024 * 1024,
          });
          out.push(...parseSs(r.stdout ?? "", listening, transport));
        } catch {
          // ignore
        }
      }
      if (out.length) return out;
    } catch (err) {
      lastErr = err;
    }
  }
  try {
    const r = await execFileAsync("netstat", ["-tun"], {
      timeout: 4000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return parseNetstat(r.stdout ?? "", new Set());
  } catch {
    throw lastErr ?? new Error("ss/netstat unavailable");
  }
}

export async function readLinuxConnections() {
  const fromProc = await readFromProc();
  if (fromProc.length > 0) return fromProc;

  try {
    const fromSs = await readFromSs();
    if (fromSs.length > 0) return fromSs;
  } catch {
    // fall through
  }

  try {
    await fs.access("/proc/net/tcp");
    return fromProc;
  } catch {
    try {
      return await readFromSs();
    } catch (err) {
      throw new Error(`Cannot read sockets: ${err?.message ?? err}`);
    }
  }
}

export async function readEstablishedTcp() {
  return readAllConnections();
}

/**
 * Cross-platform entry: Linux / macOS / Windows (dynamic import avoids cycles).
 */
export async function readAllConnections() {
  const plat = process.platform;
  if (plat === "darwin") {
    const { readDarwinConnections } = await import("./platforms/darwin.mjs");
    return readDarwinConnections();
  }
  if (plat === "win32") {
    const { readWin32Connections } = await import("./platforms/win32.mjs");
    return readWin32Connections();
  }
  try {
    return await readLinuxConnections();
  } catch (err) {
    if (plat === "linux") throw err;
    try {
      const r = await execFileAsync("netstat", ["-an"], {
        timeout: 5000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return parseNetstat(r.stdout ?? "", new Set());
    } catch {
      throw err;
    }
  }
}

export function platformId() {
  const p = process.platform;
  if (p === "darwin") return "macos";
  if (p === "win32") return "windows";
  if (p === "linux") return "linux";
  return p;
}
