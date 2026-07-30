import { Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";
import { ConnectionsLayer } from "./ConnectionsLayer";
import { Earth } from "./Earth";

function SceneContent() {
  return (
    <>
      <color attach="background" args={["#03060c"]} />
      <fog attach="fog" args={["#03060c", 9, 22]} />
      <hemisphereLight args={["#c4e0ff", "#020617", 0.55]} />
      <ambientLight intensity={0.45} color="#dbeafe" />
      <directionalLight position={[5, 3, 4]} intensity={1.55} color="#fff7ed" />
      <directionalLight
        position={[-4, -1, -2]}
        intensity={0.55}
        color="#38bdf8"
      />
      <pointLight position={[0, 0, 6]} intensity={0.35} color="#22d3ee" />

      <Stars
        radius={90}
        depth={50}
        count={4500}
        factor={3.2}
        saturation={0}
        fade
        speed={0.15}
      />

      <Suspense fallback={null}>
        <Earth>
          <ConnectionsLayer />
        </Earth>
      </Suspense>

      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.055}
        minDistance={3.15}
        maxDistance={12}
        rotateSpeed={0.5}
        zoomSpeed={0.75}
      />
    </>
  );
}

export function EarthScene() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg">
        <p className="font-mono text-sm text-muted">Initializing globe…</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <Canvas
        className="absolute inset-0 h-full w-full touch-none"
        dpr={[1, 1.75]}
        camera={{ position: [0, 0.4, 5.5], fov: 40, near: 0.1, far: 200 }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
          preserveDrawingBuffer: true,
        }}
        onCreated={({ gl }) => {
          gl.setClearColor("#03060c");
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.15;
        }}
      >
        <SceneContent />
      </Canvas>
    </div>
  );
}
