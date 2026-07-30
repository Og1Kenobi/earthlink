import * as THREE from "three";
import { latLonToVector3 } from "./geo";

type Position = [number, number] | [number, number, number];
type Ring = Position[];
type Polygon = Ring[];
type MultiPolygon = Polygon[];

export type GeoJsonGeometry =
  | { type: "Polygon"; coordinates: Polygon }
  | { type: "MultiPolygon"; coordinates: MultiPolygon }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] };

export type GeoJsonFeature = {
  type: "Feature";
  properties?: Record<string, unknown>;
  geometry: GeoJsonGeometry | null;
};

export type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

export type ColoredMesh = {
  geometry: THREE.BufferGeometry;
  color: THREE.Color;
  id: string;
};

function ringToPoints(ring: Ring, radius: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (const pos of ring) {
    const lon = pos[0];
    const lat = pos[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    pts.push(latLonToVector3(lat, lon, radius));
  }
  return pts;
}

/**
 * Stable pseudo-random color from id.
 * Biased away from ocean blues so land stays readable on a blue globe.
 */
export function colorFromId(id: string): THREE.Color {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h = h >>> 0;

  // Map hash → hue, skip muddy cyan/ocean band by remapping
  let hue = h % 360;
  if (hue >= 175 && hue <= 245) {
    hue = (hue + 110) % 360;
  }

  const sat = 0.58 + ((h >>> 9) & 0xff) / 255 * 0.32; // 0.58–0.90
  const lit = 0.42 + ((h >>> 17) & 0xff) / 255 * 0.28; // 0.42–0.70
  return new THREE.Color().setHSL(hue / 360, sat, lit);
}

function openRing(ring: Ring): Ring {
  if (ring.length < 2) return ring;
  const a = ring[0]!;
  const b = ring[ring.length - 1]!;
  if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  return ring;
}

function triangulateRing(
  open: Ring,
  radius: number,
): THREE.BufferGeometry | null {
  if (open.length < 3) return null;

  const contour = open.map(
    (p) => new THREE.Vector2(Number(p[0]), Number(p[1])),
  );

  let faces: number[][];
  try {
    faces = THREE.ShapeUtils.triangulateShape(contour, []);
  } catch {
    // Fallback: fan triangulation
    faces = [];
    for (let i = 1; i < open.length - 1; i++) {
      faces.push([0, i, i + 1]);
    }
  }
  if (!faces.length) {
    faces = [];
    for (let i = 1; i < open.length - 1; i++) {
      faces.push([0, i, i + 1]);
    }
  }
  if (!faces.length) return null;

  const positions = new Float32Array(open.length * 3);
  for (let i = 0; i < open.length; i++) {
    const lon = Number(open[i]![0]);
    const lat = Number(open[i]![1]);
    const v = latLonToVector3(lat, lon, radius);
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
  }

  const indices: number[] = [];
  for (const f of faces) {
    if (f.length < 3) continue;
    indices.push(f[0]!, f[1]!, f[2]!);
  }
  if (!indices.length) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function splitAntimeridian(ring: Ring): Ring[] {
  const parts: Ring[] = [];
  let cur: Ring = [ring[0]!];
  for (let i = 1; i < ring.length; i++) {
    const prev = ring[i - 1]!;
    const p = ring[i]!;
    if (Math.abs(Number(p[0]) - Number(prev[0])) > 180) {
      if (cur.length >= 3) parts.push(cur);
      cur = [p];
    } else {
      cur.push(p);
    }
  }
  if (cur.length >= 3) parts.push(cur);
  return parts.length ? parts : [ring];
}

function ringsFromGeometry(g: GeoJsonGeometry): Ring[] {
  const rings: Ring[] = [];
  if (g.type === "Polygon") {
    if (g.coordinates[0]) rings.push(g.coordinates[0]);
  } else if (g.type === "MultiPolygon") {
    for (const poly of g.coordinates) {
      if (poly[0]) rings.push(poly[0]);
    }
  } else if (g.type === "LineString") {
    rings.push(g.coordinates);
  } else if (g.type === "MultiLineString") {
    for (const line of g.coordinates) rings.push(line);
  }
  return rings;
}

export function featureName(f: GeoJsonFeature, fallback: string): string {
  const p = f.properties ?? {};
  const keys = [
    "NAME",
    "name",
    "NAME_EN",
    "ADMIN",
    "NAME_1",
    "name_en",
    "ISO_A3",
    "adm0_a3",
  ];
  for (const k of keys) {
    const v = p[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return fallback;
}

export function meshesFromCollection(
  fc: GeoJsonFeatureCollection,
  radius: number,
  maxFeatures = 400,
): ColoredMesh[] {
  const out: ColoredMesh[] = [];
  const features = fc.features.slice(0, maxFeatures);

  for (let fi = 0; fi < features.length; fi++) {
    const f = features[fi]!;
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;

    const id = featureName(f, `f-${fi}`);
    const color = colorFromId(`${id}#${fi}`);

    for (const ring of ringsFromGeometry(g)) {
      const open = openRing(ring);
      for (const part of splitAntimeridian(open)) {
        const geo = triangulateRing(part, radius);
        if (geo) out.push({ geometry: geo, color, id });
      }
    }
  }
  return out;
}

export function geometriesFromFeature(
  feature: GeoJsonFeature,
  radius: number,
): THREE.BufferGeometry[] {
  const g = feature.geometry;
  if (!g) return [];
  const out: THREE.BufferGeometry[] = [];

  const pushRing = (ring: Ring) => {
    const pts = ringToPoints(ring, radius);
    if (pts.length < 2) return;
    out.push(new THREE.BufferGeometry().setFromPoints(pts));
  };

  for (const ring of ringsFromGeometry(g)) {
    pushRing(ring);
  }

  return out;
}

export function geometriesFromCollection(
  fc: GeoJsonFeatureCollection,
  radius: number,
  maxFeatures = 400,
): THREE.BufferGeometry[] {
  const all: THREE.BufferGeometry[] = [];
  const features = fc.features.slice(0, maxFeatures);
  for (const f of features) {
    all.push(...geometriesFromFeature(f, radius));
  }
  return all;
}

export function createLatLonGrid(
  radius: number,
  latStep = 15,
  lonStep = 15,
  segments = 96,
): THREE.BufferGeometry[] {
  const geos: THREE.BufferGeometry[] = [];

  for (let lat = -90 + latStep; lat < 90; lat += latStep) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const lon = -180 + (360 * i) / segments;
      pts.push(latLonToVector3(lat, lon, radius));
    }
    geos.push(new THREE.BufferGeometry().setFromPoints(pts));
  }

  for (let lon = -180; lon < 180; lon += lonStep) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const lat = -90 + (180 * i) / segments;
      pts.push(latLonToVector3(lat, lon, radius));
    }
    geos.push(new THREE.BufferGeometry().setFromPoints(pts));
  }

  return geos;
}
