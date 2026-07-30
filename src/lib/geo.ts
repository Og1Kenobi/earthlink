import * as THREE from "three";

const DEG2RAD = Math.PI / 180;

/** Convert lat/lon (degrees) to a point on a sphere of given radius. */
export function latLonToVector3(
  lat: number,
  lon: number,
  radius: number,
): THREE.Vector3 {
  const phi = (90 - lat) * DEG2RAD;
  const theta = (lon + 180) * DEG2RAD;
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

/**
 * Great-circle arc between two surface points.
 * Low trajectory (hugs the globe) but always clears the surface.
 */
export function createArcPoints(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  segments = 64,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const startN = start.clone().normalize();
  const endN = end.clone().normalize();

  // Spherical linear interpolation for a true great-circle path
  let omega = startN.angleTo(endN);
  if (omega < 1e-4) {
    // Nearly same point — tiny loop so something still draws
    omega = 0.02;
  }

  // Base sits just above the sphere so endpoints don't clip
  const base = radius * 1.012;
  // Low fly: peak lift is modest (was nearly invisible at 2.5%)
  const altitude = radius * (0.045 + Math.min(omega / Math.PI, 1) * 0.11);

  const sinOmega = Math.sin(omega);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    let p: THREE.Vector3;
    if (sinOmega < 1e-5) {
      p = startN.clone().lerp(endN, t).normalize();
    } else {
      const a = Math.sin((1 - t) * omega) / sinOmega;
      const b = Math.sin(t * omega) / sinOmega;
      p = startN.clone().multiplyScalar(a).add(endN.clone().multiplyScalar(b));
      p.normalize();
    }
    // Smooth lift that peaks mid-arc (low trajectory)
    const lift = Math.sin(t * Math.PI) * altitude;
    p.multiplyScalar(base + lift);
    points.push(p);
  }
  return points;
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) *
      Math.cos(lat2 * DEG2RAD) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
