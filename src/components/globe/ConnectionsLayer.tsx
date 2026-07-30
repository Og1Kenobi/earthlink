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
  const rootRef = useRef<THREE.Group>(null);
  const remoteRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef<THREE.Mesh>(null);
  const heatRef = useRef<THREE.Mesh>(null);
  const lineRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Group>(null);
  const haloRef = useRef<THREE.MeshBasicMaterial>(null);

  const direction = conn.direction === "inbound" ? "inbound" : "outbound";
  const colors = COLORS[direction];
  // Keep weight subtle so arcs stay thin
  const weight =
    (0.75 + protocolWeight(conn.protocol, conn.bytesPerSec || 0) * 0.35) *
    (selected ? 1.35 : 1);

  const { points, remotePos } = useMemo(() => {
    const remotePos = latLonToVector3(conn.lat, conn.lon, SURFACE);
    const homePos = latLonToVector3(homeLat, homeLon, SURFACE);
    const points = createArcPoints(remotePos, homePos, EARTH_RADIUS, 80);
    return { points, remotePos };
  }, [conn.lat, conn.lon, homeLat, homeLon]);

  const linePoints = useMemo(
    () => points.map((p) => p.toArray() as [number, number, number]),
    [points],
  );

  useFrame((state) => {
    const now = performance.now();
    const life = connectionLife(conn, now);
    const selBoost = selected ? 1.1 : 1;

    if (rootRef.current) {
      // Keep mounted through full fade; only hide at true zero
      rootRef.current.visible = life > 0.001;
    }

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

    applyOpacity(lineRef.current, (0.25 + life * 0.7) * selBoost);
    applyOpacity(glowRef.current, (0.08 + life * 0.22) * selBoost);

    if (remoteRef.current) {
      const m = remoteRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.55 + life * 0.45;
      // Gentle pin pulse — wall-clock only (NOT tied to globe spin)
      const s =
        1 + Math.sin((now / 1000) * 5.5 + conn.createdAt * 0.001) * 0.1;
      remoteRef.current.scale.setScalar(s * Math.max(life, 0.05) * selBoost);
    }
    if (haloRef.current) {
      haloRef.current.opacity = life * 0.38;
    }
    if (heatRef.current) {
      const m = heatRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = life * 0.32;
      heatRef.current.scale.setScalar((1.2 + (1 - life) * 1.6) * selBoost);
    }
    if (pulseRef.current) {
      // Fixed ~2.8s trip along the arc, independent of spin preset / frame delta
      const periodMs = 2800;
      let t = (now / periodMs + (conn.createdAt % 1000) / 1000) % 1;
      if (direction === "outbound") t = 1 - t;
      const idx = Math.min(
        points.length - 1,
        Math.floor(t * (points.length - 1)),
      );
      pulseRef.current.position.copy(points[idx]!);
      const m = pulseRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = life * 0.9;
      pulseRef.current.scale.setScalar((0.5 + life * 0.55) * selBoost);
    }
  });

  return (
    <group ref={rootRef}>
      {/* soft outer glow — thin */}
      <group ref={glowRef} renderOrder={9}>
        <Line
          points={linePoints}
          color={colors.glow}
          lineWidth={1.6 * weight}
          transparent
          opacity={0.22}
          depthWrite={false}
          depthTest
          toneMapped={false}
        />
      </group>
      {/* crisp core arc */}
      <group ref={lineRef} renderOrder={10}>
        <Line
          points={linePoints}
          color={selected ? "#ffffff" : colors.arc}
          lineWidth={1.05 * weight}
          transparent
          opacity={0.9}
          depthWrite={false}
          depthTest
          toneMapped={false}
        />
      </group>

      {/* soft bloom under the pin */}
      <mesh ref={heatRef} position={remotePos} renderOrder={10}>
        <sphereGeometry args={[0.026, 14, 14]} />
        <meshBasicMaterial
          color={colors.glow}
          transparent
          opacity={0.22}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* crisp pin */}
      <mesh ref={remoteRef} position={remotePos} renderOrder={12}>
        <sphereGeometry args={[0.007, 12, 12]} />
        <meshBasicMaterial
          color={selected ? "#fff" : colors.dot}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* additive halo ring-ish shell */}
      <mesh position={remotePos} renderOrder={11}>
        <sphereGeometry args={[0.014, 12, 12]} />
        <meshBasicMaterial
          ref={haloRef}
          color={colors.dot}
          transparent
          opacity={0.3}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* traveling pulse along the arc */}
      <mesh ref={pulseRef} renderOrder={13}>
        <sphereGeometry args={[0.0055, 8, 8]} />
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
  const pos = useMemo(
    () => latLonToVector3(lat, lon, SURFACE * 1.01),
    [lat, lon],
  );
  const quat = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pos.clone().normalize());
    return q;
  }, [pos]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (core.current) {
      // Home beacon pulse — fixed rate, not spin
      core.current.scale.setScalar(1 + Math.sin(t * 3) * 0.12);
    }
    if (ring.current) {
      const a = (t * 0.6) % 1;
      ring.current.scale.setScalar(1 + a * 2.2);
      (ring.current.material as THREE.MeshBasicMaterial).opacity =
        (1 - a) * 0.45;
    }
  });

  return (
    <group>
      <mesh ref={core} position={pos} renderOrder={15}>
        <sphereGeometry args={[0.018, 16, 16]} />
        <meshBasicMaterial color="#38bdf8" toneMapped={false} />
      </mesh>
      <mesh position={pos} renderOrder={14}>
        <sphereGeometry args={[0.032, 16, 16]} />
        <meshBasicMaterial
          color="#22d3ee"
          transparent
          opacity={0.25}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={ring} position={pos} quaternion={quat} renderOrder={14}>
        <ringGeometry args={[0.02, 0.028, 48]} />
        <meshBasicMaterial
          color="#67e8f9"
          transparent
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function useVisibleConnections(list: Connection[], max = 64) {
  return useMemo(() => {
    const live = list.filter((c) => c.live !== false);
    const dying = list.filter((c) => c.live === false);
    // Always leave room so fading arcs can finish their ease-out
    const dyingKeep = dying.slice(0, Math.min(24, Math.floor(max * 0.4)));
    const liveKeep = live
      .slice()
      .sort((a, b) => (b.bytesPerSec || 0) - (a.bytesPerSec || 0))
      .slice(0, max - dyingKeep.length);
    return [...liveKeep, ...dyingKeep];
  }, [list, max]);
}

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
  const visible = useVisibleConnections(display, 56);

  useFrame(() => {
    useConnectionStore.getState().tick(performance.now());
  });

  return (
    <group>
      <HomeBeacon lat={home.lat} lon={home.lon} />
      {trails.slice(0, 36).map((t) => (
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
