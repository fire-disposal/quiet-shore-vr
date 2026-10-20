import * as THREE from 'three';
import { SpatialAnchor } from '../core/spatial/anchor';
import { computeWorldBillboardPose, createSpatialPose } from '../core/spatial/placement';
import type { SpatialMode } from '../core/spatial/types';
import type { SpatialTheme } from '../core/spatial/theme';
import { DEFAULT_SPATIAL_THEME } from '../core/spatial/theme';
import type { HeadPose } from '../core/xr/types';
import type { SpatialInput } from './spatial/input';
import { SpatialSurface } from './spatial/surface';

/** Optional labels; the app `Strings` table has matching fields. */
export interface SpatialLabStrings {
  labSummoned?: string;
  labHeadLocked?: string;
  labWorldLocked?: string;
  labBillboard?: string;
}

export interface SpatialLabOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  input: SpatialInput;
  theme?: SpatialTheme;
  strings?: SpatialLabStrings;
}

export interface SpatialLabApi {
  toggle(head?: HeadPose | null): void;
  close(): void;
  isOpen(): boolean;
  update(head?: HeadPose | null, dt?: number, now?: number): void;
  dispose(): void;
}

interface LabPanelDefinition {
  mode: SpatialMode;
  title: string;
  body: string;
  /** Summoned / head-locked / world-locked spacing. */
  distance: number;
  yawOffsetDeg: number;
  heightOffset: number;
}

interface LabPanel {
  readonly definition: LabPanelDefinition;
  readonly anchor: SpatialAnchor;
  readonly surface: SpatialSurface;
}

const LABEL_KEY: Record<SpatialMode, keyof SpatialLabStrings> = {
  summoned: 'labSummoned',
  'head-locked': 'labHeadLocked',
  'world-locked': 'labWorldLocked',
  'world-billboard': 'labBillboard'
};

const PANEL_WIDTH = 0.66;
const PANEL_HEIGHT = 0.52;
const BILLBOARD_FORWARD = 1.5;
const BILLBOARD_RIGHT = 0.9;

const PANELS: LabPanelDefinition[] = [
  {
    mode: 'summoned',
    title: '召唤后锁定',
    body: '打开时出现在视线前方，随后固定在世界中。菜单与对话框的默认模式。',
    distance: 1.3,
    yawOffsetDeg: 0,
    heightOffset: 0.05
  },
  {
    mode: 'head-locked',
    title: '头锁定',
    body: '每帧跟随头部，带阻尼。只用于校准与瞬时提示，禁止长期常驻。',
    distance: 0.8,
    yawOffsetDeg: -28,
    heightOffset: -0.28
  },
  {
    mode: 'world-locked',
    title: '世界锁定',
    body: '固定在世界坐标前方 1.5 米，方位不随头部变化。场景标签与锚点。',
    distance: 1.55,
    yawOffsetDeg: 28,
    heightOffset: 0
  },
  {
    mode: 'world-billboard',
    title: '世界朝向',
    body: '位置固定，仅绕竖直轴转向用户。默认不做俯仰，避免文字变形。',
    distance: 0,
    yawOffsetDeg: 0,
    heightOffset: 0.18
  }
];

/**
 * Operator-only lab that renders the four spatial modes side by side so their
 * behaviour can be compared on device. Each panel is a plain `SpatialAnchor`
 * plus `SpatialSurface`; nothing here is on the patient path.
 */
export function createSpatialLab(options: SpatialLabOptions): SpatialLabApi {
  const { scene, camera, input, strings } = options;
  const theme = options.theme ?? DEFAULT_SPATIAL_THEME;

  const panels: LabPanel[] = [];
  const unregisters: Array<() => void> = [];
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const billboardPosition = new THREE.Vector3();
  const placement = createSpatialPose();
  const cameraHead: HeadPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  let visible = false;
  let needsPlacement = false;
  let lastHead: HeadPose | null = null;

  for (let i = 0; i < PANELS.length; i += 1) {
    const definition = PANELS[i];
    const anchor = new SpatialAnchor({
      mode: definition.mode,
      distance: definition.distance,
      yawOffsetDeg: definition.yawOffsetDeg,
      heightOffset: definition.heightOffset,
      billboard: 'yaw'
    });
    anchor.object.name = `spatial-lab:${definition.mode}`;

    const surface = new SpatialSurface({
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      theme,
      title: strings?.[LABEL_KEY[definition.mode]] ?? definition.title,
      body: definition.body,
      renderOrder: 1100 + i * 10
    });
    anchor.object.add(surface.object);
    anchor.setVisible(false);
    scene.add(anchor.object);

    const panel: LabPanel = { definition, anchor, surface };
    panels.push(panel);

    // Scene-layer gaze gives a subtle "this panel is the target" cue without
    // stealing focus from the menu.
    unregisters.push(
      input.register({
        object: surface.object,
        layer: 'scene',
        enabled: true,
        dwellTime: 0,
        onFocus: (focused: boolean) => {
          anchor.object.scale.setScalar(focused ? 1.03 : 1);
        }
      })
    );
  }

  const readCameraPose = (): HeadPose => {
    camera.updateMatrixWorld();
    camera.getWorldPosition(cameraHead.position);
    camera.getWorldQuaternion(cameraHead.quaternion);
    return cameraHead;
  };

  const placePanel = (panel: LabPanel, head: HeadPose): void => {
    switch (panel.definition.mode) {
      case 'summoned':
      case 'head-locked':
      case 'world-locked':
        // Summoning yields a fixed pose in front of the head; head-locked
        // panels then follow the head from the next update onward.
        panel.anchor.summon(head);
        break;
      case 'world-billboard': {
        forward.set(0, 0, -1).applyQuaternion(head.quaternion);
        right.set(1, 0, 0).applyQuaternion(head.quaternion);
        billboardPosition
          .copy(head.position)
          .addScaledVector(forward, BILLBOARD_FORWARD)
          .addScaledVector(right, BILLBOARD_RIGHT);
        billboardPosition.y += panel.definition.heightOffset;
        computeWorldBillboardPose(
          billboardPosition,
          head,
          { mode: 'world-billboard', billboard: 'yaw' },
          placement
        );
        panel.anchor.setWorldPose(placement.position, placement.quaternion);
        break;
      }
      default:
        break;
    }
    panel.anchor.setVisible(visible);
  };

  const placeAll = (head: HeadPose): void => {
    for (let i = 0; i < panels.length; i += 1) {
      placePanel(panels[i], head);
    }
    needsPlacement = false;
  };

  const api: SpatialLabApi = {
    toggle(head?: HeadPose | null): void {
      visible = !visible;
      const reference = head ?? lastHead;
      if (visible) {
        if (reference) {
          placeAll(reference);
        } else {
          needsPlacement = true;
        }
      }
      for (let i = 0; i < panels.length; i += 1) {
        panels[i].anchor.setVisible(visible);
      }
    },

    close(): void {
      if (!visible) {
        return;
      }
      visible = false;
      for (let i = 0; i < panels.length; i += 1) {
        panels[i].anchor.setVisible(false);
      }
    },

    isOpen(): boolean {
      return visible;
    },

    update(head?: HeadPose | null, dt = 0, now = 0): void {
      const pose = head ?? readCameraPose();
      lastHead = pose;
      if (visible && needsPlacement) {
        placeAll(pose);
      }
      for (let i = 0; i < panels.length; i += 1) {
        panels[i].anchor.update(pose, dt, now);
      }
    },

    dispose(): void {
      for (let i = 0; i < unregisters.length; i += 1) {
        unregisters[i]();
      }
      unregisters.length = 0;
      for (let i = 0; i < panels.length; i += 1) {
        const panel = panels[i];
        scene.remove(panel.anchor.object);
        panel.surface.dispose();
        panel.anchor.dispose();
      }
      panels.length = 0;
      visible = false;
      needsPlacement = false;
      lastHead = null;
    }
  };

  return api;
}
