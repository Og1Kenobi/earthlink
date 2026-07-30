import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import {
  connectionLife,
  isIpMuted,
  protocolWeight,
  useConnectionStore,
  type Connection,
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
    const s = 1 + age * 4.5;
    ref.current.scale.setScalar(s);
    const m = ref.current.material as THREE.MeshBasicMaterial;
    m.opacity = (1 - age) * 0.65;
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
  const weight = protocolWeight(conn.protocol) * (selected ? 1.45 : 1);

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
          lineWidth={3.5 * weight}
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
          lineWidth={2.1 * weight}
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

function useVisibleConnections(connections: Connection[], max = 24) {
  return useMemo(() => {
    const live = connections.filter((c) => c.live !== false);
    const fading = connections.filter((c) => c.live === false);
    return [...live, ...fading].slice(0, max);
  }, [connections, max]);
}

export function ConnectionsLayer() {
  const connections = useConnectionStore((s) => s.connections);
  const mutedPeers = useConnectionStore((s) => s.mutedPeers);
  const home = useConnectionStore((s) => s.home);
  const selectedId = useConnectionStore((s) => s.selectedId);

  const unmuted = useMemo(
    () => connections.filter((c) => !isIpMuted(c.ip, mutedPeers)),
    [connections, mutedPeers],
  );
  const visible = useVisibleConnections(unmuted, 28);

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
    </group>
  );
}
