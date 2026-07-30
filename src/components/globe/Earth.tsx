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
import { SPIN_RATES, useConnectionStore } from "@/lib/connection-store";

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

/** Base radians/sec at Med (rate = 1) */
const SPIN_BASE = 0.085;

export function Earth({
  autoRotate = true,
  children,
}: {
  autoRotate?: boolean;
  children?: ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const spinPreset = useConnectionStore((s) => s.spinPreset);
  // Ref so useFrame never holds a stale rate (R3F callback can lag a render)
  const rateRef = useRef(SPIN_RATES[spinPreset] ?? 1);
  rateRef.current = SPIN_RATES[spinPreset] ?? 1;

  useLayoutEffect(() => {
    if (group.current) {
      group.current.rotation.y = 3.6;
      group.current.rotation.x = 0.18;
    }
  }, []);

  useFrame((_, delta) => {
    // Spin multiplies ONLY this rotation. Arc pulse/fade clocks use
    // performance.now() and are independent of spinPreset.
    if (!autoRotate || !group.current) return;
    const rate = rateRef.current;
    if (rate <= 0) return;
    const dt = Math.min(Math.max(delta, 0), 0.05);
    group.current.rotation.y += dt * SPIN_BASE * rate;
  });

  return (
    <group ref={group}>
      {/* Globe mesh + arcs share orientation so pins stick to countries.
          Internal arc animations do not read spinPreset / SPIN_RATES. */}
      <PoliticalGlobe>{children}</PoliticalGlobe>
    </group>
  );
}

export { EARTH_RADIUS };
