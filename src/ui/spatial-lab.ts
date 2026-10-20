import * as THREE from 'three';
import { SpatialAnchor } from '../core/spatial/anchor';
import {
  computeSummonedPose,
  computeWorldBillboardPose,
  createSpatialPose
} from '../core/spatial/placement';
import type { SpatialMode } from '../core/spatial/types';
import type { SpatialTheme } from '../core/spatial/theme';
import { DEFAULT_SPATIAL_THEME } from '../core/spatial/theme';
import type { HeadPose } from '../core/xr/types';
import type { SpatialInput } from './spatial/input';
import { SpatialButton } from './spatial/button';
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
  setActive(active: boolean, head?: HeadPose | null): void;
  toggle(head?: HeadPose | null): void;
  close(): void;
  reset(head?: HeadPose | null): void;
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

const PANEL_WIDTH = 0.74;
const PANEL_HEIGHT = 0.58;
const BILLBOARD_FORWARD = 2.2;
const BILLBOARD_RIGHT = 0.9;
const CONTROL_DISTANCE = 1.9;
const CONTROL_HEIGHT_OFFSET = -0.62;

const PANELS: LabPanelDefinition[] = [
  {
    mode: 'summoned',
    title: '召唤后锁定',
    body: '打开时出现在视线前方，随后固定在世界中。菜单与对话框的默认模式。',
    distance: 1.9,
    yawOffsetDeg: 0,
    heightOffset: 0.10
  },
  {
    mode: 'head-locked',
    title: '头锁定',
    body: '每帧跟随头部，带阻尼。只用于校准与瞬时提示，禁止长期常驻。',
    distance: 1.45,
    yawOffsetDeg: 30,
    heightOffset: -0.34
  },
  {
    mode: 'world-locked',
    title: '世界锁定',
    body: '固定在世界坐标前方 2.2 米，方位不随头部变化。场景标签与锚点。',
    distance: 2.2,
    yawOffsetDeg: -38,
    heightOffset: 0.12
  },
  {
    mode: 'world-billboard',
    title: '世界朝向',
    body: '位置固定，仅绕竖直轴转向用户。默认不做俯仰，避免文字变形。',
    distance: 0,
    yawOffsetDeg: 0,
    heightOffset: 0.12
  }
];

/**
 * First-class spatial UI lab. Four mode panels plus a control console.
 * The lab is activated only while the `lab` scene is visible; the environment
 * itself lives in `src/scenes/lab`.
 */
export function createSpatialLab(options: SpatialLabOptions): SpatialLabApi {
  const { scene, camera, input, strings } = options;
  const theme = options.theme ?? DEFAULT_SPATIAL_THEME;

  const panels: LabPanel[] = [];
  const gazeUnregisters: Array<() => void> = [];
  const buttonUnregisters: Array<() => void> = [];
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const billboardPosition = new THREE.Vector3();
  const placement = createSpatialPose();
  const cameraHead: HeadPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  let visible = false;
  let demoVisible = true;
  let needsPlacement = false;
  let buttonsRegistered = false;
  let lastHead: HeadPose | null = null;
  let toggleButton: SpatialButton | null = null;

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
    // stealing focus from the control console or the menu.
    gazeUnregisters.push(
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

  const controlAnchor = new SpatialAnchor({ mode: 'world-locked' });
  controlAnchor.object.name = 'spatial-lab:control';
  controlAnchor.setVisible(false);
  scene.add(controlAnchor.object);

  const controlSurface = new SpatialSurface({
    width: 0.9,
    height: 0.5,
    theme,
    title: '空间实验',
    renderOrder: 1120
  });
  controlAnchor.object.add(controlSurface.object);

  const layoutButton = controlSurface.addButton('重新布置', () => {
    demoVisible = true;
    if (toggleButton) {
      toggleButton.setLabel('隐藏面板');
    }
    const reference = lastHead ?? readCameraPose();
    placeAll(reference);
    updateVisibility();
  }, 0);

  toggleButton = controlSurface.addButton('隐藏面板', () => {
    demoVisible = !demoVisible;
    toggleButton?.setLabel(demoVisible ? '隐藏面板' : '显示面板');
    updateVisibility();
  }, 0);

  const readCameraPose = (): HeadPose => {
    camera.updateMatrixWorld();
    camera.getWorldPosition(cameraHead.position);
    camera.getWorldQuaternion(cameraHead.quaternion);
    return cameraHead;
  };

  const updateVisibility = (): void => {
    for (let i = 0; i < panels.length; i += 1) {
      panels[i].anchor.setVisible(visible && demoVisible);
    }
    controlAnchor.setVisible(visible);
  };

  const placePanel = (panel: LabPanel, head: HeadPose): void => {
    switch (panel.definition.mode) {
      case 'summoned':
      case 'head-locked':
      case 'world-locked':
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
    panel.anchor.setVisible(visible && demoVisible);
  };

  const placeAll = (head: HeadPose): void => {
    for (let i = 0; i < panels.length; i += 1) {
      placePanel(panels[i], head);
    }
    computeSummonedPose(
      head,
      {
        mode: 'summoned',
        distance: CONTROL_DISTANCE,
        heightOffset: CONTROL_HEIGHT_OFFSET,
        minPitchDeg: -12,
        maxPitchDeg: 28
      },
      placement
    );
    controlAnchor.setWorldPose(placement.position, placement.quaternion);
    controlAnchor.setVisible(visible);
    needsPlacement = false;
  };

  const registerButtons = (): void => {
    if (buttonsRegistered) {
      return;
    }
    buttonUnregisters.push(input.register(layoutButton.interactable));
    if (toggleButton) {
      buttonUnregisters.push(input.register(toggleButton.interactable));
    }
    buttonsRegistered = true;
  };

  const unregisterButtons = (): void => {
    for (let i = 0; i < buttonUnregisters.length; i += 1) {
      buttonUnregisters[i]();
    }
    buttonUnregisters.length = 0;
    buttonsRegistered = false;
  };

  const api: SpatialLabApi = {
    setActive(active: boolean, head?: HeadPose | null): void {
      if (active === visible) {
        if (active && head) {
          placeAll(head);
        }
        return;
      }
      visible = active;
      if (active) {
        demoVisible = true;
        toggleButton?.setLabel('隐藏面板');
        registerButtons();
        const reference = head ?? lastHead;
        if (reference) {
          placeAll(reference);
        } else {
          needsPlacement = true;
        }
      } else {
        unregisterButtons();
        needsPlacement = false;
      }
      updateVisibility();
    },

    toggle(head?: HeadPose | null): void {
      api.setActive(!visible, head);
    },

    close(): void {
      api.setActive(false);
    },

    reset(head?: HeadPose | null): void {
      demoVisible = true;
      toggleButton?.setLabel('隐藏面板');
      placeAll(head ?? lastHead ?? readCameraPose());
      updateVisibility();
    },

    isOpen(): boolean {
      return visible;
    },

    update(head?: HeadPose | null, dt = 0, now = 0): void {
      if (!visible) {
        return;
      }
      const pose = head ?? readCameraPose();
      lastHead = pose;
      if (needsPlacement) {
        placeAll(pose);
      }
      for (let i = 0; i < panels.length; i += 1) {
        panels[i].anchor.update(pose, dt, now);
      }
      controlAnchor.update(pose, dt, now);
    },

    dispose(): void {
      for (let i = 0; i < gazeUnregisters.length; i += 1) {
        gazeUnregisters[i]();
      }
      gazeUnregisters.length = 0;
      unregisterButtons();
      for (let i = 0; i < panels.length; i += 1) {
        const panel = panels[i];
        scene.remove(panel.anchor.object);
        panel.surface.dispose();
        panel.anchor.dispose();
      }
      panels.length = 0;
      scene.remove(controlAnchor.object);
      controlSurface.dispose();
      controlAnchor.dispose();
      visible = false;
      needsPlacement = false;
      lastHead = null;
      toggleButton = null;
    }
  };

  return api;
}
