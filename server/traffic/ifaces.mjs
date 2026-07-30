import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Map local IP → interface name (eth0, wg0, docker0, …)
 */
export async function loadLocalIpIfaces() {
  /** @type {Map<string, string>} */
  const map = new Map();
  try {
    const r = await execFileAsync("ip", ["-o", "addr", "show"], {
      timeout: 3000,
    });
    for (const line of (r.stdout ?? "").split("\n")) {
      // 2: eth0    inet 10.0.0.5/24 ...
      const m = /^\d+:\s+(\S+)\s+inet6?\s+([0-9a-fA-F.:]+)/.exec(line.trim());
      if (!m) continue;
      const iface = m[1].split("@")[0];
      const ip = m[2];
      map.set(ip, iface);
    }
  } catch {
    try {
      const r = await execFileAsync("hostname", ["-I"], { timeout: 2000 });
      for (const ip of (r.stdout ?? "").trim().split(/\s+/)) {
        if (ip) map.set(ip, "host");
      }
    } catch {
      // ignore
    }
  }
  return map;
}

export function parseIfaceFilter(env = process.env.EARTHLINK_IFACES) {
  if (!env || !String(env).trim()) return null;
  return new Set(
    String(env)
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
