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

/** Lon/lat → equirectangular pixel. */
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

/**
 * Draw a ring, splitting on antimeridian jumps so fill doesn't smear across the map.
 */
function drawRing(
  ctx: CanvasRenderingContext2D,
  ring: Ring,
  w: number,
  h: number,
  mode: "fill" | "stroke",
) {
  const open = openRing(ring);
  if (open.length < 3) return;

  // Split into runs that don't jump the date line
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
  opts: { fill: boolean; stroke: boolean; strokeStyle?: string; lineWidth?: number },
) {
  fc.features.forEach((f: GeoJsonFeature, fi: number) => {
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return;
    const id = featureName(f, `f-${fi}`);
    if (opts.fill) {
      ctx.fillStyle = `#${colorFromId(`${id}#${fi}`).getHexString()}`;
    }
    if (opts.stroke) {
      ctx.strokeStyle = opts.strokeStyle ?? "#0f172a";
      ctx.lineWidth = opts.lineWidth ?? 1;
    }
    for (const ring of exteriorRings(g)) {
      if (opts.fill) drawRing(ctx, ring, w, h, "fill");
      if (opts.stroke) drawRing(ctx, ring, w, h, "stroke");
    }
  });
}

/**
 * Build an equirectangular political texture:
 * ocean + randomly colored countries + randomly colored states + borders.
 */
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

  // Ocean
  ctx.fillStyle = "#2f6fad";
  ctx.fillRect(0, 0, w, h);

  // Subtle lat/lon grid
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
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

  // Countries — random fills
  paintFeatures(ctx, countries, w, h, { fill: true, stroke: false });

  // States/provinces on top (also random, distinct per region)
  if (states) {
    paintFeatures(ctx, states, w, h, { fill: true, stroke: false });
  }

  // Borders: states thin, countries thicker
  if (states) {
    paintFeatures(ctx, states, w, h, {
      fill: false,
      stroke: true,
      strokeStyle: "rgba(15,23,42,0.45)",
      lineWidth: 0.8,
    });
  }
  paintFeatures(ctx, countries, w, h, {
    fill: false,
    stroke: true,
    strokeStyle: "rgba(15,23,42,0.85)",
    lineWidth: 1.4,
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
