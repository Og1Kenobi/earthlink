import { createTrafficCollector } from "./collector.mjs";

/** Shared singleton for the process. */
let collector = null;

export function getCollector() {
  if (!collector) {
    collector = createTrafficCollector({
      pollMs: Number(process.env.EARTHLINK_POLL_MS || 1500),
      lingerMs: Number(process.env.EARTHLINK_LINGER_MS || 4500),
      includePrivate: process.env.EARTHLINK_INCLUDE_PRIVATE === "1",
    });
    collector.start();
  }
  return collector;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("access-control-allow-origin", "*");
  res.end(payload);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw) resolve({});
        else resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Handle /api/traffic* requests. Returns true if handled.
 * Works with Node http IncomingMessage / ServerResponse and Connect middleware.
 */
export async function handleTrafficApi(req, res, urlPath) {
  const path = urlPath.split("?")[0];
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS" && path.startsWith("/api/traffic")) {
    res.statusCode = 204;
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    res.end();
    return true;
  }

  if (path === "/api/traffic" || path === "/api/traffic/") {
    const c = getCollector();
    await c.pollOnce();
    sendJson(res, 200, c.snapshot());
    return true;
  }

  if (path === "/api/traffic/home") {
    const c = getCollector();
    const home = await c.ensureHome();
    sendJson(res, 200, { ok: true, home });
    return true;
  }

  if (path === "/api/traffic/health") {
    const c = getCollector();
    const snap = c.snapshot();
    sendJson(res, 200, {
      ok: !snap.error,
      mode: "real",
      activeCount: snap.activeCount,
      error: snap.error,
      home: snap.home,
      mutedIps: snap.mutedIps ?? [],
    });
    return true;
  }

  if (path === "/api/traffic/mute") {
    const c = getCollector();
    if (method === "GET") {
      sendJson(res, 200, { ok: true, mutedIps: c.listMuted() });
      return true;
    }
    if (method === "POST") {
      try {
        const body = await readBody(req);
        const results = { muted: [], unmuted: [] };
        for (const ip of body.mute ?? body.add ?? []) {
          if (typeof ip === "string" && c.muteIp(ip)) results.muted.push(ip.trim());
        }
        for (const ip of body.unmute ?? body.remove ?? []) {
          if (typeof ip === "string" && c.unmuteIp(ip)) {
            results.unmuted.push(ip.trim());
          }
        }
        if (typeof body.ip === "string") {
          if (body.enabled === false) {
            c.unmuteIp(body.ip);
            results.unmuted.push(body.ip.trim());
          } else {
            c.muteIp(body.ip);
            results.muted.push(body.ip.trim());
          }
        }
        sendJson(res, 200, {
          ok: true,
          mutedIps: c.listMuted(),
          ...results,
        });
        return true;
      } catch (e) {
        sendJson(res, 400, { ok: false, error: e?.message ?? "bad body" });
        return true;
      }
    }
  }

  if (path === "/api/traffic/stream") {
    // Server-Sent Events for lower latency without a WS dependency
    const c = getCollector();
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    res.write(`: earthlink traffic stream\n\n`);

    const push = () => {
      try {
        const data = JSON.stringify(c.snapshot());
        res.write(`event: traffic\ndata: ${data}\n\n`);
      } catch {
        // client gone
      }
    };
    push();
    const id = setInterval(push, Number(process.env.EARTHLINK_POLL_MS || 1500));
    req.on("close", () => clearInterval(id));
    return true;
  }

  return false;
}
