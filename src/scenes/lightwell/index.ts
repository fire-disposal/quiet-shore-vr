import * as THREE from 'three';
import type { SceneSettings } from '../../core/scene/contract';
import { defineScene } from '../shared/define-scene';
import { createRandom, makeTexture } from '../shared/canvas';

/**
 * The light well: a very tall shaft the patient is standing in.
 *
 * The patient is supine in bed; the comfort layer has already rotated the
 * world so their eye sits at a standing reference. What this scene adds is
 * **motion along the body axis** — the cue `docs/research-standing-sensation.md`
 * §2.1 names as the strongest vection stimulus for a supine viewer, with a
 * 1–10 s onset that must be ramped, never switched on.
 *
 * Depth discipline: the shaft is 120 m tall and 18 m across, so its ends sit
 * ~60 m away in every direction. The wall's brightness is baked into the
 * texture — bright at the top, black at the bottom — and the two caps use the
 * *exact* colours of those end rows, so neither end ever reads as a lid. There
 * is no horizon, no floor line and no edge to catch the eye; the only edges in
 * the picture are the rings.
 */

const SHAFT_RADIUS = 9;
const SHAFT_HEIGHT = 120;
const EYE_Y = 1.7;

/** Ring band: they live within ±RING_BAND and fade out before wrapping. */
const RING_COUNT = 13;
const RING_GAP = 7;
const RING_BAND = RING_COUNT * RING_GAP;
/**
 * Terminal-velocity motion with a real drag term.
 *
 * The stack starts from rest and accelerates under a visual gravity, while a
 * quadratic drag term grows with speed² until the two balance at
 * TERMINAL_SPEED. That is why the last stretch *approaches* the speed instead
 * of hitting it: acceleration decays to zero, which is exactly what a body
 * falling through air does. A constant-rate ramp (the previous version) snaps
 * from accelerating to coasting, and exponential easing never settles at all.
 */
const TERMINAL_SPEED = 0.85;
/** Visual gravity, m/s². Sets how briskly the stack gets going. */
const GRAVITY = 1.8;
/** Drag coefficient chosen so gravity and drag balance at TERMINAL_SPEED. */
const DRAG = GRAVITY / (TERMINAL_SPEED * TERMINAL_SPEED);
/** Stop is a brake, not drag: this cue must die quickly. */
const BRAKE = 2.6;

/** End colours, shared by the wall gradient and the caps so they match. */
const TOP_COLOR = '#E9DCC4';
const BOTTOM_COLOR = '#0B0D0F';

export interface LightWellParts {
  root: THREE.Group;
  setFlow(flow: number): void;
  update(dt: number): void;
  dispose(): void;
}

/**
 * Wall skin: eight concrete panels wide, one course per 4 m, and the whole
 * vertical light ramp baked in. The texture is *not* repeated vertically —
 * that is what lets the caps copy its end colours exactly.
 */
function shaftTexture(): THREE.CanvasTexture | null {
  return makeTexture((ctx, width, height) => {
    const ramp = ctx.createLinearGradient(0, 0, 0, height);
    ramp.addColorStop(0.0, TOP_COLOR);
    ramp.addColorStop(0.05, '#C9BCA4');
    ramp.addColorStop(0.16, '#6A6C6C');
    ramp.addColorStop(0.3, '#3C4044');
    ramp.addColorStop(0.45, '#171A1D');
    ramp.addColorStop(0.7, '#0D0F11');
    ramp.addColorStop(1.0, BOTTOM_COLOR);
    ctx.fillStyle = ramp;
    ctx.fillRect(0, 0, width, height);

    // Panels read through tone, not through drawn lines: hard seams converge
    // into a star at the top of a shaft and are the first thing the eye hates.
    for (let i = 0; i < 8; i += 1) {
      const shade = i % 2 === 0 ? 0.012 : -0.012;
      ctx.fillStyle = shade > 0
        ? `rgba(255, 255, 255, ${shade})`
        : `rgba(0, 0, 0, ${-shade})`;
      ctx.fillRect((i / 8) * width, 0, width / 8, height);
    }

    // Faint mottling so the panels are not flat colour after magnification.
    const random = createRandom(0x4f21);
    for (let i = 0; i < 420; i += 1) {
      const alpha = 0.012 + random() * 0.02;
      ctx.fillStyle = random() > 0.5
        ? `rgba(255, 255, 255, ${alpha.toFixed(3)})`
        : `rgba(0, 0, 0, ${(alpha * 1.5).toFixed(3)})`;
      const radius = 4 + random() * 22;
      ctx.beginPath();
      ctx.arc(random() * width, random() * height, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { width: 512, height: 2048, repeat: [1, 1] });
}

export function createLightWell(): LightWellParts {
  const root = new THREE.Group();
  root.name = 'lightwell';

  const texture = shaftTexture();
  const shaftGeometry = new THREE.CylinderGeometry(
    SHAFT_RADIUS,
    SHAFT_RADIUS,
    SHAFT_HEIGHT,
    12,
    1,
    true
  );
  const shaftMaterial = new THREE.MeshBasicMaterial({
    ...(texture ? { map: texture } : {}),
    color: texture ? 0xffffff : 0x34383c,
    side: THREE.BackSide,
    fog: false,
    toneMapped: false
  });
  const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
  shaft.name = 'lightwell-shaft';
  shaft.position.y = EYE_Y;
  shaft.frustumCulled = false;
  root.add(shaft);

  // Caps copy the wall's end colours: 60 m away they read as "light above,
  // nothing below", not as a ceiling and a floor.
  const topGeometry = new THREE.CircleGeometry(SHAFT_RADIUS, 32);
  topGeometry.rotateX(Math.PI / 2);
  const topMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(TOP_COLOR),
    toneMapped: false,
    fog: false
  });
  const top = new THREE.Mesh(topGeometry, topMaterial);
  top.name = 'lightwell-top';
  top.position.y = EYE_Y + SHAFT_HEIGHT / 2;
  root.add(top);

  const bottomGeometry = new THREE.CircleGeometry(SHAFT_RADIUS, 32);
  bottomGeometry.rotateX(-Math.PI / 2);
  const bottomMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(BOTTOM_COLOR),
    toneMapped: false,
    fog: false
  });
  const bottom = new THREE.Mesh(bottomGeometry, bottomMaterial);
  bottom.name = 'lightwell-bottom';
  bottom.position.y = EYE_Y - SHAFT_HEIGHT / 2;
  root.add(bottom);

  // Each ring is a fixture of the well, not a floating hoop: a shallow cone
  // shelf that meets the wall at its outer edge and protrudes about 0.7 m at
  // its inner edge, with a lit rim on top.
  const ribGeometry = new THREE.CylinderGeometry(
    SHAFT_RADIUS - 0.72,
    SHAFT_RADIUS - 0.04,
    0.45,
    12,
    1,
    true
  );
  {
    const position = ribGeometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i += 1) {
      const t = (position.getY(i) + 0.225) / 0.45;
      const shade = 0.18 + 0.42 * t;
      colors[i * 3] = shade;
      colors[i * 3 + 1] = shade;
      colors[i * 3 + 2] = shade;
    }
    ribGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  const ribMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    toneMapped: false,
    fog: false,
    side: THREE.DoubleSide
  });
  const ribs = new THREE.InstancedMesh(ribGeometry, ribMaterial, RING_COUNT);
  ribs.name = 'lightwell-ribs';
  ribs.frustumCulled = false;
  root.add(ribs);

  const ringGeometry = new THREE.TorusGeometry(SHAFT_RADIUS - 0.74, 0.07, 3, 12);
  ringGeometry.rotateX(Math.PI / 2);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
    fog: false
  });
  const rings = new THREE.InstancedMesh(ringGeometry, ringMaterial, RING_COUNT);
  rings.name = 'lightwell-rings';
  rings.frustumCulled = false;
  root.add(rings);

  // Centred band: rings live in [-RING_BAND/2, +RING_BAND/2] around the eye.
  const ringY = new Float32Array(RING_COUNT);
  for (let i = 0; i < RING_COUNT; i += 1) {
    ringY[i] = -RING_BAND / 2 + i * RING_GAP;
  }
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();

  function writeRings(): void {
    for (let i = 0; i < RING_COUNT; i += 1) {
      const y = ringY[i] + EYE_Y;
      dummy.position.set(0, y, 0);
      dummy.updateMatrix();
      ribs.setMatrixAt(i, dummy.matrix);
      dummy.position.set(0, y + 0.24, 0);
      dummy.updateMatrix();
      rings.setMatrixAt(i, dummy.matrix);

      // Fade with the wall, not to black: at the bright top a dark fixture
      // would read as a black band, and at the black bottom a bright one pops.
      const u = Math.min(1, Math.max(0, (ringY[i] + RING_BAND / 2) / RING_BAND));
      const level = Math.min(1, 0.3 + 0.8 * u);
      tint.setRGB(1.0 * level, 0.94 * level, 0.85 * level);
      ribs.setColorAt(i, tint);
      const glow = Math.min(1, 0.35 + 1.1 * u);
      tint.setRGB(1.0 * glow, 0.95 * glow, 0.86 * glow);
      rings.setColorAt(i, tint);
    }
    ribs.instanceMatrix.needsUpdate = true;
    rings.instanceMatrix.needsUpdate = true;
    if (ribs.instanceColor) ribs.instanceColor.needsUpdate = true;
    if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
  }
  writeRings();

  // Motion state in metres per second, not in "flow units": the rings and the
  // wall scroll share one speed, so the picture stays physically consistent.
  let speed = 0;
  let targetFlow = 0;
  let swayTime = 0;

  return {
    root,
    setFlow(next: number): void {
      targetFlow = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : 0;
    },
    update(dt: number): void {
      const targetSpeed = TERMINAL_SPEED * targetFlow;
      if (targetSpeed > 0 && speed < targetSpeed) {
        // Gravity minus quadratic drag: acceleration fades to zero exactly at
        // the balance point, so the approach is asymptotic, never a step.
        const accel = Math.max(0, GRAVITY - DRAG * speed * speed);
        speed = Math.min(targetSpeed, speed + accel * dt);
      } else {
        speed = Math.max(targetSpeed, speed - BRAKE * dt);
      }
      if (speed <= 0.0001) {
        speed = 0;
        return;
      }
      // Body sway, not scene rotation: two incommensurate sines per axis at
      // roughly 0.5–1.4 rad/s, kept under 0.1° so it reads as a standing
      // person's balance rather than as the well moving.
      swayTime += dt;
      const sway = 0.4 + 0.6 * (speed / TERMINAL_SPEED);
      root.rotation.y = sway * (
        0.0018 * Math.sin(swayTime * 0.83) + 0.0011 * Math.sin(swayTime * 1.37 + 1.7)
      );
      root.rotation.x = sway * (
        0.0013 * Math.sin(swayTime * 1.07 + 0.6) + 0.0008 * Math.sin(swayTime * 0.61 + 2.3)
      );
      root.position.x = sway * 0.006 * Math.sin(swayTime * 0.51 + 1.1);
      root.position.z = sway * 0.005 * Math.sin(swayTime * 0.73 + 2.7);

      // The body falls; the well stands still. So the fixtures sweep *upward*
      // past the eye and recycle at the top of the band.
      const travel = dt * speed;
      for (let i = 0; i < RING_COUNT; i += 1) {
        ringY[i] += travel;
        if (ringY[i] > RING_BAND / 2) {
          ringY[i] -= RING_BAND;
        }
      }
      writeRings();
    },
    dispose(): void {
      shaftGeometry.dispose();
      shaftMaterial.dispose();
      if (texture) texture.dispose();
      topGeometry.dispose();
      topMaterial.dispose();
      bottomGeometry.dispose();
      bottomMaterial.dispose();
      ribGeometry.dispose();
      ribMaterial.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      root.clear();
      root.removeFromParent();
    }
  };
}

const BACKGROUND = 0x0b0d0f;

export const lightwellScene = defineScene(
  {
    id: 'lightwell',
    name: { zh: '光井', en: 'Light Well' },
    tagline: {
      zh: '一圈圈光从脚下掠过，身体被往上带。',
      en: 'Rings of light pass upward and carry the body with them.'
    },
    description: {
      zh: '约 18 米直径、120 米高的竖井：井壁顶部亮成天光，底部沉进黑里，两头都在六十米外，看不到“盖”。十三道暖白圆环自下而上掠过，靠近视野中心时最亮，出视野前先暗下去。所有运动都在环境里，视点不动。',
      en: 'A shaft about 18 m across and 120 m tall: daylight at the top, black below, both ends sixty metres away with no visible lid. Thirteen warm rings pass upward, brightest near the centre of the view and dimming before they leave it. All motion is in the environment; the viewpoint never moves.'
    },
    // No ambience: water belongs to the shore and the washroom. This shaft is
    // meant to be heard as one's own breathing, not as a room.
    audio: undefined
  },
  function () {
    const parts = createLightWell();
    const settings: SceneSettings = {
      background: new THREE.Color(BACKGROUND),
      fog: null
    };
    return {
      root: parts.root,
      settings,
      update: function (dt: number): void {
        parts.update(dt);
      },
      setFlow: function (value: number): void {
        parts.setFlow(value);
      },
      dispose: function (): void {
        parts.dispose();
      }
    };
  }
);
