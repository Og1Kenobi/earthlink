import { handleTrafficApi, getCollector } from "./traffic/http-api.mjs";

/**
 * Vite plugin: expose real /api/traffic* during `npm run dev`.
 */
export function earthlinkTrafficPlugin() {
  return {
    name: "earthlink-traffic-api",
    configureServer(server) {
      getCollector();
      server.middlewares.use(async (req, res, next) => {
        try {
          const raw = req.url || "/";
          const pathOnly = raw.split("?")[0] || "/";
          if (!pathOnly.startsWith("/api/traffic")) {
            next();
            return;
          }
          const handled = await handleTrafficApi(req, res, pathOnly);
          if (!handled) next();
        } catch (err) {
          console.error("[earthlink] traffic api error", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        }
      });
    },
  };
}
