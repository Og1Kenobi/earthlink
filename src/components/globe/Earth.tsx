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
import {
  createLatLonGrid,
  geometriesFromCollection,
  type GeoJsonFeatureCollection,
} from "@/lib/sphere-geo";

const EARTH_RADIUS = 2;

// Natural Earth 110m — light enough for browser, clear country outlines
const COUNTRIES_URL =
  "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson";
// State / province lines
const STATES_URL =
  "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_1_states_provinces_lines.geojson";

function LineSet({
  geometries,
  color,
  opacity,
}: {
  geometries: THREE.BufferGeometry[];
  color: string;
  opacity: number;
}) {
  const lines = useMemo(() => {
    return geometries.map((geo) => {
      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        toneMapped: false,
      });
      return new THREE.Line(geo, mat);
    });
  }, [geometries, color, opacity]);

  useEffect(() => {
    return () => {
      for (const line of lines) {
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }
    };
  }, [lines]);

  return (
    <group>
      {lines.map((line, i) => (
        <primitive key={i} object={line} />
      ))}
    </group>
  );
}

function BorderLayers({ radius }: { radius: number }) {
  const [countries, setCountries] = useState<THREE.BufferGeometry[]>([]);
  const [states, setStates] = useState<THREE.BufferGeometry[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(COUNTRIES_URL);
        if (!res.ok) throw new Error("countries fetch failed");
        const fc = (await res.json()) as GeoJsonFeatureCollection;
        if (cancelled) return;
        setCountries(geometriesFromCollection(fc, radius * 1.002, 300));
      } catch (e) {
        console.warn("[earthlink] country borders:", e);
      }
    })();

    (async () => {
      try {
        const res = await fetch(STATES_URL);
        if (!res.ok) throw new Error("states fetch failed");
        const fc = (await res.json()) as GeoJsonFeatureCollection;
        if (cancelled) return;
        setStates(geometriesFromCollection(fc, radius * 1.0015, 500));
      } catch (e) {
        console.warn("[earthlink] state borders:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [radius]);

  const grid = useMemo(
    () => createLatLonGrid(radius * 1.001, 15, 15, 72),
    [radius],
  );

  useEffect(() => {
    return () => {
      for (const g of grid) g.dispose();
    };
  }, [grid]);

  return (
    <group>
      <LineSet geometries={grid} color="#94a3b8" opacity={0.22} />
      {states.length > 0 && (
        <LineSet geometries={states} color="#64748b" opacity={0.35} />
      )}
      {countries.length > 0 && (
        <LineSet geometries={countries} color="#0f172a" opacity={0.55} />
      )}
    </group>
  );
}

export function Earth({
  autoRotate = true,
  children,
}: {
  autoRotate?: boolean;
  children?: ReactNode;
}) {
  const group = useRef<THREE.Group>(null);

  const landMat = useMemo(
    () =>
      new THREE.MeshPhongMaterial({
        color: new THREE.Color("#e8eef5"),
        emissive: new THREE.Color("#dbe4f0"),
        emissiveIntensity: 0.35,
        specular: new THREE.Color("#ffffff"),
        shininess: 12,
        flatShading: false,
      }),
    [],
  );

  const coreMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color("#f8fafc"),
        transparent: true,
        opacity: 0.92,
        toneMapped: false,
      }),
    [],
  );

  useLayoutEffect(() => {
    if (group.current) {
      group.current.rotation.y = 3.6;
      group.current.rotation.x = 0.18;
    }
  }, []);

  useFrame((_, delta) => {
    if (!autoRotate || !group.current) return;
    group.current.rotation.y += Math.min(delta, 0.05) * 0.03;
  });

  return (
    <group ref={group}>
      <mesh material={coreMat}>
        <sphereGeometry args={[EARTH_RADIUS * 0.995, 64, 64]} />
      </mesh>
      <mesh material={landMat}>
        <sphereGeometry args={[EARTH_RADIUS, 96, 96]} />
      </mesh>
      <mesh scale={1.004}>
        <sphereGeometry args={[EARTH_RADIUS, 48, 48]} />
        <meshBasicMaterial
          color="#334155"
          wireframe
          transparent
          opacity={0.04}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <BorderLayers radius={EARTH_RADIUS} />
      {children}
    </group>
  );
}

export { EARTH_RADIUS };
