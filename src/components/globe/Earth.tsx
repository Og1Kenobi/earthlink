import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { buildPoliticalTexture } from "@/lib/political-texture";
import type { GeoJsonFeatureCollection } from "@/lib/sphere-geo";
import { useConnectionStore } from "@/lib/connection-store";

const EARTH_RADIUS = 2;

const COUNTRIES_URL =
  "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson";
const STATES_URL =
  "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_1_states_provinces.geojson";

function PoliticalGlobe({ children }: { children?: ReactNode }) {
  const [map, setMap] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    let cancelled = false;
    let tex: THREE.CanvasTexture | null = null;

    (async () => {
      try {
        const [cRes, sRes] = await Promise.all([
          fetch(COUNTRIES_URL),
          fetch(STATES_URL),
        ]);
        if (!cRes.ok) throw new Error(`countries ${cRes.status}`);
        const countries = (await cRes.json()) as GeoJsonFeatureCollection;
        let states: GeoJsonFeatureCollection | null = null;
        if (sRes.ok) {
          states = (await sRes.json()) as GeoJsonFeatureCollection;
        }
        if (cancelled) return;
        tex = buildPoliticalTexture(countries, states, { w: 2048, h: 1024 });
        setMap(tex);
      } catch (e) {
        console.warn("[earthlink] political map:", e);
      }
    })();

    return () => {
      cancelled = true;
      tex?.dispose();
    };
  }, []);

  const mat = useMemo(() => {
    if (!map) {
      return new THREE.MeshPhongMaterial({
        color: new THREE.Color("#0a1628"),
        emissive: new THREE.Color("#04101c"),
        emissiveIntensity: 0.4,
      });
    }
    return new THREE.MeshPhongMaterial({
      map,
      specular: new THREE.Color("#1e3a5f"),
      shininess: 14,
      emissive: new THREE.Color("#0b1220"),
      emissiveIntensity: 0.35,
    });
  }, [map]);

  useEffect(() => {
    return () => {
      mat.dispose();
    };
  }, [mat]);

  return (
    <group>
      <mesh material={mat}>
        <sphereGeometry args={[EARTH_RADIUS, 96, 96]} />
      </mesh>
      {/* Soft limb glow */}
      <mesh scale={1.012}>
        <sphereGeometry args={[EARTH_RADIUS, 64, 64]} />
        <meshBasicMaterial
          color="#38bdf8"
          transparent
          opacity={0.07}
          side={THREE.BackSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {children}
    </group>
  );
}

/** Base radians/sec multiplier at spinSpeed = 1 */
const SPIN_BASE = 0.028;

export function Earth({
  autoRotate = true,
  children,
}: {
  autoRotate?: boolean;
  children?: ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const spinSpeed = useConnectionStore((s) => s.spinSpeed);

  useLayoutEffect(() => {
    if (group.current) {
      group.current.rotation.y = 3.6;
      group.current.rotation.x = 0.18;
    }
  }, []);

  useFrame((_, delta) => {
    if (!autoRotate || !group.current || spinSpeed <= 0) return;
    group.current.rotation.y += Math.min(delta, 0.05) * SPIN_BASE * spinSpeed;
  });

  return (
    <group ref={group}>
      <PoliticalGlobe>{children}</PoliticalGlobe>
    </group>
  );
}

export { EARTH_RADIUS };
