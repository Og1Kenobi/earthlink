import fs from "node:fs";
import readline from "node:readline";

/**
 * Lightweight tail of access logs (nginx/caddy/apache combined-ish).
 * Maps remote IP → last request path/status for correlation on the globe.
 */
export function createAccessLogWatcher(options = {}) {
  const path = options.path ?? process.env.EARTHLINK_ACCESS_LOG ?? "";
  /** @type {Map<string, { path: string, status?: string, method?: string, at: number }>} */
  const byIp = new Map();
  let timer = null;
  let offset = 0;
  let running = false;

  function parseLine(line) {
    // combined: 1.2.3.4 - - [date] "GET /path HTTP/1.1" 200 ...
    const m =
      /^(\S+)\s+\S+\s+\S+\s+\[[^\]]+\]\s+"([A-Z]+)\s+([^"]+?)\s+HTTP\/[^"]+"\s+(\d+)/.exec(
        line,
      );
    if (m) {
      return {
        ip: m[1],
        method: m[2],
        path: m[3].split("?")[0],
        status: m[4],
      };
    }
    // caddy json-ish skip; simple "ip method path"
    const s = /^(\d+\.\d+\.\d+\.\d+)\s+([A-Z]+)\s+(\/\S*)/.exec(line);
    if (s) {
      return { ip: s[1], method: s[2], path: s[3].split("?")[0] };
    }
    return null;
  }

  async function tick() {
    if (!path || !running) return;
    try {
      const st = fs.statSync(path);
      if (st.size < offset) offset = 0; // rotated
      if (st.size === offset) return;

      const stream = fs.createReadStream(path, {
        start: offset,
        end: st.size - 1,
        encoding: "utf8",
      });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) {
        const p = parseLine(line);
        if (!p?.ip) continue;
        byIp.set(p.ip, {
          path: p.path,
          status: p.status,
          method: p.method,
          at: Date.now(),
        });
      }
      offset = st.size;

      // cap map
      if (byIp.size > 5000) {
        const entries = [...byIp.entries()].sort((a, b) => a[1].at - b[1].at);
        for (let i = 0; i < entries.length - 4000; i++) {
          byIp.delete(entries[i][0]);
        }
      }
    } catch {
      // missing log file is fine
    }
  }

  function start() {
    if (!path || running) return;
    running = true;
    try {
      offset = fs.statSync(path).size; // start at end
    } catch {
      offset = 0;
    }
    void tick();
    timer = setInterval(() => void tick(), options.intervalMs ?? 2000);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    running = false;
    if (timer) clearInterval(timer);
    timer = null;
  }

  function lookup(ip) {
    return byIp.get(ip) ?? null;
  }

  return { start, stop, lookup, path };
}
