import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import {
  connectionLife,
  useConnectionStore,
  type Connection,
} from "@/lib/connection-store";
import { createArcPoints, latLonToVector3 } from "@/lib/geo";
import { EARTH_RADIUS } from "./Earth";

const SURFACE = EARTH_RADIUS * 1.016;

const COLORS = {
  inbound: {
    arc: "#047857",
    glow: "#0ea5e9",
    dot: "#059669",
    pulse: "#10b981",
    label: "#047857",
  },
  outbound: {
    arc: "#b45309",
    glow: "#f59e0b",
    dot: "#d97706",
    pulse: "#fbbf24",
    label: "#b45309",
  },
} as const;

function buildArcTube(
  points: THREE.Vector3[],
  color: string,
  radius: number,
  opacity: number,
): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.5);
  const geo = new THREE.TubeGeometry(
    curve,
    Math.max(24, points.length - 1),
    radius,
    6,
    false,
  );
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 10;
  return mesh;
}

function ConnectionArc({
  conn,
  homeLat,
  homeLon,
}: {
  conn: Connection;
  homeLat: number;
  homeLon: number;
}) {
  const tubeRef = useRef<THREE.Mesh | null>(null);
  const glowRef = useRef<THREE.Mesh | null>(null);
  const remoteRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef<THREE.Mesh>(null);

  const direction = conn.direction === "inbound" ? "inbound" : "outbound";
  const colors = COLORS[direction];

  const { points, remotePos, tube, glow } = useMemo(() => {
    const remotePos = latLonToVector3(conn.lat, conn.lon, SURFACE);
    const homePos = latLonToVector3(homeLat, homeLon, SURFACE);
    const points = createArcPoints(remotePos, homePos, EARTH_RADIUS, 72);
    const tube = buildArcTube(points, colors.arc, 0.006, 0.95);
    const glow = buildArcTube(points, colors.glow, 0.014, 0.22);
    return { points, remotePos, homePos, tube, glow };
  }, [conn.lat, conn.lon, homeLat, homeLon, colors.arc, colors.glow]);

  useEffect(() => {
    return () => {
      tube.geometry.dispose();
      (tube.material as THREE.Material).dispose();
      glow.geometry.dispose();
      (glow.material as THREE.Material).dispose();
    };
  }, [tube, glow]);

  useFrame((state) => {
    const now = performance.now();
    const life = connectionLife(conn, now);
    const mat = tubeRef.current?.material as THREE.MeshBasicMaterial | undefined;
    if (mat) mat.opacity = 0.35 + life * 0.6;
    const gmat = glowRef.current?.material as
      | THREE.MeshBasicMaterial
      | undefined;
    if (gmat) gmat.opacity = 0.08 + life * 0.2;
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
      m.opacity = life * 0.9;
      pulseRef.current.scale.setScalar(0.45 + life * 0.5);
    }
  });

  const label = conn.city
    ? `${conn.city}${conn.country ? `, ${conn.country}` : ""}`
    : conn.ip;

  const labelPos = useMemo(
    () => remotePos.clone().multiplyScalar(1.04),
    [remotePos],
  );

  return (
    <group>
      <primitive
        object={glow}
        ref={(obj: THREE.Mesh | null) => {
          glowRef.current = obj;
        }}
      />
      <primitive
        object={tube}
        ref={(obj: THREE.Mesh | null) => {
          tubeRef.current = obj;
        }}
      />

      <mesh ref={remoteRef} position={remotePos}>
        <sphereGeometry args={[0.0055, 10, 10]} />
        <meshBasicMaterial
          color={colors.dot}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh position={remotePos}>
        <sphereGeometry args={[0.011, 10, 10]} />
        <meshBasicMaterial
          color={colors.dot}
          transparent
          opacity={0.28}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <mesh ref={pulseRef}>
        <sphereGeometry args={[0.0045, 8, 8]} />
        <meshBasicMaterial
          color={colors.pulse}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <Html
        position={labelPos}
        center
        sprite
        distanceFactor={7}
        occlude={false}
        style={{ pointerEvents: "none" }}
        zIndexRange={[40, 0]}
      >
        <div
          className="city-pin"
          style={{
            color: colors.label,
            borderColor: colors.dot,
          }}
        >
          <span className="city-pin-dir">
            {direction === "inbound" ? "↓ IN" : "↑ OUT"}
          </span>
          <span className="city-pin-name">{label}</span>
        </div>
      </Html>
    </group>
  );
}

function HomeBeacon({
  lat,
  lon,
  label,
}: {
  lat: number;
  lon: number;
  label: string;
}) {
  const core = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const pos = useMemo(() => latLonToVector3(lat, lon, SURFACE), [lat, lon]);
  const labelPos = useMemo(() => pos.clone().multiplyScalar(1.05), [pos]);

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

  const shortLabel =
    label.length > 28 ? `${label.slice(0, 26)}…` : label || "Home";

  return (
    <group>
      <group position={pos} quaternion={quat}>
        <mesh ref={core}>
          <sphereGeometry args={[0.014, 14, 14]} />
          <meshBasicMaterial
            color="#2563eb"
            transparent
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]}>
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
      <Html
        position={labelPos}
        center
        sprite
        distanceFactor={7}
        occlude={false}
        style={{ pointerEvents: "none" }}
        zIndexRange={[50, 0]}
      >
        <div className="city-pin city-pin-home">
          <span className="city-pin-dir">HOME</span>
          <span className="city-pin-name">{shortLabel}</span>
        </div>
      </Html>
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
      <HomeBeacon lat={home.lat} lon={home.lon} label={home.label} />
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
