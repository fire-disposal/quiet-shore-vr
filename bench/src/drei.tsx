import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { Instance, Instances } from '@react-three/drei/core/Instances';
import type * as THREE from 'three';

const COUNT = 5000;
const start = performance.now();

function Bench(): JSX.Element {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    const mountMs = performance.now() - start;
    // Drei populates instance matrices in its frame loop. Let the loop run a
    // few frames, then measure direct renders of the populated scene.
    const timer = window.setTimeout(() => {
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
        case: 'drei-inst',
        count: COUNT,
        mountMs,
        frameMs,
        drawCalls: info.calls,
        triangles: info.triangles,
        heapMB: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ? (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576
          : null
      };
    }, 300);
    return () => window.clearTimeout(timer);
  }, [gl, scene, camera]);

  return (
    <Instances limit={COUNT} range={COUNT} frames={1}>
      <boxGeometry args={[0.06, 0.06, 0.06]} />
      <meshBasicMaterial color={0x88d3c1} />
      {Array.from({ length: COUNT }, (_, i) => (
        <Instance
          key={i}
          position={[
            ((i % 70) - 35) * 0.09,
            (Math.floor(i / 70) % 70 - 35) * 0.09,
            (i % 11) * 0.03
          ]}
        />
      ))}
    </Instances>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <Canvas
    frameloop="always"
    dpr={1}
    camera={{ position: [0, 0, 6], fov: 60 }}
    gl={{ antialias: false, powerPreference: 'high-performance' }}
    onCreated={({ gl }) => gl.setClearColor(0x0a1211, 1)}
  >
    <hemisphereLight args={[0xffffff, 0x222222, 1.2]} />
    <Bench />
  </Canvas>
);
