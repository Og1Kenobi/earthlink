import * as THREE from "three";
import {
  colorFromId,
  featureName,
  type GeoJsonFeature,
  type GeoJsonFeatureCollection,
  type GeoJsonGeometry,
} from "./sphere-geo";

type Position = [number, number] | [number, number, number];
type Ring = Position[];

function openRing(ring: Ring): Ring {
  if (ring.length < 2) return ring;
  const a = ring[0]!;
  const b = ring[ring.length - 1]!;
  if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  return ring;
}

function exteriorRings(g: GeoJsonGeometry): Ring[] {
  if (g.type === "Polygon") return g.coordinates[0] ? [g.coordinates[0]] : [];
  if (g.type === "MultiPolygon") {
    return g.coordinates.map((p) => p[0]).filter(Boolean) as Ring[];
  }
  return [];
}

function project(
  lon: number,
  lat: number,
  w: number,
  h: number,
): [number, number] {
  const x = ((lon + 180) / 360) * w;
  const y = ((90 - lat) / 180) * h;
  return [x, y];
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  ring: Ring,
  w: number,
  h: number,
  mode: "fill" | "stroke",
) {
  const open = openRing(ring);
  if (open.length < 3) return;

  const runs: Ring[] = [];
  let cur: Ring = [open[0]!];
  for (let i = 1; i < open.length; i++) {
    const prev = open[i - 1]!;
    const p = open[i]!;
    if (Math.abs(Number(p[0]) - Number(prev[0])) > 180) {
      if (cur.length >= 2) runs.push(cur);
      cur = [p];
    } else {
      cur.push(p);
    }
  }
  if (cur.length >= 2) runs.push(cur);

  for (const run of runs) {
    if (run.length < 3 && mode === "fill") continue;
    ctx.beginPath();
    for (let i = 0; i < run.length; i++) {
      const [lon, lat] = run[i]!;
      const [x, y] = project(Number(lon), Number(lat), w, h);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if (mode === "fill") {
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }
}

function paintFeatures(
  ctx: CanvasRenderingContext2D,
  fc: GeoJsonFeatureCollection,
  w: number,
  h: number,
  opts: {
    fill: boolean;
    stroke: boolean;
    strokeStyle?: string;
    lineWidth?: number;
    alpha?: number;
  },
) {
  fc.features.forEach((f: GeoJsonFeature, fi: number) => {
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return;
    const id = featureName(f, `f-${fi}`);
    if (opts.fill) {
      const c = colorFromId(`${id}#${fi}`);
      // Darker, richer political fills for NOC look
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      c.setHSL(hsl.h, Math.min(0.72, hsl.s * 1.05), Math.min(0.42, hsl.l * 0.72));
      ctx.globalAlpha = opts.alpha ?? 0.92;
      ctx.fillStyle = `#${c.getHexString()}`;
    }
    if (opts.stroke) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = opts.strokeStyle ?? "rgba(226,232,240,0.35)";
      ctx.lineWidth = opts.lineWidth ?? 1;
    }
    for (const ring of exteriorRings(g)) {
      if (opts.fill) drawRing(ctx, ring, w, h, "fill");
      if (opts.stroke) drawRing(ctx, ring, w, h, "stroke");
    }
  });
  ctx.globalAlpha = 1;
}

/** Equirectangular political texture — deep ocean, neon-edge borders. */
export function buildPoliticalTexture(
  countries: GeoJsonFeatureCollection,
  states: GeoJsonFeatureCollection | null,
  size: { w?: number; h?: number } = {},
): THREE.CanvasTexture {
  const w = size.w ?? 2048;
  const h = size.h ?? 1024;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Deep navy ocean
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#07101f");
  grad.addColorStop(0.5, "#0a1628");
  grad.addColorStop(1, "#050b14");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Soft lat/lon grid
  ctx.strokeStyle = "rgba(94,234,212,0.06)";
  ctx.lineWidth = 1;
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = ((90 - lat) / 180) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  for (let lon = -180; lon < 180; lon += 30) {
    const x = ((lon + 180) / 360) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  paintFeatures(ctx, countries, w, h, { fill: true, stroke: false, alpha: 0.88 });
  if (states) {
    paintFeatures(ctx, states, w, h, { fill: true, stroke: false, alpha: 0.55 });
  }
  if (states) {
    paintFeatures(ctx, states, w, h, {
      fill: false,
      stroke: true,
      strokeStyle: "rgba(148,163,184,0.28)",
      lineWidth: 0.7,
    });
  }
  paintFeatures(ctx, countries, w, h, {
    fill: false,
    stroke: true,
    strokeStyle: "rgba(165,243,252,0.45)",
    lineWidth: 1.2,
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
