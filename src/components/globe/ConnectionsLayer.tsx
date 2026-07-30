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

const SURFACE = EARTH_RADIUS * 1.014;

const COLORS = {
  inbound: {
    arc: "#059669",
    glow: "#0ea5e9",
    dot: "#059669",
    pulse: "#34d399",
    label: "#047857",
  },
  outbound: {
    arc: "#d97706",
    glow: "#ea580c",
    dot: "#d97706",
    pulse: "#fbbf24",
    label: "#b45309",
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
  const lineRef = useRef<THREE.Line | null>(null);
  const glowRef = useRef<THREE.Line | null>(null);
  const remoteRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef<THREE.Mesh>(null);

  const direction = conn.direction === "inbound" ? "inbound" : "outbound";
  const colors = COLORS[direction];

  const { points, remotePos, line, glow } = useMemo(() => {
    const remotePos = latLonToVector3(conn.lat, conn.lon, SURFACE);
    const homePos = latLonToVector3(homeLat, homeLon, SURFACE);
    const points = createArcPoints(remotePos, homePos, EARTH_RADIUS, 64);
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({
        color: colors.arc,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const glow = new THREE.Line(
      geo.clone(),
      new THREE.LineBasicMaterial({
        color: colors.glow,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    return { points, remotePos, homePos, line, glow };
  }, [conn.lat, conn.lon, homeLat, homeLon, colors.arc, colors.glow]);

  useEffect(() => {
    return () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      glow.geometry.dispose();
      (glow.material as THREE.Material).dispose();
    };
  }, [line, glow]);

  useFrame((state) => {
    const now = performance.now();
    const life = connectionLife(conn, now);
    const mat = lineRef.current?.material as THREE.LineBasicMaterial | undefined;
    if (mat) mat.opacity = 0.15 + life * 0.75;
    const gmat = glowRef.current?.material as THREE.LineBasicMaterial | undefined;
    if (gmat) gmat.opacity = 0.04 + life * 0.16;
    if (remoteRef.current) {
      const m = remoteRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = life;
      const s =
        1 + Math.sin(state.clock.elapsedTime * 6 + conn.createdAt) * 0.1;
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
      pulseRef.current.scale.setScalar(0.5 + life * 0.6);
    }
  });

  const label = conn.city
    ? `${conn.city}${conn.country ? `, ${conn.country}` : ""}`
    : conn.ip;

  return (
    <group>
      <primitive
        object={line}
        ref={(obj: THREE.Line | null) => {
          lineRef.current = obj;
        }}
      />
      <primitive
        object={glow}
        ref={(obj: THREE.Line | null) => {
          glowRef.current = obj;
        }}
      />

      <mesh ref={remoteRef} position={remotePos}>
        <sphereGeometry args={[0.012, 12, 12]} />
        <meshBasicMaterial
          color={colors.dot}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh position={remotePos}>
        <sphereGeometry args={[0.022, 12, 12]} />
        <meshBasicMaterial
          color={colors.dot}
          transparent
          opacity={0.25}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <mesh ref={pulseRef}>
        <sphereGeometry args={[0.008, 10, 10]} />
        <meshBasicMaterial
          color={colors.pulse}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <Html
        position={remotePos}
        center
        distanceFactor={6.5}
        style={{ pointerEvents: "none" }}
        zIndexRange={[20, 0]}
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

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (core.current) {
      core.current.scale.setScalar(1 + Math.sin(t * 3) * 0.1);
    }
    if (ring.current) {
      const s = 1 + ((t * 0.8) % 1) * 1.5;
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
          <sphereGeometry args={[0.028, 16, 16]} />
          <meshBasicMaterial
            color="#2563eb"
            transparent
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.032, 0.048, 40]} />
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
        position={pos}
        center
        distanceFactor={6.5}
        style={{ pointerEvents: "none" }}
        zIndexRange={[30, 0]}
      >
        <div className="city-pin city-pin-home">
          <span className="city-pin-dir">HOME</span>
          <span className="city-pin-name">{shortLabel}</span>
        </div>
      </Html>
    </group>
  );
}

/** Cap concurrent labels so the globe stays readable. */
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
