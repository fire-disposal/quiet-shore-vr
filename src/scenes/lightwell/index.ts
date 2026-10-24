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
 * Depth discipline: the shaft is 240 m tall and 18 m across, so its ends sit
 * ~120 m away in every direction — the previous 60 m ends showed their caps
 * too soon (field finding: looking up or down gave the depth away). The wall's
 * brightness is baked into the texture — bright at the top, dim at the bottom —
 * and the two caps use the *exact* colours of those end rows, so neither end
 * ever reads as a lid. There is no horizon, no floor line and no edge to catch
 * the eye; the only edges in the picture are the wall fixtures.
 */

const SHAFT_RADIUS = 9;
const SHAFT_HEIGHT = 240;
const EYE_Y = 1.7;

/**
 * Wall fixtures, not hoops.
 *
 * The old ring stack closed a full circle around the eye: every hoop had to
 * pass *through* the camera plane, where its silhouette expands to fill the
 * whole view and then flips. That is the "spinning" the user saw, and no
 * amplitude tuning removes it — a circle around the viewer cannot pass by.
 *
 * A falling body does not see circles. It sees things attached to the wall
 * sweep upward: brackets, ledges, courses. So the sense of descent comes from
 * two layers that never cross the eye plane:
 *
 *  - a tiling detail skin on the wall whose texture scrolls upward (seamless,
 *    no popping at all);
 *  - a handful of protruding shelves that ride up with it and recycle at the
 *    top of a 60 m band, faded into the wall tone before they wrap. The goal
 *    is weightlessness, so these are *rare*: six dim shelves over 60 m means
 *    one every ~33 s at terminal speed, never a ladder the body climbs.
 */
const FIXTURE_COUNT = 6;
const FIXTURE_BAND = 60;
/** One tie of the detail texture spans this many metres of wall. */
const DETAIL_COURSE_M = 20;
/**
 * Terminal speed approached with an exponential ease.
 *
 * The field pass replaced the gravity/drag model: its release jerked from
 * 1.8 m/s² and hung near the top of the ease. The rate form starts at
 * EASE_RATE · speed (≈ 0.49 m/s², a gentle release) and decays as the speed
 * closes on target, so the fall both starts softly and lands smoothly.
 */
/** 0.30 m/s at the 8.3 m shelf radius is 2.1 °/s, inside the near-field budget;
 *  weightlessness reads slower than descent does. */
const TERMINAL_SPEED = 0.3;
/** 1/s: ~63% of terminal after one second, asymptotic after that. */
const EASE_RATE = 1.4;
/** Stop is a brake, not drag: this cue must die quickly. */
const BRAKE = 2.6;

/** End colours, shared by the wall gradient and the caps so they match. */
const TOP_COLOR = '#E9DCC4';
/** Dark warm grey, not black: the shaft walls stay readable end to end. */
const BOTTOM_COLOR = '#181B1F';

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
    ramp.addColorStop(0.45, '#26292E');
    ramp.addColorStop(0.7, '#1C1F23');
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
    // Dark only: bright blobs on the wall read as glare spots (field finding)
    // and grab the eye during the fall.
    const random = createRandom(0x4f21);
    for (let i = 0; i < 300; i += 1) {
      const alpha = 0.012 + random() * 0.02;
      ctx.fillStyle = `rgba(0, 0, 0, ${(alpha * 1.5).toFixed(3)})`;
      const radius = 4 + random() * 22;
      ctx.beginPath();
      ctx.arc(random() * width, random() * height, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { width: 512, height: 2048, repeat: [1, 1] });
}

/**
 * Wall courses that tile vertically: ledges, brackets and rivets, all dark
 * except the highlights. Drawn on black and added on top of the light ramp, so
 * the skin can only brighten what the ramp already lights.
 *
 * Nothing is drawn within eight pixels of the tile's ends, so consecutive
 * repeats read as a course rhythm instead of a seam.
 */
function detailSkinTexture(): THREE.CanvasTexture | null {
  return makeTexture((ctx, width, height) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    const random = createRandom(0x7a13);

    const ledgeY = height * 0.34;
    for (let x = 0; x < width; x += 32) {
      const w = 18 + random() * 10;
      const shade = 0.1 + random() * 0.16;
      ctx.fillStyle = `rgba(255, 246, 230, ${shade.toFixed(3)})`;
      ctx.fillRect(x, ledgeY, w, 1.5);
    }

    for (let i = 0; i < 7; i += 1) {
      const x = 12 + random() * (width - 24);
      const h = 10 + random() * 16;
      ctx.fillStyle = `rgba(255, 244, 226, ${(0.06 + random() * 0.1).toFixed(3)})`;
      ctx.fillRect(x, ledgeY + 2, 2, h);
      ctx.fillRect(x, ledgeY + 2 + h, 7, 1.5);
    }

    for (let i = 0; i < 26; i += 1) {
      const x = 8 + random() * (width - 16);
      const y = 20 + random() * (height - 40);
      ctx.fillStyle = `rgba(255, 250, 240, ${(0.04 + random() * 0.05).toFixed(3)})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }, { size: 256, repeat: [1, 6] });
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

  // Directional wall hardware, not hoops. A uniform ring tells the eye "tube";
  // a bracket on one side tells it "shaft with a direction", and its lateral
  // parallax as it sweeps past is what sells vertical travel. Two boxes per
  // fixture: a radial shelf and the gusset under it.
  const shelfGeometry = new THREE.BoxGeometry(0.95, 0.09, 0.8);
  shelfGeometry.translate(-0.475, 0, 0);
  const gussetGeometry = new THREE.BoxGeometry(0.14, 0.5, 0.5);
  gussetGeometry.translate(-0.07, -0.27, 0);
  const hardwareMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
    fog: false
  });
  const shelves = new THREE.InstancedMesh(shelfGeometry, hardwareMaterial, FIXTURE_COUNT);
  shelves.name = 'lightwell-shelves';
  shelves.frustumCulled = false;
  root.add(shelves);
  const gussets = new THREE.InstancedMesh(gussetGeometry, hardwareMaterial, FIXTURE_COUNT);
  gussets.name = 'lightwell-gussets';
  gussets.frustumCulled = false;
  root.add(gussets);

  // 32 tubular segments: at 8 m a 12-gon is visibly faceted, and a faceted
  // hoop sweeping past is the "chaotic" edge the eye grabs first.
  // Detail skin: the same shaft, one millimetre inside, carrying a tiling
  // course pattern. Additive so it only ever brightens the ramp above.
  const detailTexture = detailSkinTexture();
  const detailGeometry = new THREE.CylinderGeometry(
    SHAFT_RADIUS - 0.02,
    SHAFT_RADIUS - 0.02,
    SHAFT_HEIGHT,
    24,
    1,
    true
  );
  const detailMaterial = new THREE.MeshBasicMaterial({
    ...(detailTexture ? { map: detailTexture } : {}),
    color: detailTexture ? 0xffffff : 0x000000,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false
  });
  const detail = new THREE.Mesh(detailGeometry, detailMaterial);
  detail.name = 'lightwell-detail';
  detail.position.y = EYE_Y;
  detail.frustumCulled = false;
  root.add(detail);

  // Centred band: fixtures live in [-FIXTURE_BAND/2, +FIXTURE_BAND/2], one
  // azimuth each, spread by the golden angle so no two ever line up and the
  // eye never finds a ladder pattern to lock onto.
  const fixtureY = new Float32Array(FIXTURE_COUNT);
  const fixtureAzimuth = new Float32Array(FIXTURE_COUNT);
  const GOLDEN_ANGLE = 2.399963229728653;
  for (let i = 0; i < FIXTURE_COUNT; i += 1) {
    fixtureY[i] = -FIXTURE_BAND / 2 + i * (FIXTURE_BAND / FIXTURE_COUNT);
    fixtureAzimuth[i] = (i * GOLDEN_ANGLE) % (Math.PI * 2);
  }
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();

  /** Wall radius a fixture hangs from; its shelf reaches 0.95 m inward. */
  const WALL_R = SHAFT_RADIUS - 0.04;

  function writeFixtures(): void {
    for (let i = 0; i < FIXTURE_COUNT; i += 1) {
      const y = fixtureY[i] + EYE_Y;
      const azimuth = fixtureAzimuth[i];
      // Local +X points at the axis: rotate by (pi - a) so the box grows inward.
      const rotationY = Math.PI - azimuth;

      // The box is translated to span [-0.95, 0] on local X, so anchoring the
      // instance on the wall makes the shelf touch it and grow inward.
      dummy.position.set(Math.cos(azimuth) * WALL_R, y, Math.sin(azimuth) * WALL_R);
      dummy.rotation.set(0, rotationY, 0);
      dummy.updateMatrix();
      shelves.setMatrixAt(i, dummy.matrix);

      dummy.position.set(Math.cos(azimuth) * WALL_R, y - 0.045, Math.sin(azimuth) * WALL_R);
      dummy.updateMatrix();
      gussets.setMatrixAt(i, dummy.matrix);

      // Fade into the wall at both ends of the band so the wrap is invisible:
      // a shelf that pops out of existence is exactly the jitter this design
      // exists to remove.
      const u = Math.min(1, Math.max(0, (fixtureY[i] + FIXTURE_BAND / 2) / FIXTURE_BAND));
      const edge = Math.min(1, Math.min(u, 1 - u) * 6);
      const level = Math.min(0.48, 0.16 + 0.3 * u) * edge;
      tint.setRGB(level, level * 0.96, level * 0.9);
      shelves.setColorAt(i, tint);
      gussets.setColorAt(i, tint);
    }
    shelves.instanceMatrix.needsUpdate = true;
    if (shelves.instanceColor) shelves.instanceColor.needsUpdate = true;
    gussets.instanceMatrix.needsUpdate = true;
    if (gussets.instanceColor) gussets.instanceColor.needsUpdate = true;
  }
  writeFixtures();

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
        // Exponential ease: strongest acceleration right at release, decaying
        // to zero as the speed closes on target — soft start, smooth landing.
        speed = Math.min(
          targetSpeed,
          speed + (targetSpeed - speed) * Math.min(1, EASE_RATE * dt)
        );
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

      // The body falls; the well stands still. So everything mounted on the
      // wall sweeps *upward* past the eye and recycles at the top of the band.
      // Nothing crosses the camera plane, so nothing can flare into a hoop.
      const travel = dt * speed;
      for (let i = 0; i < FIXTURE_COUNT; i += 1) {
        fixtureY[i] += travel;
        if (fixtureY[i] > FIXTURE_BAND / 2) {
          fixtureY[i] -= FIXTURE_BAND;
        }
      }
      writeFixtures();

      // The wall's own courses scroll with the fixtures: the texture wraps by
      // construction, so this is the seamless half of the fall.
      if (detailTexture) {
        detailTexture.offset.y =
          (detailTexture.offset.y + travel / DETAIL_COURSE_M) % 1;
      }
    },
    dispose(): void {
      shaftGeometry.dispose();
      shaftMaterial.dispose();
      if (texture) texture.dispose();
      topGeometry.dispose();
      topMaterial.dispose();
      bottomGeometry.dispose();
      bottomMaterial.dispose();
      shelfGeometry.dispose();
      gussetGeometry.dispose();
      hardwareMaterial.dispose();
      detailGeometry.dispose();
      detailMaterial.dispose();
      if (detailTexture) detailTexture.dispose();
      root.clear();
      root.removeFromParent();
    }
  };
}

const BACKGROUND = 0x121418;

export const lightwellScene = defineScene(
  {
    id: 'lightwell',
    name: { zh: '光井', en: 'Light Well' },
    tagline: {
      zh: '井壁的托架一级级向上掠过，身体被带着下沉。',
      en: 'Brackets on the wall sweep upward and carry the body down with them.'
    },
    description: {
      zh: '约 18 米直径、240 米高的竖井：井壁顶部亮成天光，底部沉进暗灰里，两头都在一百二十米外，看不到“盖”。井壁上的托架与横档自下而上升起、到顶前淡出回收，像身体在下沉。所有运动都在井壁上，视点不动，也没有任何东西穿过眼前。',
      en: 'A shaft about 18 m across and 240 m tall: daylight above, dim grey below, both ends 120 metres away with no visible lid. Brackets and courses on the wall rise, fade before the top and recycle, so the body reads as descending. All motion is on the wall; nothing crosses the eye.'
    },
    // No ambience: water belongs to the shore and the washroom. This shaft is
    // meant to be heard as one's own breathing, not as a room.
    audio: undefined,
    // Vertical flow only: the highest motion-sickness risk of the three, so the
    // operator cannot take it past level 2 even with a standard profile.
    comfortLevel: 2
  },
  // Supine inside the shaft: `EYE_Y` is where the rings centre, so it is also
  // where the eye belongs.
  { eyeY: 1.7 },
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
