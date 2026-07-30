#!/usr/bin/env node
/**
 * Earthlink self-host server
 *
 * - /api/traffic*  → real TCP sockets on this host
 * - static assets  → .vercel/output/static (or dist)
 * - everything else → TanStack Start / Nitro SSR handler
 *
 *   npm run build
 *   npm start
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { handleTrafficApi, getCollector } from "./traffic/http-api.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";

const staticCandidates = [
  path.join(root, ".vercel", "output", "static"),
  path.join(root, "dist", "client"),
  path.join(root, "dist"),
  path.join(root, ".output", "public"),
  path.join(root, "public"),
];

const nitroCandidates = [
  path.join(root, ".vercel", "output", "functions", "__server.func", "index.mjs"),
  path.join(root, ".output", "server", "index.mjs"),
];

function findExisting(dirs) {
  for (const d of dirs) {
    if (fs.existsSync(d)) return d;
  }
  return null;
}

const staticRoot = findExisting(staticCandidates);
const nitroPath = findExisting(nitroCandidates);

/** @type {{ fetch: (req: Request, ctx?: unknown) => Promise<Response> } | null} */
let nitroHandler = null;

async function loadNitro() {
  if (!nitroPath) return null;
  try {
    const mod = await import(pathToFileURL(nitroPath).href);
    const handler = mod.default ?? mod;
    if (handler && typeof handler.fetch === "function") return handler;
    if (typeof handler === "function") return { fetch: handler };
    if (handler?.useNitroApp) {
      const app = handler.useNitroApp();
      return { fetch: (req) => app.fetch(req) };
    }
  } catch (err) {
    console.error("[earthlink] failed to load nitro handler:", err);
  }
  return null;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

function safeJoin(base, reqPath) {
  const decoded = decodeURIComponent(reqPath.split("?")[0]);
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(base, cleaned);
  if (!full.startsWith(base)) return null;
  return full;
}

function tryServeStatic(req, res) {
  if (!staticRoot) return false;
  const urlPath = (req.url || "/").split("?")[0];
  // Only serve real files — not SPA fallback (SSR handles HTML)
  let filePath = safeJoin(staticRoot, urlPath);
  if (!filePath) return false;
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const ext = path.extname(filePath);
  res.statusCode = 200;
  res.setHeader("content-type", MIME[ext] || "application/octet-stream");
  if (ext === ".html") {
    res.setHeader("cache-control", "no-cache");
  } else if (urlPath.startsWith("/assets/")) {
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
  } else {
    res.setHeader("cache-control", "public, max-age=86400");
  }
  fs.createReadStream(filePath).pipe(res);
  return true;
}

async function serveNitro(req, res) {
  if (!nitroHandler) {
    res.statusCode = 503;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(
      "Earthlink traffic API is up, but the UI build is missing.\n" +
        "Run: npm run build\n" +
        `Expected static: .vercel/output/static\n` +
        `Expected SSR: .vercel/output/functions/__server.func\n`,
    );
    return;
  }

  const hostHeader = req.headers.host || `localhost:${port}`;
  const proto = req.headers["x-forwarded-proto"] || "http";
  const url = `${proto}://${hostHeader}${req.url || "/"}`;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bodyBuf = Buffer.concat(chunks);

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) headers.append(k, item);
    } else {
      headers.set(k, v);
    }
  }

  const method = (req.method || "GET").toUpperCase();
  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD" && bodyBuf.length) {
    init.body = bodyBuf;
  }

  const request = new Request(url, init);
  const response = await nitroHandler.fetch(request, {});

  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "transfer-encoding") return;
    res.setHeader(key, value);
  });
  const ab = await response.arrayBuffer();
  res.end(Buffer.from(ab));
}

const server = http.createServer(async (req, res) => {
  try {
    const pathOnly = (req.url || "/").split("?")[0];

    if (pathOnly.startsWith("/api/traffic")) {
      const handled = await handleTrafficApi(req, res, pathOnly);
      if (handled) return;
    }

    if (pathOnly === "/api/health") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, service: "earthlink" }));
      return;
    }

    // Static assets (JS/CSS/textures) before SSR
    if (tryServeStatic(req, res)) return;

    await serveNitro(req, res);
  } catch (err) {
    console.error("[earthlink]", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end("internal error");
    }
  }
});

getCollector();
nitroHandler = await loadNitro();

server.listen(port, host, () => {
  console.log(`[earthlink] real traffic server on http://${host}:${port}`);
  console.log(`[earthlink] static: ${staticRoot ?? "(none)"}`);
  console.log(`[earthlink] ssr: ${nitroPath ?? "(none — run npm run build)"}`);
  console.log(
    `[earthlink] sockets via /proc/net/tcp · inbound+outbound · set EARTHLINK_HOME_LAT/LON to pin home`,
  );
});
