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

/** Great-circle-ish elevated arc between two surface points (low fly). */
export function createArcPoints(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  segments = 64,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const startN = start.clone().normalize();
  const endN = end.clone().normalize();
  const angle = startN.angleTo(endN);
  const dist = Math.max(angle, 0.05);
  // Low, tight arcs — short hops barely lift; long hauls still modest
  const altitude = radius * (0.025 + Math.min(dist / Math.PI, 1) * 0.09);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = new THREE.Vector3().lerpVectors(startN, endN, t).normalize();
    const lift = Math.sin(t * Math.PI) * altitude;
    p.multiplyScalar(radius + lift);
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
