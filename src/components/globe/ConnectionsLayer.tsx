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

const ARC_ALTITUDE = 0.12;
const DOT_SIZE = 0.018;

function arcPoints(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  segments = 48,
): THREE.Vector3[] {
  const a = latLonToVector3(fromLat, fromLon, EARTH_RADIUS);
  const b = latLonToVector3(toLat, toLon, EARTH_RADIUS);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = new THREE.Vector3().lerpVectors(a, b, t).normalize();
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
  now,
}: {
  conn: Connection;
  homeLat: number;
  homeLon: number;
  selected: boolean;
  now: number;
}) {
  const life = connectionLife(conn, now);
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
    () => latLonToVector3(conn.lat, conn.lon, EARTH_RADIUS + 0.015),
    [conn.lat, conn.lon],
  );

  if (life <= 0.02) return null;

  return (
    <group>
      <Line
        points={pts}
        color={color}
        lineWidth={(selected ? 2.2 : 1.1) * weight}
        transparent
        opacity={0.35 + life * 0.55}
        depthWrite={false}
        toneMapped={false}
      />
      <mesh position={remote}>
        <sphereGeometry args={[DOT_SIZE * (selected ? 1.6 : 1) * Math.min(weight, 1.5), 10, 10]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.5 + life * 0.5}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function useVisibleConnections(list: Connection[], max = 32) {
  return useMemo(() => {
    const live = list.filter((c) => c.live !== false);
    const dead = list.filter((c) => c.live === false);
    return [...live, ...dead].slice(0, max);
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
  const visible = useVisibleConnections(display, 40);
  const nowRef = useRef(performance.now());

  useFrame(() => {
    nowRef.current = performance.now();
    useConnectionStore.getState().tick(nowRef.current);
  });

  const now = nowRef.current;

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
          now={now}
        />
      ))}
      {/* heat trails stay global for now */}
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

// silence unused type import if tree-shaken
export type { TrafficDirection };
