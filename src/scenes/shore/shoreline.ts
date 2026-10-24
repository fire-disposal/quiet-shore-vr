import * as THREE from 'three';
import { createRandom, makeTexture } from '../shared/canvas';

/**
 * Anchors for the near shore: three weathered mooring posts and two clumps of
 * reeds, all inside four metres of the patient's head.
 *
 * A supine patient has no proprioceptive "where am I" anchor, and a lake with
 * nothing in it gives the eye nothing to measure the head against. Near-field
 * objects are the strongest presence cue on a 3DoF headset: with rotation-only
 * tracking, an object at 1–4 m still swings across the view when the head
 * turns. They also restore scale — a 1.5 m post is a fixed reference.
 *
 * Two instanced draws, no per-frame allocation, ~60 triangles.
 */

const POST_COUNT = 3;
const REED_CLUMPS = 2;
const REEDS_PER_CLUMP = 7;

function woodTexture(): THREE.CanvasTexture | null {
  return makeTexture((ctx, width, height) => {
  const ramp = ctx.createLinearGradient(0, 0, 0, height);
  ramp.addColorStop(0, '#6E5B45');
  ramp.addColorStop(0.55, '#5A4936');
  ramp.addColorStop(1, '#3B3026');
  ctx.fillStyle = ramp;
  ctx.fillRect(0, 0, width, height);
  const random = createRandom(0x51ab);
  for (let i = 0; i < 26; i += 1) {
    const x = random() * width;
    const alpha = 0.05 + random() * 0.1;
    ctx.fillStyle = `rgba(28, 22, 16, ${alpha.toFixed(3)})`;
    ctx.fillRect(x, 0, 0.6 + random() * 1.6, height);
  }
  const wet = ctx.createLinearGradient(0, height * 0.72, 0, height);
  wet.addColorStop(0, 'rgba(24, 30, 28, 0)');
  wet.addColorStop(1, 'rgba(24, 30, 28, 0.55)');
  ctx.fillStyle = wet;
  ctx.fillRect(0, height * 0.72, width, height * 0.28);
  }, { width: 64, height: 256 });
}

function reedTexture(): THREE.CanvasTexture | null {
  return makeTexture((ctx, width, height) => {
  ctx.clearRect(0, 0, width, height);
  const random = createRandom(0x7e3d);
  for (let i = 0; i < 9; i += 1) {
    const x = 12 + random() * (width - 24);
    const lean = (random() - 0.5) * 26;
    const top = height * (0.04 + random() * 0.24);
    const grad = ctx.createLinearGradient(0, height, 0, top);
    grad.addColorStop(0, 'rgba(74, 86, 58, 0.0)');
    grad.addColorStop(0.18, 'rgba(84, 96, 64, 0.75)');
    grad.addColorStop(1, 'rgba(120, 130, 92, 0.35)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.6 + random() * 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, height);
    ctx.quadraticCurveTo(x + lean * 0.4, height * 0.55, x + lean, top);
    ctx.stroke();
  }
  }, { width: 128, height: 256 });
}

/** Two crossed quads: one draw, and it never disappears edge-on. */
function crossQuads(width: number, height: number): THREE.BufferGeometry {
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const quad = (x0: number, z0: number, x1: number, z1: number): void => {
    const base = positions.length / 3;
    positions.push(x0, -halfHeight, z0, x1, -halfHeight, z1, x1, halfHeight, z1, x0, halfHeight, z0);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  quad(-halfWidth, 0, halfWidth, 0);
  quad(0, -halfWidth, 0, halfWidth);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export interface ShorelineLayer {
  root: THREE.Group;
  dispose(): void;
}

export function createShoreline(): ShorelineLayer {
  const root = new THREE.Group();
  root.name = 'shore-line';
  const random = createRandom(0x2f81);

  const postGeometry = new THREE.BoxGeometry(0.13, 1, 0.13);
  const postTexture = woodTexture();
  const postMaterial = new THREE.MeshBasicMaterial({
    ...(postTexture ? { map: postTexture } : {}),
    color: postTexture ? 0xffffff : 0x5b4a37,
    toneMapped: false
  });
  const posts = new THREE.InstancedMesh(postGeometry, postMaterial, POST_COUNT);
  posts.name = 'shore-posts';
  const postSpecs = [
    { x: -1.15, z: -2.1, height: 1.55, tilt: 0.05 },
    { x: 0.85, z: -2.6, height: 1.15, tilt: -0.08 },
    { x: 2.3, z: -5.4, height: 1.35, tilt: 0.03 }
  ];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < postSpecs.length; i += 1) {
    const spec = postSpecs[i];
    dummy.position.set(spec.x, spec.height * 0.5 - 0.08, spec.z);
    dummy.rotation.set(spec.tilt, random() * Math.PI, spec.tilt * 0.6);
    dummy.scale.set(1, spec.height, 1);
    dummy.updateMatrix();
    posts.setMatrixAt(i, dummy.matrix);
  }
  posts.instanceMatrix.needsUpdate = true;
  posts.frustumCulled = false;
  root.add(posts);

  const reedGeometry = crossQuads(0.55, 1.15);
  const reedTextureMap = reedTexture();
  const reedMaterial = new THREE.MeshBasicMaterial({
    ...(reedTextureMap ? { map: reedTextureMap } : {}),
    color: reedTextureMap ? 0xffffff : 0x6d7a52,
    transparent: true,
    depthWrite: false,
    fog: true,
    toneMapped: false,
    side: THREE.DoubleSide
  });
  const reeds = new THREE.InstancedMesh(reedGeometry, reedMaterial, REED_CLUMPS * REEDS_PER_CLUMP);
  reeds.name = 'shore-reeds';
  reeds.renderOrder = 1;
  let index = 0;
  const clumps = [
    { x: -1.9, z: -1.4 },
    { x: 1.55, z: -1.1 }
  ];
  for (let c = 0; c < clumps.length; c += 1) {
    for (let r = 0; r < REEDS_PER_CLUMP; r += 1) {
      const clump = clumps[c];
      const scale = 0.7 + random() * 0.55;
      dummy.position.set(
        clump.x + (random() - 0.5) * 0.9,
        0.52 * scale,
        clump.z + (random() - 0.5) * 0.5
      );
      dummy.rotation.set(0, random() * Math.PI, 0);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      reeds.setMatrixAt(index, dummy.matrix);
      index += 1;
    }
  }
  reeds.instanceMatrix.needsUpdate = true;
  reeds.frustumCulled = false;
  root.add(reeds);

  return {
    root,
    dispose(): void {
      postGeometry.dispose();
      postMaterial.dispose();
      if (postTexture) postTexture.dispose();
      reedGeometry.dispose();
      reedMaterial.dispose();
      if (reedTextureMap) reedTextureMap.dispose();
      root.clear();
      root.removeFromParent();
    }
  };
}
