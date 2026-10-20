import * as THREE from 'three';

const COUNT = 1000;

function measure(): void {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(640, 480, false);
  renderer.setClearColor(0x0a1211, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 640 / 480, 0.1, 100);
  camera.position.set(0, 0, 6);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 1.2));

  const geometry = new THREE.BoxGeometry(0.08, 0.08, 0.08);
  const material = new THREE.MeshBasicMaterial({ color: 0x88d3c1 });

  const start = performance.now();
  for (let i = 0; i < COUNT; i += 1) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      ((i % 40) - 20) * 0.14,
      (Math.floor(i / 40) % 25 - 12) * 0.14,
      (i % 7) * 0.04
    );
    scene.add(mesh);
  }
  renderer.render(scene, camera);
  const mountMs = performance.now() - start;

  for (let i = 0; i < 5; i += 1) {
    renderer.render(scene, camera);
  }
  const t0 = performance.now();
  for (let i = 0; i < 120; i += 1) {
    renderer.render(scene, camera);
  }
  const frameMs = (performance.now() - t0) / 120;

  const info = renderer.info.render;
  (window as unknown as { __bench: unknown }).__bench = {
    case: 'vanilla-mesh',
    count: COUNT,
    mountMs,
    frameMs,
    drawCalls: info.calls,
    triangles: info.triangles,
    heapMB: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
      ? (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576
      : null
  };

  geometry.dispose();
  material.dispose();
  renderer.dispose();
}

measure();
