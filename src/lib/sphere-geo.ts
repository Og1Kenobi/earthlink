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

/** Extract 3D line segments from a GeoJSON geometry (on a sphere). */
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

  if (g.type === "Polygon") {
    // exterior only
    if (g.coordinates[0]) pushRing(g.coordinates[0]);
  } else if (g.type === "MultiPolygon") {
    for (const poly of g.coordinates) {
      if (poly[0]) pushRing(poly[0]);
    }
  } else if (g.type === "LineString") {
    pushRing(g.coordinates);
  } else if (g.type === "MultiLineString") {
    for (const line of g.coordinates) pushRing(line);
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

/** Latitude / longitude grid on the sphere. */
export function createLatLonGrid(
  radius: number,
  latStep = 15,
  lonStep = 15,
  segments = 96,
): THREE.BufferGeometry[] {
  const geos: THREE.BufferGeometry[] = [];

  // Parallels
  for (let lat = -90 + latStep; lat < 90; lat += latStep) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const lon = -180 + (360 * i) / segments;
      pts.push(latLonToVector3(lat, lon, radius));
    }
    geos.push(new THREE.BufferGeometry().setFromPoints(pts));
  }

  // Meridians
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
