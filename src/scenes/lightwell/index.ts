import * as THREE from 'three';
import type { SceneSettings } from '../../core/scene/contract';
import { defineScene } from '../shared/define-scene';
import { createRandom, makeTexture } from '../shared/canvas';
import { smootherstep } from '../../core/xr/drivers/curve';

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

/** Square shaft: 6 m across, so a wall is 3 m from the eye. */
const SHAFT_SIDE = 6;
const SHAFT_HALF = SHAFT_SIDE / 2;
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
 * A square section, not a round one: four flat walls 3 m from the eye give the
 * brackets a human scale and the corners a hard vertical perspective, which is
 * what makes the depth read. The sense of descent comes from two layers that
 * never cross the eye plane:
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
/**
 * A fall, not a slide: accelerate along an S-curve, then hold terminal speed.
 *
 * An exponential ease is fastest the instant it starts and then decays — the
 * profile of something *gliding*. A falling body starts slow and keeps picking
 * up until drag balances it, so the speed follows smootherstep over
 * ACCEL_SECONDS and then stays at TERMINAL_SPEED. At the near wall (3 m) the
 * terminal speed is 5.7 °/s: brisk, still inside the comfort budget.
 */
const TERMINAL_SPEED = 0.3;
/** Time to reach terminal speed; longer reads as drift, shorter as a snap. */
const ACCEL_SECONDS = 2.2;
/** Stop is a brake, not drag: this cue must die quickly. */
const BRAKE = 2.6;

/** End colours, shared by the wall gradient and the caps so they match. */
const TOP_COLOR = '#E9DCC4';
/** Dark warm grey, not black: the shaft walls stay readable end to end. */
const BOTTOM_COLOR = '#181B1F';

export interface LightWellParts {
  root: THREE.Group;
  /** Session motion permission, 0..1: the well falls while a session runs. */
  setMotion(scale: number): void;
  update(dt: number): void;
  dispose(): void;
}

/**
 * Wall skin: one clean vertical light ramp and nothing else.
 *
 * The previous version drew eight panel bands plus mottling; on a 3 m wall the
 * bands read as ugly stripes and the blobs as glare. Minimal is also the most
 * believable here — a shaft lit from above is a gradient, not a pattern.
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
  }, { width: 8, height: 1024, repeat: [1, 1] });
}

export function createLightWell(): LightWellParts {
  const root = new THREE.Group();
  root.name = 'lightwell';

  const texture = shaftTexture();
  // Four planes, not a box: the box carried its own top and bottom faces at
  // exactly the height of the caps, and the two surfaces fought at 120 m —
  // that is the flicker. Planes also drop two hidden faces for free.
  const wallGeometry = new THREE.PlaneGeometry(SHAFT_SIDE, SHAFT_HEIGHT);
  const wallMaterial = new THREE.MeshBasicMaterial({
    ...(texture ? { map: texture } : {}),
    color: texture ? 0xffffff : 0x34383c,
    fog: false,
    toneMapped: false
  });
  const walls = new THREE.InstancedMesh(wallGeometry, wallMaterial, 4);
  walls.name = 'lightwell-walls';
  walls.frustumCulled = false;
  root.add(walls);
  const wallDummy = new THREE.Object3D();
  for (let i = 0; i < 4; i += 1) {
    // i: north, east, south, west — each plane turned to face the axis.
    const yaw = [0, -Math.PI / 2, Math.PI, Math.PI / 2][i];
    const px = i === 1 ? SHAFT_HALF : i === 3 ? -SHAFT_HALF : 0;
    const pz = i === 0 ? -SHAFT_HALF : i === 2 ? SHAFT_HALF : 0;
    wallDummy.position.set(px, EYE_Y, pz);
    wallDummy.rotation.set(0, yaw, 0);
    wallDummy.updateMatrix();
    walls.setMatrixAt(i, wallDummy.matrix);
  }
  walls.instanceMatrix.needsUpdate = true;

  // Caps copy the wall's end colours: 60 m away they read as "light above,
  // nothing below", not as a ceiling and a floor.
  const topGeometry = new THREE.PlaneGeometry(SHAFT_SIDE, SHAFT_SIDE);
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

  const bottomGeometry = new THREE.PlaneGeometry(SHAFT_SIDE, SHAFT_SIDE);
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

  // Everything structural is attached to the four walls: four corner posts
  // (static — they are the shaft's own frame and give the eye a fixed edge to
  // read the scroll against), one conduit run per wall, and the moving
  // brackets. A uniform ring told the eye "tube"; flat walls with hardware on
  // them tell it "shaft".
  const postGeometry = new THREE.BoxGeometry(0.24, SHAFT_HEIGHT, 0.24);
  const postMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#2B2F34'),
    toneMapped: false,
    fog: false
  });
  const posts = new THREE.InstancedMesh(postGeometry, postMaterial, 4);
  posts.name = 'lightwell-posts';
  posts.frustumCulled = false;
  root.add(posts);
  const postDummy = new THREE.Object3D();
  for (let i = 0; i < 4; i += 1) {
    const sx = i < 2 ? 1 : -1;
    const sz = i % 2 === 0 ? 1 : -1;
    postDummy.position.set(sx * (SHAFT_HALF - 0.12), EYE_Y, sz * (SHAFT_HALF - 0.12));
    postDummy.updateMatrix();
    posts.setMatrixAt(i, postDummy.matrix);
  }
  posts.instanceMatrix.needsUpdate = true;

  const conduitGeometry = new THREE.BoxGeometry(0.1, SHAFT_HEIGHT, 0.1);
  const conduits = new THREE.InstancedMesh(conduitGeometry, postMaterial, 4);
  conduits.name = 'lightwell-conduits';
  conduits.frustumCulled = false;
  root.add(conduits);
  const conduitDummy = new THREE.Object3D();
  for (let i = 0; i < 4; i += 1) {
    const along = (i % 2 === 0 ? 1 : -1) * (SHAFT_HALF * 0.55);
    switch (i) {
      case 0:
        conduitDummy.position.set(along, EYE_Y, -SHAFT_HALF + 0.06);
        break;
      case 1:
        conduitDummy.position.set(SHAFT_HALF - 0.06, EYE_Y, along * 0.5);
        break;
      case 2:
        conduitDummy.position.set(along * 0.5, EYE_Y, SHAFT_HALF - 0.06);
        break;
      default:
        conduitDummy.position.set(-SHAFT_HALF + 0.06, EYE_Y, along);
        break;
    }
    conduitDummy.updateMatrix();
    conduits.setMatrixAt(i, conduitDummy.matrix);
  }
  conduits.instanceMatrix.needsUpdate = true;

  // The moving hardware: a 1.6 m wide shelf 0.7 m deep, braced underneath.
  // At the old 9 m radius the same box subtended a fifth of the angle and read
  // as a stick; 3 m from the eye it reads as a shelf.
  const shelfGeometry = new THREE.BoxGeometry(1.6, 0.09, 0.7);
  shelfGeometry.translate(0, 0, 0.35);
  const gussetGeometry = new THREE.BoxGeometry(0.08, 0.8, 0.08);
  gussetGeometry.rotateX(Math.PI / 4);
  gussetGeometry.translate(0, -0.28, 0.24);
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

  // Centred band: fixtures live in [-FIXTURE_BAND/2, +FIXTURE_BAND/2]. Each one
  // hangs on one of the four walls and alternating walls keep the eye from
  // finding a ladder; the along-wall offsets do the same inside a wall.
  const fixtureY = new Float32Array(FIXTURE_COUNT);
  const fixtureWall = new Int8Array(FIXTURE_COUNT);
  const fixtureAlong = new Float32Array(FIXTURE_COUNT);
  /** Wall index → yaw that points the bracket's local +Z into the shaft. */
  const WALL_YAW = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
  for (let i = 0; i < FIXTURE_COUNT; i += 1) {
    fixtureY[i] = -FIXTURE_BAND / 2 + i * (FIXTURE_BAND / FIXTURE_COUNT);
    fixtureWall[i] = (i * 2) % 4;
    // Golden-ratio offsets inside the wall, so consecutive brackets never line up.
    const u = ((i * 0.618034) % 1) * 2 - 1;
    fixtureAlong[i] = u * (SHAFT_HALF - 0.9);
  }
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();

  function writeFixtures(): void {
    for (let i = 0; i < FIXTURE_COUNT; i += 1) {
      const y = fixtureY[i] + EYE_Y;
      const wall = fixtureWall[i];
      const along = fixtureAlong[i];
      // Anchor on the wall skin, local +Z pointing inward.
      switch (wall) {
        case 0:
          dummy.position.set(along, y, -SHAFT_HALF + 0.02);
          break;
        case 1:
          dummy.position.set(SHAFT_HALF - 0.02, y, along);
          break;
        case 2:
          dummy.position.set(along, y, SHAFT_HALF - 0.02);
          break;
        default:
          dummy.position.set(-SHAFT_HALF + 0.02, y, along);
          break;
      }
      dummy.rotation.set(0, WALL_YAW[wall], 0);
      dummy.updateMatrix();
      shelves.setMatrixAt(i, dummy.matrix);
      gussets.setMatrixAt(i, dummy.matrix);

      // Fade into the wall at both ends of the band so the wrap is invisible:
      // a shelf that pops out of existence is exactly the jitter this design
      // exists to remove.
      const u = Math.min(1, Math.max(0, (fixtureY[i] + FIXTURE_BAND / 2) / FIXTURE_BAND));
      const edge = Math.min(1, Math.min(u, 1 - u) * 6);
      const level = Math.min(0.52, 0.18 + 0.32 * u) * edge;
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

  // Motion state in metres per second: the shelves and the wall scroll share
  // one speed, so the picture stays physically consistent.
  // The well's fall is its own effect: a session that is running lets it fall,
  // a stop / capture / idle page does not. Posture and buoyancy never enter.
  let speed = 0;
  /** Seconds spent accelerating on the current fall. */
  let accelSeconds = 0;
  let motionScale = 0;
  let swayTime = 0;

  return {
    root,
    setMotion(scale: number): void {
      motionScale = Number.isFinite(scale) ? Math.min(1, Math.max(0, scale)) : 0;
    },
    update(dt: number): void {
      const targetSpeed = TERMINAL_SPEED * motionScale;
      if (targetSpeed > 0 && speed < targetSpeed) {
        // S-curve up to terminal: slow release, quickening middle, settle.
        accelSeconds = Math.min(ACCEL_SECONDS, accelSeconds + dt);
        const desired = targetSpeed * smootherstep(accelSeconds / ACCEL_SECONDS);
        speed = Math.max(speed, Math.min(targetSpeed, desired));
      } else {
        accelSeconds = Math.max(0, accelSeconds - dt);
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

    },
    dispose(): void {
      if (texture) texture.dispose();
      topGeometry.dispose();
      topMaterial.dispose();
      bottomGeometry.dispose();
      bottomMaterial.dispose();
      postGeometry.dispose();
      postMaterial.dispose();
      conduitGeometry.dispose();
      shelfGeometry.dispose();
      gussetGeometry.dispose();
      hardwareMaterial.dispose();
      wallGeometry.dispose();
      wallMaterial.dispose();
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
      zh: '6 米见方、240 米高的方井：井壁顶部亮成天光，底部沉进暗灰里，两头都在一百二十米外，看不到“盖”。四面墙上的托架轮流自下而上升起、到顶前淡出回收，像身体在下沉；四角的透视线给足纵深。所有运动都在井壁上，视点不动，也没有任何东西穿过眼前。',
      en: 'A shaft about 18 m across and 240 m tall: daylight above, dim grey below, both ends 120 metres away with no visible lid. Brackets and courses on the wall rise, fade before the top and recycle, so the body reads as descending. All motion is on the wall; nothing crosses the eye.'
    },
    // No ambience: water belongs to the shore and the washroom. This shaft is
    // meant to be heard as one's own breathing, not as a room.
    audio: undefined,
    // Vertical flow only: the highest motion-sickness risk of the three, so the
    // operator cannot take it past level 2 even with a standard profile.
    comfortLevel: 2
  },
  // The band centres on 1.70 m: that is where the eye belongs once standing.
  { standingEyeY: 1.7, supine: 'mattress' },
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
      setMotion: function (scale: number): void {
        parts.setMotion(scale);
      },
      dispose: function (): void {
        parts.dispose();
      }
    };
  }
);
