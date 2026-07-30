import { Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { ConnectionsLayer } from "./ConnectionsLayer";
import { Earth } from "./Earth";

function SceneContent() {
  return (
    <>
      <color attach="background" args={["#ffffff"]} />
      <hemisphereLight args={["#ffffff", "#cbd5e1", 0.85]} />
      <ambientLight intensity={1.1} color="#ffffff" />
      <directionalLight position={[5, 3, 4]} intensity={1.35} color="#ffffff" />
      <directionalLight
        position={[-4, -1, -2]}
        intensity={0.45}
        color="#93c5fd"
      />

      <Suspense fallback={null}>
        <Earth>
          <ConnectionsLayer />
        </Earth>
      </Suspense>

      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.06}
        minDistance={3.2}
        maxDistance={11}
        rotateSpeed={0.55}
        zoomSpeed={0.7}
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
        camera={{ position: [0, 0.35, 5.4], fov: 42, near: 0.1, far: 200 }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
          preserveDrawingBuffer: true,
        }}
        onCreated={({ gl }) => {
          gl.setClearColor("#ffffff");
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <SceneContent />
      </Canvas>
    </div>
  );
}
