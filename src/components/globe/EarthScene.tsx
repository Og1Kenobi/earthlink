import { Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";
import { ConnectionsLayer } from "./ConnectionsLayer";
import { Earth } from "./Earth";

function SceneContent() {
  return (
    <>
      <color attach="background" args={["#05070d"]} />
      <hemisphereLight args={["#cfe2ff", "#0a1420", 0.9]} />
      <ambientLight intensity={0.85} color="#eef4ff" />
      <directionalLight position={[5, 2.5, 4]} intensity={2.8} color="#fff6e8" />
      <directionalLight position={[-3, -1, -2]} intensity={0.55} color="#7eb6ff" />

      <Stars
        radius={80}
        depth={40}
        count={3500}
        factor={3}
        saturation={0}
        fade
        speed={0.2}
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
        dpr={[1, 1.5]}
        camera={{ position: [0, 0.35, 5.4], fov: 42, near: 0.1, far: 200 }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
          preserveDrawingBuffer: true,
        }}
        onCreated={({ gl }) => {
          gl.setClearColor("#05070d");
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.45;
        }}
      >
        <SceneContent />
      </Canvas>
    </div>
  );
}
