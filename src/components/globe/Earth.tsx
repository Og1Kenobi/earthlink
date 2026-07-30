import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";

const EARTH_RADIUS = 2;

export function Earth({
  autoRotate = true,
  children,
}: {
  autoRotate?: boolean;
  children?: ReactNode;
}) {
  const group = useRef<THREE.Group>(null);

  const [dayMap, nightMap, bumpMap] = useLoader(THREE.TextureLoader, [
    "/textures/earth-day.jpg",
    "/textures/earth-night.jpg",
    "/textures/earth-topology.png",
  ]);

  useLayoutEffect(() => {
    dayMap.colorSpace = THREE.SRGBColorSpace;
    nightMap.colorSpace = THREE.SRGBColorSpace;
    bumpMap.colorSpace = THREE.NoColorSpace;
    for (const t of [dayMap, nightMap, bumpMap]) {
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = 4;
      t.needsUpdate = true;
    }
  }, [dayMap, nightMap, bumpMap]);

  const baseMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: dayMap,
        toneMapped: true,
      }),
    [dayMap],
  );

  const shadeMat = useMemo(
    () =>
      new THREE.MeshPhongMaterial({
        map: dayMap,
        bumpMap,
        bumpScale: 0.04,
        color: new THREE.Color("#ffffff"),
        specular: new THREE.Color("#1a2a3a"),
        shininess: 18,
        emissiveMap: nightMap,
        emissive: new THREE.Color("#ffb070"),
        emissiveIntensity: 0.55,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    [dayMap, nightMap, bumpMap],
  );

  useLayoutEffect(() => {
    if (group.current) {
      group.current.rotation.y = 3.6;
      group.current.rotation.x = 0.2;
    }
  }, []);

  useFrame((_, delta) => {
    if (!autoRotate || !group.current) return;
    group.current.rotation.y += Math.min(delta, 0.05) * 0.035;
  });

  return (
    <group ref={group}>
      <mesh material={baseMat}>
        <sphereGeometry args={[EARTH_RADIUS, 80, 80]} />
      </mesh>
      <mesh material={shadeMat} scale={1.001}>
        <sphereGeometry args={[EARTH_RADIUS, 80, 80]} />
      </mesh>
      {children}
    </group>
  );
}

export { EARTH_RADIUS };
