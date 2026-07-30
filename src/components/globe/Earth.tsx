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

const COUNTRIES_URL =
  "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson";
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
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [cRes, sRes] = await Promise.all([
          fetch(COUNTRIES_URL),
          fetch(STATES_URL),
        ]);
        if (!cRes.ok) throw new Error("countries fetch failed");
        const cFc = (await cRes.json()) as GeoJsonFeatureCollection;
        if (cancelled) return;
        setCountries(geometriesFromCollection(cFc, radius * 1.003, 300));

        if (sRes.ok) {
          const sFc = (await sRes.json()) as GeoJsonFeatureCollection;
          if (!cancelled) {
            setStates(geometriesFromCollection(sFc, radius * 1.0025, 500));
          }
        }
        if (!cancelled) setStatus("ready");
      } catch (e) {
        console.warn("[earthlink] borders:", e);
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [radius]);

  const grid = useMemo(
    () => createLatLonGrid(radius * 1.0015, 15, 15, 80),
    [radius],
  );

  useEffect(() => {
    return () => {
      for (const g of grid) g.dispose();
    };
  }, [grid]);

  return (
    <group>
      <LineSet geometries={grid} color="#64748b" opacity={0.28} />
      {states.length > 0 && (
        <LineSet geometries={states} color="#475569" opacity={0.45} />
      )}
      {countries.length > 0 && (
        <LineSet geometries={countries} color="#0f172a" opacity={0.72} />
      )}
      {/* invisible status for debug */}
      {status === "loading" ? null : null}
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

  // Cool slate-blue body so borders read on white
  const landMat = useMemo(
    () =>
      new THREE.MeshPhongMaterial({
        color: new THREE.Color("#b6c4d6"),
        emissive: new THREE.Color("#9aadc4"),
        emissiveIntensity: 0.22,
        specular: new THREE.Color("#e2e8f0"),
        shininess: 28,
      }),
    [],
  );

  const coreMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color("#d8e2ee"),
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
        <sphereGeometry args={[EARTH_RADIUS * 0.992, 64, 64]} />
      </mesh>
      <mesh material={landMat}>
        <sphereGeometry args={[EARTH_RADIUS, 96, 96]} />
      </mesh>
      {/* faint tech wire shell */}
      <mesh scale={1.005}>
        <sphereGeometry args={[EARTH_RADIUS, 36, 36]} />
        <meshBasicMaterial
          color="#1e293b"
          wireframe
          transparent
          opacity={0.06}
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
