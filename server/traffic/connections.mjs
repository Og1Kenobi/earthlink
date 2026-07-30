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

function isZeroRemote(ip, port, ipv6) {
  if (port === 0) return true;
  if (!ip) return true;
  if (ipv6) {
    return (
      ip === "0:0:0:0:0:0:0:0" ||
      ip.startsWith("0:0:0:0:0:0:0:") ||
      ip === "::"
    );
  }
  return ip === "0.0.0.0";
}

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

  if (localIsListen && !remoteIsService) {
    return {
      direction: "inbound",
      servicePort: localPort,
      peerPort: remotePort,
    };
  }

  if (remoteIsService && localPort >= 1024) {
    return {
      direction: "outbound",
      servicePort: remotePort,
      peerPort: localPort,
    };
  }

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
  const transport = base.transport || "tcp";
  let direction = base.direction;
  let servicePort = base.servicePort;
  let peerPort = base.peerPort;

  if (!direction) {
    const c = classifyDirection(
      base.localPort ?? 0,
      base.remotePort ?? 0,
      listeningPorts,
    );
    direction = c.direction;
    servicePort = c.servicePort;
    peerPort = c.peerPort;
  }

  if (transport === "icmp") {
    servicePort = 0;
    peerPort = 0;
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
  };
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

/**
 * Parse kernel connection tracking — best source for DNS + ICMP ping.
 * Handles both /proc/net/nf_conntrack and `conntrack -L` text.
 */
export function parseConntrack(text, localIps = new Set()) {
  const out = [];
  const seen = new Set();

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("conntrack v")) continue;

    const protoMatch = /\b(tcp|udp|icmp|icmpv6)\b/i.exec(trimmed);
    if (!protoMatch) continue;
    const transport = protoMatch[1].toLowerCase().replace("icmpv6", "icmp");

    const tokens = [
      ...trimmed.matchAll(/\b(src|dst|sport|dport|type)=([^\s]+)/g),
    ];
    if (!tokens.length) continue;

    const orig = {};
    let half = orig;
    let sawDst = false;
    for (const m of tokens) {
      const k = m[1];
      const v = m[2];
      if (k === "src" && sawDst && half === orig) {
        // reply tuple starts — we only need original direction
        break;
      }
      if (k === "dst") sawDst = true;
      if (k === "src" || k === "dst") half[k] = v;
      if (k === "sport" || k === "dport") half[k] = Number(v);
      if (k === "type") half.type = Number(v);
    }

    if (!orig.src || !orig.dst) continue;

    let localIp;
    let remoteIp;
    let localPort = 0;
    let remotePort = 0;
    let direction = "outbound";

    const origSrcLocal =
      localIps.has(orig.src) ||
      isPrivateIp(orig.src) ||
      isLoopback(orig.src);
    const origDstLocal =
      localIps.has(orig.dst) ||
      isPrivateIp(orig.dst) ||
      isLoopback(orig.dst);

    if (transport === "icmp") {
      if (origSrcLocal && !origDstLocal) {
        localIp = orig.src;
        remoteIp = orig.dst;
        direction = "outbound";
      } else if (origDstLocal && !origSrcLocal) {
        localIp = orig.dst;
        remoteIp = orig.src;
        direction = "inbound";
      } else {
        localIp = orig.src;
        remoteIp = orig.dst;
        direction = "outbound";
      }
    } else {
      const sport = orig.sport ?? 0;
      const dport = orig.dport ?? 0;

      if (origSrcLocal && !isLoopback(orig.dst)) {
        localIp = orig.src;
        remoteIp = orig.dst;
        localPort = sport;
        remotePort = dport;
        direction =
          isWellKnownPort(sport) && !isWellKnownPort(dport)
            ? "inbound"
            : "outbound";
      } else if (origDstLocal && !isLoopback(orig.src)) {
        localIp = orig.dst;
        remoteIp = orig.src;
        localPort = dport;
        remotePort = sport;
        direction = "inbound";
      } else {
        localIp = orig.src;
        remoteIp = orig.dst;
        localPort = sport;
        remotePort = dport;
        if (isWellKnownPort(sport) && !isWellKnownPort(dport)) {
          direction = "inbound";
          localIp = orig.dst;
          remoteIp = orig.src;
          localPort = dport;
          remotePort = sport;
        } else {
          direction = "outbound";
        }
      }
    }

    if (!remoteIp || isLoopback(remoteIp)) continue;
    if (isLoopback(localIp)) continue;

    const key =
      transport === "icmp"
        ? `icmp|${remoteIp}|${localIp}`
        : `${transport}|${remoteIp}|${remotePort}|${localIp}|${localPort}`;

    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      transport,
      localIp,
      localPort,
      remoteIp,
      remotePort,
      key,
      private: isPrivateIp(remoteIp),
      direction,
      servicePort:
        transport === "icmp"
          ? 0
          : direction === "inbound"
            ? localPort
            : remotePort,
      peerPort:
        transport === "icmp"
          ? 0
          : direction === "inbound"
            ? remotePort
            : localPort,
      protocol:
        transport === "icmp"
          ? "PING"
          : protocolForPort(
              direction === "inbound" ? localPort : remotePort,
              transport,
            ),
    });
  }

  return out;
}

async function readLocalIps() {
  const ips = new Set();
  try {
    const r = await execFileAsync("hostname", ["-I"], { timeout: 2000 });
    for (const part of (r.stdout ?? "").trim().split(/\s+/)) {
      if (part) ips.add(part);
    }
  } catch {
    try {
      const r = await execFileAsync("ip", ["-o", "addr", "show"], {
        timeout: 2000,
      });
      for (const line of (r.stdout ?? "").split("\n")) {
        const m = /\binet6?\s+([0-9a-fA-F.:]+)/.exec(line);
        if (m) ips.add(m[1].split("/")[0]);
      }
    } catch {
      // ignore
    }
  }
  return ips;
}

/**
 * Run conntrack dump. Tries:
 *  1) plain conntrack (if CAP_NET_ADMIN)
 *  2) sudo -n conntrack (passwordless sudoers)
 */
async function execConntrackList() {
  const bins = [
    "conntrack",
    "/usr/sbin/conntrack",
    "/sbin/conntrack",
    "/usr/bin/conntrack",
  ];
  const args = ["-L", "-o", "extended"];

  for (const bin of bins) {
    try {
      const r = await execFileAsync(bin, args, {
        timeout: 5000,
        maxBuffer: 12 * 1024 * 1024,
      });
      if (r.stdout && r.stdout.trim()) return r.stdout;
    } catch {
      // try next / sudo
    }
  }

  // passwordless sudo (configure once — see INSTALL notes)
  for (const bin of bins) {
    try {
      const r = await execFileAsync(
        "sudo",
        ["-n", bin, ...args],
        {
          timeout: 5000,
          maxBuffer: 12 * 1024 * 1024,
        },
      );
      if (r.stdout && r.stdout.trim()) return r.stdout;
    } catch {
      // continue
    }
  }

  return null;
}

async function readFromConntrack() {
  // Legacy proc dump (often missing on modern kernels)
  for (const p of ["/proc/net/nf_conntrack", "/proc/net/ip_conntrack"]) {
    try {
      const text = await fs.readFile(p, "utf8");
      if (text.trim()) {
        const localIps = await readLocalIps();
        return parseConntrack(text, localIps);
      }
    } catch {
      // try next
    }
  }

  const stdout = await execConntrackList();
  if (stdout) {
    const localIps = await readLocalIps();
    return parseConntrack(stdout, localIps);
  }
  return [];
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
      const parsed = parseProcTcp(text, ipv6);
      for (const p of parsed.listeningPorts) listeningPorts.add(p);
      for (const row of parsed.established) {
        if (seen.has(row.key)) continue;
        seen.add(row.key);
        established.push(row);
      }
    } catch {
      // ignore
    }
  }

  for (const [file, ipv6] of [
    ["/proc/net/udp", false],
    ["/proc/net/udp6", true],
  ]) {
    try {
      const text = await fs.readFile(file, "utf8");
      const parsed = parseProcUdp(text, ipv6);
      for (const p of parsed.listeningPorts) listeningPorts.add(p);
      for (const row of parsed.rows) {
        if (seen.has(row.key)) continue;
        seen.add(row.key);
        established.push(row);
      }
    } catch {
      // ignore
    }
  }

  try {
    const ct = await readFromConntrack();
    for (const row of ct) {
      if (seen.has(row.key)) continue;
      if (row.transport === "tcp") {
        const alt = `tcp|${row.remoteIp}|${row.remotePort}|${row.localIp}|${row.localPort}`;
        if (seen.has(alt)) continue;
      }
      seen.add(row.key);
      established.push(row);
    }
  } catch {
    // conntrack optional
  }

  return established.map((s) => enrichSocket(s, listeningPorts));
}

async function readListeningPortsFromSs(bin) {
  const ports = new Set();
  try {
    const r = await execFileAsync(bin, ["-H", "-tuln"], {
      timeout: 3000,
      maxBuffer: 2 * 1024 * 1024,
    });
    for (const line of (r.stdout ?? "").split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      const local = parseEndpoint(parts[4] ?? parts[3] ?? parts[2]);
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
      const [tcp, udp] = await Promise.all([
        execFileAsync(bin, ["-H", "-tn", "state", "established"], {
          timeout: 4000,
          maxBuffer: 4 * 1024 * 1024,
        }).catch(() => ({ stdout: "" })),
        execFileAsync(bin, ["-H", "-un"], {
          timeout: 4000,
          maxBuffer: 4 * 1024 * 1024,
        }).catch(() => ({ stdout: "" })),
      ]);
      const out = [
        ...parseSs(tcp.stdout ?? "", listeningPorts, "tcp"),
        ...parseSs(udp.stdout ?? "", listeningPorts, "udp"),
      ];
      // merge conntrack even when ss works
      try {
        const ct = await readFromConntrack();
        const seen = new Set(out.map((s) => s.key));
        for (const row of ct) {
          if (seen.has(row.key)) continue;
          out.push(enrichSocket(row, listeningPorts));
        }
      } catch {
        // ignore
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

export async function readEstablishedTcp() {
  return readAllConnections();
}

export async function readAllConnections() {
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
    const isTcp = trimmed.startsWith("tcp");
    const isUdp = trimmed.startsWith("udp");
    if (!isTcp && !isUdp) continue;
    if (/LISTEN/i.test(trimmed)) {
      const parts = trimmed.split(/\s+/);
      const local = parseEndpoint(parts[3]);
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
