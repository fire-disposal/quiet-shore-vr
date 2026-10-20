import { useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const COUNT = 1000;
const start = performance.now();

function report(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, mountMs: number): void {
  for (let i = 0; i < 5; i += 1) {
    gl.render(scene, camera);
  }
  const t0 = performance.now();
  for (let i = 0; i < 120; i += 1) {
    gl.render(scene, camera);
  }
  const frameMs = (performance.now() - t0) / 120;
  const info = gl.info.render;
  (window as unknown as { __bench: unknown }).__bench = {
    case: 'r3f-mesh',
    count: COUNT,
    mountMs,
    frameMs,
    drawCalls: info.calls,
    triangles: info.triangles,
    heapMB: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
      ? (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576
      : null
  };
}

function Bench(): JSX.Element {
  const { gl, scene, camera } = useThree();
  const geometry = useMemo(() => new THREE.BoxGeometry(0.08, 0.08, 0.08), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: 0x88d3c1 }), []);

  useEffect(() => {
    gl.render(scene, camera);
    const mountMs = performance.now() - start;
    report(gl, scene, camera, mountMs);
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [gl, scene, camera, geometry, material]);

  return (
    <>
      {Array.from({ length: COUNT }, (_, i) => (
        <mesh
          key={i}
          geometry={geometry}
          material={material}
          position={[
            ((i % 40) - 20) * 0.14,
            (Math.floor(i / 40) % 25 - 12) * 0.14,
            (i % 7) * 0.04
          ]}
        />
      ))}
    </>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <Canvas
    frameloop="never"
    dpr={1}
    camera={{ position: [0, 0, 6], fov: 60 }}
    gl={{ antialias: false, powerPreference: 'high-performance' }}
    onCreated={({ gl }) => gl.setClearColor(0x0a1211, 1)}
  >
    <hemisphereLight args={[0xffffff, 0x222222, 1.2]} />
    <Bench />
  </Canvas>
);
