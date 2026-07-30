import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import {
  connectionLife,
  isIpMuted,
  matchesSecurityPreset,
  protocolWeight,
  useConnectionStore,
  type Connection,
  type TrailPoint,
} from "@/lib/connection-store";
import { createArcPoints, latLonToVector3 } from "@/lib/geo";
import { EARTH_RADIUS } from "./Earth";

const SURFACE = EARTH_RADIUS * 1.02;

const COLORS = {
  inbound: {
    arc: "#2ee6a6",
    glow: "#22d3ee",
    dot: "#34d399",
    pulse: "#6ee7b7",
    impact: "#5eead4",
  },
  outbound: {
    arc: "#f59e0b",
    glow: "#fb923c",
    dot: "#fbbf24",
    pulse: "#fde68a",
    impact: "#fdba74",
  },
} as const;

function ImpactRing({
  pos,
  color,
  born,
}: {
  pos: THREE.Vector3;
  color: string;
  born: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const quat = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pos.clone().normalize());
    return q;
  }, [pos]);

  useFrame(() => {
    if (!ref.current) return;
    const age = (performance.now() - born) / 900;
    if (age > 1) {
      ref.current.visible = false;
      return;
    }
    ref.current.visible = true;
    ref.current.scale.setScalar(1 + age * 4.5);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = (1 - age) * 0.65;
  });

  return (
    <mesh ref={ref} position={pos} quaternion={quat} renderOrder={14}>
      <ringGeometry args={[0.02, 0.034, 48]} />
      <meshBasicMaterial
        color={color}
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

function HeatTrail({ trail }: { trail: TrailPoint }) {
  const ref = useRef<THREE.Mesh>(null);
  const pos = useMemo(
    () => latLonToVector3(trail.lat, trail.lon, SURFACE * 1.01),
    [trail.lat, trail.lon],
  );

  useFrame(() => {
    if (!ref.current) return;
    const age = (performance.now() - trail.born) / trail.ttl;
    if (age >= 1) {
      ref.current.visible = false;
      return;
    }
    ref.current.visible = true;
    const s = 0.8 + age * 2.8;
    ref.current.scale.setScalar(s);
    (ref.current.material as THREE.MeshBasicMaterial).opacity =
      (1 - age) * 0.45;
  });

  return (
    <mesh ref={ref} position={pos} renderOrder={8}>
      <sphereGeometry args={[0.04, 12, 12]} />
      <meshBasicMaterial
        color={trail.color}
        transparent
        depthWrite={false}
        toneMapped={false}
        blending={THREE.AdditiveBlending}
      />
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
  const remoteRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef<THREE.Mesh>(null);
  const heatRef = useRef<THREE.Mesh>(null);
  const lineRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Group>(null);

  const direction = conn.direction === "inbound" ? "inbound" : "outbound";
  const colors = COLORS[direction];
  const weight =
    protocolWeight(conn.protocol, conn.bytesPerSec || 0) * (selected ? 1.45 : 1);

  const { points, remotePos } = useMemo(() => {
    const remotePos = latLonToVector3(conn.lat, conn.lon, SURFACE);
    const homePos = latLonToVector3(homeLat, homeLon, SURFACE);
    const points = createArcPoints(remotePos, homePos, EARTH_RADIUS, 80);
    return { points, remotePos, homePos };
  }, [conn.lat, conn.lon, homeLat, homeLon]);

  const linePoints = useMemo(
    () => points.map((p) => p.toArray() as [number, number, number]),
    [points],
  );

  useFrame((state) => {
    const now = performance.now();
    const life = connectionLife(conn, now);
    const selBoost = selected ? 1.15 : 1;

    const applyOpacity = (group: THREE.Group | null, opacity: number) => {
      if (!group) return;
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.material && "opacity" in mesh.material) {
          const m = mesh.material as THREE.Material & {
            opacity: number;
            transparent: boolean;
          };
          m.transparent = true;
          m.opacity = opacity;
          m.depthWrite = false;
        }
      });
    };
    applyOpacity(lineRef.current, (0.4 + life * 0.6) * selBoost);
    applyOpacity(glowRef.current, (0.12 + life * 0.28) * selBoost);

    if (remoteRef.current) {
      const m = remoteRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = life;
      const s =
        1 + Math.sin(state.clock.elapsedTime * 7 + conn.createdAt) * 0.12;
      remoteRef.current.scale.setScalar(s * Math.max(life, 0.01) * selBoost);
    }
    if (heatRef.current) {
      const m = heatRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = life * 0.35;
      heatRef.current.scale.setScalar((1.4 + (1 - life) * 2.2) * selBoost);
    }
    if (pulseRef.current) {
      let t = (state.clock.elapsedTime * 1.05 + conn.createdAt * 0.001) % 1;
      if (direction === "outbound") t = 1 - t;
      const idx = Math.min(
        points.length - 1,
        Math.floor(t * (points.length - 1)),
      );
      pulseRef.current.position.copy(points[idx]!);
      const m = pulseRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = life * 0.95;
      pulseRef.current.scale.setScalar((0.55 + life * 0.7) * selBoost);
    }
  });

  return (
    <group>
      <group ref={glowRef} renderOrder={9}>
        <Line
          points={linePoints}
          color={colors.glow}
          lineWidth={3.8 * weight}
          transparent
          opacity={0.3}
          depthWrite={false}
          depthTest
          toneMapped={false}
        />
      </group>
      <group ref={lineRef} renderOrder={10}>
        <Line
          points={linePoints}
          color={selected ? "#ffffff" : colors.arc}
          lineWidth={2.2 * weight}
          transparent
          opacity={0.95}
          depthWrite={false}
          depthTest
          toneMapped={false}
        />
      </group>

      <mesh ref={heatRef} position={remotePos} renderOrder={10}>
        <sphereGeometry args={[0.028, 12, 12]} />
        <meshBasicMaterial
          color={colors.glow}
          transparent
          opacity={0.25}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh ref={remoteRef} position={remotePos} renderOrder={11}>
        <sphereGeometry args={[0.006, 10, 10]} />
        <meshBasicMaterial
          color={selected ? "#fff" : colors.dot}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh position={remotePos} renderOrder={11}>
        <sphereGeometry args={[0.012, 10, 10]} />
        <meshBasicMaterial
          color={colors.dot}
          transparent
          opacity={0.32}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh ref={pulseRef} renderOrder={12}>
        <sphereGeometry args={[0.006, 8, 8]} />
        <meshBasicMaterial
          color={colors.pulse}
          transparent
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {conn.impactAt != null && (
        <ImpactRing
          pos={remotePos}
          color={colors.impact}
          born={conn.impactAt}
        />
      )}
    </group>
  );
}

function HomeBeacon({ lat, lon }: { lat: number; lon: number }) {
  const core = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const pos = useMemo(() => latLonToVector3(lat, lon, SURFACE), [lat, lon]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (core.current) {
      core.current.scale.setScalar(1 + Math.sin(t * 3.2) * 0.12);
    }
    if (ring.current) {
      const s = 1 + ((t * 0.9) % 1) * 2.2;
      const o = 1 - ((t * 0.9) % 1);
      ring.current.scale.setScalar(s);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = o * 0.55;
    }
    if (halo.current) {
      (halo.current.material as THREE.MeshBasicMaterial).opacity =
        0.2 + Math.sin(t * 2) * 0.08;
    }
  });

  const quat = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pos.clone().normalize());
    return q;
  }, [pos]);

  return (
    <group position={pos} quaternion={quat}>
      <mesh ref={halo} renderOrder={11}>
        <sphereGeometry args={[0.05, 16, 16]} />
        <meshBasicMaterial
          color="#38bdf8"
          transparent
          opacity={0.22}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={core} renderOrder={12}>
        <sphereGeometry args={[0.016, 16, 16]} />
        <meshBasicMaterial
          color="#7dd3fc"
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]} renderOrder={12}>
        <ringGeometry args={[0.02, 0.032, 48]} />
        <meshBasicMaterial
          color="#38bdf8"
          transparent
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function useVisibleConnections(connections: Connection[], max = 28) {
  return useMemo(() => {
    const live = connections.filter((c) => c.live !== false);
    const fading = connections.filter((c) => c.live === false);
    return [...live, ...fading].slice(0, max);
  }, [connections, max]);
}

/** Connections as they should appear under mute + preset + optional replay */
function useDisplayConnections() {
  const connections = useConnectionStore((s) => s.connections);
  const mutedPeers = useConnectionStore((s) => s.mutedPeers);
  const preset = useConnectionStore((s) => s.securityPreset);
  const replayMs = useConnectionStore((s) => s.replayMs);
  const history = useConnectionStore((s) => s.history);

  return useMemo(() => {
    if (replayMs != null && history.length) {
      // Reconstruct "open" events active at scrub time (last 12s window)
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
        .filter((c) => matchesSecurityPreset(c, preset));
    }

    return connections
      .filter((c) => !isIpMuted(c.ip, mutedPeers))
      .filter((c) => matchesSecurityPreset(c, preset));
  }, [connections, mutedPeers, preset, replayMs, history]);
}

export function ConnectionsLayer() {
  const home = useConnectionStore((s) => s.home);
  const selectedId = useConnectionStore((s) => s.selectedId);
  const trails = useConnectionStore((s) => s.trails);
  const mutedPeers = useConnectionStore((s) => s.mutedPeers);
  const preset = useConnectionStore((s) => s.securityPreset);
  const display = useDisplayConnections();
  const visible = useVisibleConnections(display, 32);

  const displayTrails = useMemo(
    () =>
      trails.filter((t) => {
        // trails don't have org/protocol — keep all unmuted region roughly
        return true;
      }),
    [trails, mutedPeers, preset],
  );

  useFrame(() => {
    useConnectionStore.getState().tick(performance.now());
  });

  return (
    <group>
      <HomeBeacon lat={home.lat} lon={home.lon} />
      {displayTrails.map((t) => (
        <HeatTrail key={t.id} trail={t} />
      ))}
      {visible.map((c) => (
        <ConnectionArc
          key={c.id}
          conn={c}
          homeLat={home.lat}
          homeLon={home.lon}
          selected={c.id === selectedId}
        />
      ))}
    </group>
  );
}
