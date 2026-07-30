#!/usr/bin/env node
/**
 * Earthlink production server for self-hosting (e.g. 10.11.12.62).
 *
 * Serves the built SPA + live /api/traffic from real TCP sockets on this host.
 *
 *   npm run build
 *   npm start
 *
 * Env:
 *   PORT / HOST                 default 8080 / 0.0.0.0
 *   EARTHLINK_HOME_LAT/LON      force home pin
 *   EARTHLINK_HOME_LABEL        label for home
 *   EARTHLINK_INCLUDE_PRIVATE=1 show LAN remotes
 *   EARTHLINK_POLL_MS           socket poll interval (default 1500)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleTrafficApi, getCollector } from "./traffic/http-api.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";

const staticCandidates = [
  path.join(root, "dist", "client"),
  path.join(root, "dist"),
  path.join(root, ".output", "public"),
  path.join(root, "public"),
];

function findStaticRoot() {
  for (const dir of staticCandidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

const staticRoot = findStaticRoot();
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

async function serveStatic(req, res) {
  if (!staticRoot) {
    res.statusCode = 503;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(
      "Earthlink traffic API is up, but the UI build is missing.\nRun: npm run build\n",
    );
    return;
  }

  let filePath = safeJoin(staticRoot, req.url === "/" ? "/index.html" : req.url);
  if (!filePath) {
    res.statusCode = 400;
    res.end("bad path");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback
    filePath = path.join(staticRoot, "index.html");
  }

  if (!fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }

  const ext = path.extname(filePath);
  res.statusCode = 200;
  res.setHeader("content-type", MIME[ext] || "application/octet-stream");
  // Don't let SPA fallback poison hashed assets
  if (ext === ".html") {
    res.setHeader("cache-control", "no-cache");
  } else {
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
  }
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = req.url || "/";
    const pathOnly = urlPath.split("?")[0];

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

    await serveStatic(req, res);
  } catch (err) {
    console.error("[earthlink]", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end("internal error");
    }
  }
});

// Warm collector immediately
getCollector();

server.listen(port, host, () => {
  console.log(`[earthlink] real traffic server on http://${host}:${port}`);
  console.log(
    `[earthlink] static: ${staticRoot ?? "(none — run npm run build)"}`,
  );
  console.log(
    `[earthlink] sockets via ss/netstat · set EARTHLINK_HOME_LAT/LON to pin home`,
  );
});
