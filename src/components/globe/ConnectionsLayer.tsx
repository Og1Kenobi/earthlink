import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import {
  connectionLife,
  useConnectionStore,
  type Connection,
} from "@/lib/connection-store";
import { createArcPoints, latLonToVector3 } from "@/lib/geo";
import { EARTH_RADIUS } from "./Earth";

const SURFACE = EARTH_RADIUS * 1.018;

const COLORS = {
  inbound: {
    arc: "#059669",
    glow: "#22d3ee",
    dot: "#059669",
    pulse: "#34d399",
  },
  outbound: {
    arc: "#ea580c",
    glow: "#fbbf24",
    dot: "#d97706",
    pulse: "#fcd34d",
  },
} as const;

function ConnectionArc({
  conn,
  homeLat,
  homeLon,
}: {
  conn: Connection;
  homeLat: number;
  homeLon: number;
}) {
  const remoteRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef<THREE.Mesh>(null);
  const lineRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Group>(null);

  const direction = conn.direction === "inbound" ? "inbound" : "outbound";
  const colors = COLORS[direction];

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
    applyOpacity(lineRef.current, 0.45 + life * 0.55);
    applyOpacity(glowRef.current, 0.12 + life * 0.25);

    if (remoteRef.current) {
      const m = remoteRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = life;
      const s =
        1 + Math.sin(state.clock.elapsedTime * 6 + conn.createdAt) * 0.08;
      remoteRef.current.scale.setScalar(s * Math.max(life, 0.01));
    }
    if (pulseRef.current) {
      let t = (state.clock.elapsedTime * 0.9 + conn.createdAt * 0.001) % 1;
      if (direction === "outbound") t = 1 - t;
      const idx = Math.min(
        points.length - 1,
        Math.floor(t * (points.length - 1)),
      );
      pulseRef.current.position.copy(points[idx]!);
      const m = pulseRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = life * 0.95;
      pulseRef.current.scale.setScalar(0.5 + life * 0.55);
    }
  });

  return (
    <group>
      <group ref={glowRef} renderOrder={9}>
        <Line
          points={linePoints}
          color={colors.glow}
          lineWidth={4}
          transparent
          opacity={0.28}
          depthWrite={false}
          depthTest
          toneMapped={false}
        />
      </group>
      <group ref={lineRef} renderOrder={10}>
        <Line
          points={linePoints}
          color={colors.arc}
          lineWidth={2.25}
          transparent
          opacity={0.95}
          depthWrite={false}
          depthTest
          toneMapped={false}
        />
      </group>

      <mesh ref={remoteRef} position={remotePos} renderOrder={11}>
        <sphereGeometry args={[0.0055, 10, 10]} />
        <meshBasicMaterial
          color={colors.dot}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh position={remotePos} renderOrder={11}>
        <sphereGeometry args={[0.011, 10, 10]} />
        <meshBasicMaterial
          color={colors.dot}
          transparent
          opacity={0.28}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <mesh ref={pulseRef} renderOrder={12}>
        <sphereGeometry args={[0.005, 8, 8]} />
        <meshBasicMaterial
          color={colors.pulse}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function HomeBeacon({ lat, lon }: { lat: number; lon: number }) {
  const core = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const pos = useMemo(() => latLonToVector3(lat, lon, SURFACE), [lat, lon]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (core.current) {
      core.current.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
    }
    if (ring.current) {
      const s = 1 + ((t * 0.8) % 1) * 1.4;
      const o = 1 - ((t * 0.8) % 1);
      ring.current.scale.setScalar(s);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = o * 0.5;
    }
  });

  const quat = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pos.clone().normalize());
    return q;
  }, [pos]);

  return (
    <group position={pos} quaternion={quat}>
      <mesh ref={core} renderOrder={11}>
        <sphereGeometry args={[0.014, 14, 14]} />
        <meshBasicMaterial
          color="#2563eb"
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]} renderOrder={11}>
        <ringGeometry args={[0.016, 0.026, 36]} />
        <meshBasicMaterial
          color="#2563eb"
          transparent
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function useVisibleConnections(connections: Connection[], max = 18) {
  return useMemo(() => {
    const live = connections.filter((c) => c.live !== false);
    const fading = connections.filter((c) => c.live === false);
    return [...live, ...fading].slice(0, max);
  }, [connections, max]);
}

export function ConnectionsLayer() {
  const connections = useConnectionStore((s) => s.connections);
  const home = useConnectionStore((s) => s.home);
  const visible = useVisibleConnections(connections, 20);

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
        />
      ))}
    </group>
  );
}
