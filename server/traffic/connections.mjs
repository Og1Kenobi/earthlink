import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";

const execFileAsync = promisify(execFile);

/** Well-known ports → protocol label */
const PORT_PROTO = {
  20: "FTP",
  21: "FTP",
  22: "SSH",
  25: "SMTP",
  53: "DNS",
  80: "HTTP",
  110: "POP3",
  143: "IMAP",
  443: "HTTPS",
  465: "SMTPS",
  587: "SMTP",
  993: "IMAPS",
  995: "POP3S",
  1194: "OpenVPN",
  1433: "MSSQL",
  1521: "Oracle",
  3306: "MySQL",
  3389: "RDP",
  5432: "Postgres",
  5900: "VNC",
  6379: "Redis",
  6443: "K8s",
  8080: "HTTP",
  8443: "HTTPS",
  9200: "ES",
  27017: "Mongo",
};

/** TCP states in /proc/net/tcp */
const TCP_ESTABLISHED = 0x01;
const TCP_LISTEN = 0x0a;

const EPHEMERAL_MIN = 32768; // common Linux local port range start (can be lower)

export function protocolForPort(port) {
  return PORT_PROTO[port] ?? `TCP/${port}`;
}

export function isWellKnownPort(port) {
  return PORT_PROTO[port] != null || (port > 0 && port < 1024);
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
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function parseEndpoint(raw) {
  const s = String(raw).trim();
  if (!s || s === "*:*" || s === "*") return null;

  if (s.startsWith("[")) {
    const close = s.indexOf("]");
    if (close === -1) return null;
    const ip = s.slice(1, close);
    const port = Number(s.slice(close + 2));
    if (!ip || !Number.isFinite(port)) return null;
    return { ip, port };
  }

  const lastColon = s.lastIndexOf(":");
  if (lastColon === -1) return null;
  const host = s.slice(0, lastColon);
  const port = Number(s.slice(lastColon + 1));
  if (!host || !Number.isFinite(port)) return null;
  return { ip: host, port };
}

function hexToIpv4(hex) {
  const n = parseInt(hex, 16);
  if (!Number.isFinite(n)) return null;
  const b0 = n & 0xff;
  const b1 = (n >>> 8) & 0xff;
  const b2 = (n >>> 16) & 0xff;
  const b3 = (n >>> 24) & 0xff;
  return `${b0}.${b1}.${b2}.${b3}`;
}

function hexToIpv6(hex) {
  if (hex.length !== 32) return null;
  const parts = [];
  for (let i = 0; i < 32; i += 8) {
    const word = hex.slice(i, i + 8);
    const n = parseInt(word, 16);
    const b0 = n & 0xff;
    const b1 = (n >>> 8) & 0xff;
    const b2 = (n >>> 16) & 0xff;
    const b3 = (n >>> 24) & 0xff;
    parts.push(
      ((b0 << 8) | b1).toString(16).padStart(4, "0"),
      ((b2 << 8) | b3).toString(16).padStart(4, "0"),
    );
  }
  return parts.join(":").replace(/(^|:)0{1,3}/g, "$1");
}

/**
 * Classify traffic direction relative to this host.
 *
 * - inbound: remote client connected to a local service (we are the server)
 * - outbound: we initiated to a remote service (we are the client)
 */
export function classifyDirection(localPort, remotePort, listeningPorts) {
  const localIsListen =
    listeningPorts.has(localPort) || isWellKnownPort(localPort);
  const remoteIsService = isWellKnownPort(remotePort);

  if (listeningPorts.has(localPort)) {
    return {
      direction: "inbound",
      servicePort: localPort,
      peerPort: remotePort,
    };
  }

  // Local well-known + remote ephemeral → inbound (server without LISTEN visible)
  if (localIsListen && !remoteIsService) {
    return {
      direction: "inbound",
      servicePort: localPort,
      peerPort: remotePort,
    };
  }

  // Remote well-known + local high port → outbound
  if (remoteIsService && localPort >= 1024) {
    return {
      direction: "outbound",
      servicePort: remotePort,
      peerPort: localPort,
    };
  }

  // Both well-known: prefer local as service if it's lower (typical server)
  if (localIsListen && remoteIsService) {
    if (localPort <= remotePort) {
      return {
        direction: "inbound",
        servicePort: localPort,
        peerPort: remotePort,
      };
    }
    return {
      direction: "outbound",
      servicePort: remotePort,
      peerPort: localPort,
    };
  }

  // Heuristic: local ephemeral → outbound; else inbound
  if (localPort >= EPHEMERAL_MIN || localPort > remotePort) {
    return {
      direction: "outbound",
      servicePort: remotePort,
      peerPort: localPort,
    };
  }
  return {
    direction: "inbound",
    servicePort: localPort,
    peerPort: remotePort,
  };
}

function enrichSocket(base, listeningPorts) {
  const { direction, servicePort, peerPort } = classifyDirection(
    base.localPort,
    base.remotePort,
    listeningPorts,
  );
  return {
    ...base,
    direction,
    servicePort,
    peerPort,
    protocol: protocolForPort(servicePort),
    // display port = service side
    displayPort: servicePort,
  };
}

function parseProcNetAll(text, ipv6 = false) {
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

    if (st === TCP_LISTEN) {
      if (Number.isFinite(localPort)) listeningPorts.add(localPort);
      continue;
    }
    if (st !== TCP_ESTABLISHED) continue;
    if (!remoteIp) continue;
    if (isLoopback(remoteIp) || isLoopback(localIp)) continue;

    if (ipv6) {
      if (
        remoteIp === "0:0:0:0:0:0:0:0" ||
        remoteIp.startsWith("0:0:0:0:0:0:0:")
      ) {
        continue;
      }
    }

    const key = `${remoteIp}|${remotePort}|${localIp}|${localPort}`;
    established.push({
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

async function readFromProc() {
  const established = [];
  const listeningPorts = new Set();
  const seen = new Set();

  for (const [file, ipv6] of [
    ["/proc/net/tcp", false],
    ["/proc/net/tcp6", true],
  ]) {
    try {
      const text = await fs.readFile(file, "utf8");
      const parsed = parseProcNetAll(text, ipv6);
      for (const p of parsed.listeningPorts) listeningPorts.add(p);
      for (const row of parsed.established) {
        if (seen.has(row.key)) continue;
        seen.add(row.key);
        established.push(row);
      }
    } catch {
      // ignore missing
    }
  }

  return established.map((s) => enrichSocket(s, listeningPorts));
}

async function readListeningPortsFromSs(bin) {
  const ports = new Set();
  try {
    const r = await execFileAsync(bin, ["-H", "-tln"], {
      timeout: 3000,
      maxBuffer: 2 * 1024 * 1024,
    });
    for (const line of (r.stdout ?? "").split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      // Local Address:Port often column 3
      const local = parseEndpoint(parts[3] ?? parts[2]);
      if (local?.port) ports.add(local.port);
    }
  } catch {
    // ignore
  }
  return ports;
}

async function readFromSs() {
  const paths = ["ss", "/usr/sbin/ss", "/sbin/ss", "/usr/bin/ss"];
  let lastErr;
  for (const bin of paths) {
    try {
      const listeningPorts = await readListeningPortsFromSs(bin);
      const r = await execFileAsync(
        bin,
        ["-H", "-tn", "state", "established"],
        { timeout: 4000, maxBuffer: 4 * 1024 * 1024 },
      );
      return parseSs(r.stdout ?? "", listeningPorts);
    } catch (err) {
      lastErr = err;
    }
  }
  try {
    const r = await execFileAsync("netstat", ["-tn"], {
      timeout: 4000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return parseNetstat(r.stdout ?? "", new Set());
  } catch {
    throw lastErr ?? new Error("ss/netstat unavailable");
  }
}

/**
 * Read established TCP sockets (inbound + outbound) with direction.
 */
export async function readEstablishedTcp() {
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

function parseSs(stdout, listeningPorts = new Set()) {
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
    } else if (parts[0] === "tcp" || parts[0] === "tcp6") {
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

    const key = `${peer.ip}|${peer.port}|${local.ip}|${local.port}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(
      enrichSocket(
        {
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
    if (!trimmed.startsWith("tcp")) continue;
    if (/LISTEN/i.test(trimmed)) {
      const parts = trimmed.split(/\s+/);
      const local = parseEndpoint(parts[3]);
      if (local?.port) listeningPorts.add(local.port);
      continue;
    }
    if (!/ESTABLISHED/i.test(trimmed)) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;
    const local = parseEndpoint(parts[3]);
    const peer = parseEndpoint(parts[4]);
    if (!local || !peer) continue;
    if (isLoopback(peer.ip) || isLoopback(local.ip)) continue;
    const key = `${peer.ip}|${peer.port}|${local.ip}|${local.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      enrichSocket(
        {
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
