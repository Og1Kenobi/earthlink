import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import {
  connectionLife,
  isIpMuted,
  matchesAgentFilter,
  matchesSecurityPreset,
  protocolWeight,
  useConnectionStore,
  type Connection,
  type TrafficDirection,
} from "@/lib/connection-store";
import { latLonToVector3 } from "@/lib/geo";
import { EARTH_RADIUS } from "./Earth";

const ARC_ALTITUDE = 0.18;
const DOT_SIZE = 0.02;

function arcPoints(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  segments = 64,
): THREE.Vector3[] {
  const a = latLonToVector3(fromLat, fromLon, EARTH_RADIUS);
  const b = latLonToVector3(toLat, toLon, EARTH_RADIUS);
  // Spherical slerp so arcs sit above the surface cleanly
  const pts: THREE.Vector3[] = [];
  const angle = Math.max(a.angleTo(b), 1e-6);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const sin = Math.sin(angle);
    const p = new THREE.Vector3()
      .addScaledVector(a, Math.sin((1 - t) * angle) / sin)
      .addScaledVector(b, Math.sin(t * angle) / sin)
      .normalize();
    const lift = Math.sin(Math.PI * t) * ARC_ALTITUDE;
    p.multiplyScalar(EARTH_RADIUS + lift);
    pts.push(p);
  }
  return pts;
}

function HomeBeacon({ lat, lon }: { lat: number; lon: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const pos = useMemo(
    () => latLonToVector3(lat, lon, EARTH_RADIUS + 0.02),
    [lat, lon],
  );
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const s = 1 + Math.sin(clock.elapsedTime * 3) * 0.15;
    ref.current.scale.setScalar(s);
  });
  return (
    <mesh ref={ref} position={pos}>
      <sphereGeometry args={[0.04, 16, 16]} />
      <meshBasicMaterial color="#38bdf8" toneMapped={false} />
    </mesh>
  );
}

function ConnectionArc({
  conn,
  homeLat,
  homeLon,
  selected,
}: {
  conn: Connection;
  homeLat: number;
  homeLon: number;
  selected: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.Material | null>(null);
  const dotRef = useRef<THREE.MeshBasicMaterial>(null);
  const inbound = conn.direction === "inbound";
  const color = inbound ? "#2ee6a6" : "#f59e0b";
  const weight = protocolWeight(conn.protocol, conn.bytesPerSec ?? 0);
  const pts = useMemo(
    () =>
      inbound
        ? arcPoints(conn.lat, conn.lon, homeLat, homeLon)
        : arcPoints(homeLat, homeLon, conn.lat, conn.lon),
    [conn.lat, conn.lon, homeLat, homeLon, inbound],
  );
  const remote = useMemo(
    () => latLonToVector3(conn.lat, conn.lon, EARTH_RADIUS + 0.02),
    [conn.lat, conn.lon],
  );

  useFrame(() => {
    const life = connectionLife(conn, performance.now());
    if (group.current) group.current.visible = life > 0.02;
    const lineOpacity = 0.45 + life * 0.5;
    const dotOpacity = 0.55 + life * 0.45;
    // drei Line material may be on children
    group.current?.traverse((obj) => {
      const m = (obj as THREE.Mesh).material;
      if (!m) return;
      const mats = Array.isArray(m) ? m : [m];
      for (const mat of mats) {
        if ("opacity" in mat) {
          mat.transparent = true;
          mat.opacity = obj.type === "Line2" || obj.type === "Line" || obj.type === "Mesh"
            ? (obj as THREE.Mesh).geometry?.type?.includes("Sphere")
              ? dotOpacity
              : lineOpacity
            : lineOpacity;
          mat.depthWrite = false;
        }
      }
    });
    if (dotRef.current) {
      dotRef.current.opacity = dotOpacity;
    }
  });

  const lineWidth = Math.max(1.5, (selected ? 2.8 : 1.8) * weight);

  return (
    <group ref={group}>
      <Line
        points={pts}
        color={color}
        lineWidth={lineWidth}
        transparent
        opacity={0.85}
        depthWrite={false}
        depthTest
        toneMapped={false}
        frustumCulled={false}
      />
      {/* secondary soft arc for visibility */}
      <Line
        points={pts}
        color={color}
        lineWidth={lineWidth * 2.2}
        transparent
        opacity={0.2}
        depthWrite={false}
        depthTest
        toneMapped={false}
        frustumCulled={false}
      />
      <mesh position={remote}>
        <sphereGeometry
          args={[
            DOT_SIZE * (selected ? 1.6 : 1) * Math.min(weight, 1.5),
            12,
            12,
          ]}
        />
        <meshBasicMaterial
          ref={dotRef}
          color={color}
          transparent
          opacity={0.9}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function useVisibleConnections(list: Connection[], max = 64) {
  return useMemo(() => {
    // Prefer live, then most recently created
    const live = list.filter((c) => c.live !== false);
    const dead = list.filter((c) => c.live === false);
    const sortedLive = [...live].sort(
      (a, b) => (b.bytesPerSec || 0) - (a.bytesPerSec || 0),
    );
    return [...sortedLive, ...dead].slice(0, max);
  }, [list, max]);
}

/** Connections as they should appear under mute + preset + agent + optional replay */
function useDisplayConnections() {
  const connections = useConnectionStore((s) => s.connections);
  const mutedPeers = useConnectionStore((s) => s.mutedPeers);
  const preset = useConnectionStore((s) => s.securityPreset);
  const replayMs = useConnectionStore((s) => s.replayMs);
  const history = useConnectionStore((s) => s.history);
  const selectedAgentId = useConnectionStore((s) => s.selectedAgentId);
  const hubHostId = useConnectionStore((s) => s.hostId);

  return useMemo(() => {
    if (replayMs != null && history.length) {
      const windowStart = replayMs - 12_000;
      const opens = new Map<string, (typeof history)[0]>();
      for (const e of history) {
        if (e.at > replayMs) break;
        if (e.type === "open" && e.at >= windowStart) opens.set(e.id, e);
        if (e.type === "close") opens.delete(e.id);
      }
      return [...opens.values()]
        .filter((e) => !isIpMuted(e.ip, mutedPeers))
        .map(
          (e) =>
            ({
              id: e.id,
              ip: e.ip,
              city: e.city,
              country: e.country,
              lat: e.lat,
              lon: e.lon,
              protocol: e.protocol,
              port: e.port,
              bytes: 0,
              createdAt: performance.now() - 1000,
              ttl: 60_000,
              distanceKm: 0,
              live: true,
              real: true,
              direction: e.direction,
              process: e.process,
              org: e.org,
              asn: e.asn,
              hostId: e.hostId,
            }) satisfies Connection,
        )
        .filter((c) => matchesSecurityPreset(c, preset))
        .filter((c) => matchesAgentFilter(c, selectedAgentId, hubHostId));
    }

    return connections
      .filter((c) => !isIpMuted(c.ip, mutedPeers))
      .filter((c) => matchesSecurityPreset(c, preset))
      .filter((c) => matchesAgentFilter(c, selectedAgentId, hubHostId));
  }, [
    connections,
    mutedPeers,
    preset,
    replayMs,
    history,
    selectedAgentId,
    hubHostId,
  ]);
}

export function ConnectionsLayer() {
  const home = useConnectionStore((s) => s.home);
  const selectedId = useConnectionStore((s) => s.selectedId);
  const trails = useConnectionStore((s) => s.trails);
  const display = useDisplayConnections();
  const visible = useVisibleConnections(display, 72);

  useFrame(() => {
    useConnectionStore.getState().tick(performance.now());
  });

  return (
    <group>
      <HomeBeacon lat={home.lat} lon={home.lon} />
      {visible.map((c) => (
        <ConnectionArc
          key={c.id}
          conn={c}
          homeLat={home.lat}
          homeLon={home.lon}
          selected={c.id === selectedId}
        />
      ))}
      {trails.slice(0, 40).map((t) => {
        const p = latLonToVector3(t.lat, t.lon, EARTH_RADIUS + 0.01);
        const age = (performance.now() - t.born) / t.ttl;
        if (age >= 1) return null;
        return (
          <mesh key={t.id} position={p}>
            <sphereGeometry args={[0.03, 8, 8]} />
            <meshBasicMaterial
              color={t.color}
              transparent
              opacity={0.25 * (1 - age)}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

export type { TrafficDirection };
