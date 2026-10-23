import * as THREE from 'three';

/**
 * Overhead sky for a supine patient.
 *
 * The lakeside art was built for someone standing on the shore looking out; a
 * patient lying on their back sees none of it. This layer adds what is actually
 * in their field of view: a slow cloud deck, a soft sun glow and a gradient dome
 * that keeps the edges of the view from reading as flat colour.
 *
 * Deliberately procedural (canvas textures, no assets) and small: one dome, a
 * few cloud sheets and one glow, all `fog: false` and depth-write free so they
 * never fight the scene geometry.
 */

/** Radius of the dome; inside the scene's fog far plane, outside the shoreline. */
const DOME_RADIUS = 80;

/** Cloud deck: three textured sheets high above the patient. */
const CLOUD_SHEETS = 3;
const CLOUD_SPREAD = 120;
const CLOUD_HEIGHT = 26;

export interface SkyLayer {
  root: THREE.Group;
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

function gradientTexture(
  zenith: string,
  mid: string,
  horizon: string,
  glow?: string
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Sphere UV v = 0 at the zenith, 1 at the nadir.
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, zenith);
    gradient.addColorStop(0.5, mid);
    gradient.addColorStop(0.82, horizon);
    gradient.addColorStop(1, horizon);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 256);
    if (glow) {
      // A warm patch low on one side reads as a rising sun without a second
      // mesh: the glow is painted into the dome's own texture.
      const spot = ctx.createRadialGradient(2, 196, 0, 2, 196, 90);
      spot.addColorStop(0, glow);
      spot.addColorStop(1, 'rgba(255, 233, 198, 0)');
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = spot;
      ctx.fillRect(0, 96, 4, 160);
      ctx.globalAlpha = 1;
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Soft blobs on transparent ground; tiles so one sheet reads as a cloud deck. */
function cloudTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    // Deterministic pseudo-random so the sky is identical run to run.
    let seed = 20261023;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 9; i += 1) {
      const x = 60 + random() * (size - 120);
      const y = 60 + random() * (size - 120);
      const radius = 55 + random() * 60;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      const alpha = 0.75 + random() * 0.25;
      gradient.addColorStop(0, `rgba(255, 255, 254, ${alpha.toFixed(3)})`);
      gradient.addColorStop(0.5, `rgba(253, 253, 252, ${(alpha * 0.7).toFixed(3)})`);
      gradient.addColorStop(0.8, `rgba(250, 250, 249, ${(alpha * 0.22).toFixed(3)})`);
      gradient.addColorStop(1, 'rgba(250, 250, 249, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createSkyLayer(): SkyLayer {
  const root = new THREE.Group();
  root.name = 'sky-layer';

  // Unit tests and the headless host have no canvas; the layer is inert there
  // rather than throwing, so scene construction stays testable.
  if (typeof document === 'undefined') {
    return {
      root,
      update: function (): void {},
      dispose: function (): void {
        root.clear();
        root.removeFromParent();
      }
    };
  }

  // One dome carries both the gradient and a warm glow, so the sky costs a
  // single opaque draw instead of dome + sun.
  const domeTexture = gradientTexture('#6F93B8', '#A8C2D6', '#EBD9C0', '#FFE9C6');
  const domeGeometry = new THREE.SphereGeometry(DOME_RADIUS, 18, 12);
  const domeMaterial = new THREE.MeshBasicMaterial({
    map: domeTexture,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    toneMapped: false
  });
  const dome = new THREE.Mesh(domeGeometry, domeMaterial);
  dome.name = 'sky-dome';
  dome.renderOrder = -10;
  root.add(dome);

  const cloudMap = cloudTexture();
  const cloudGeometry = new THREE.PlaneGeometry(1, 1);
  const sheets: THREE.Mesh[] = [];
  const sheetMaterials: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < CLOUD_SHEETS; i += 1) {
    const material = new THREE.MeshBasicMaterial({
      map: cloudMap,
      transparent: true,
      opacity: 0.66 - i * 0.14,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide
    });
    sheetMaterials.push(material);
    const sheet = new THREE.Mesh(cloudGeometry, material);
    sheet.name = `sky-clouds-${i}`;
    // Horizontal, facing down: the patient looks at its underside.
    sheet.rotation.x = Math.PI / 2;
    sheet.rotation.z = i * 0.7;
    sheet.position.y = CLOUD_HEIGHT + i * 7;
    sheet.scale.setScalar(CLOUD_SPREAD * (0.7 + i * 0.35));
    sheet.renderOrder = -8 + i;
    sheets.push(sheet);
    root.add(sheet);
  }

  return {
    root,
    update(dt: number, elapsed: number): void {
      for (let i = 0; i < sheets.length; i += 1) {
        const sheet = sheets[i];
        const speed = 0.012 + i * 0.005;
        sheet.position.x = Math.sin(elapsed * speed) * (5 + i * 3);
        sheet.position.z = Math.cos(elapsed * speed * 0.7) * (4 + i * 3);
        sheet.rotation.z += dt * (0.002 + i * 0.001);
        // Very slow UV crawl: the deck drifts even when the camera is still.
        const map = sheetMaterials[i].map;
        if (map) {
          map.offset.x = (map.offset.x + dt * (0.0015 + i * 0.0008)) % 1;
        }
      }
      dome.rotation.y += dt * 0.004;
    },
    dispose(): void {
      cloudGeometry.dispose();
      cloudMap.dispose();
      domeGeometry.dispose();
      domeMaterial.dispose();
      domeTexture.dispose();
      for (const sheet of sheets) {
        (sheet.material as THREE.Material).dispose();
      }
      root.clear();
      root.removeFromParent();
    }
  };
}
