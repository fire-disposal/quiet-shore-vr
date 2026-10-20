import * as THREE from 'three';
import type { SpatialTheme } from '../core/spatial/theme';
import { DEFAULT_SPATIAL_THEME } from '../core/spatial/theme';
import type { HeadPose } from '../core/xr/types';
import { SpatialAnchor } from '../core/spatial/anchor';
import { SpatialSurface } from './spatial/surface';
import type { SpatialInput } from './spatial/input';

export type XrMenuAction = 'continue' | 'recalibrate' | 'audio' | 'exit';

/** Structural subset of the app `Strings` table; extra fields are ignored. */
export interface XrMenuStrings {
  menuTitle: string;
  menuContinue: string;
  menuRecalibrate: string;
  menuAudio: string;
  audioOn: string;
  audioOff: string;
  menuExit: string;
}

export interface XrMenuOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  input: SpatialInput;
  strings: XrMenuStrings;
  theme?: SpatialTheme;
  /** Invoked after the menu's own bookkeeping (closing, label swap). */
  onAction?: (action: XrMenuAction) => void;
}

export interface XrMenuApi {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** `true` opens the menu, `false` closes it. */
  setActive(active: boolean): void;
  /** Session binding facade; the menu itself is session-agnostic. */
  attach(session: XRSession | null): void;
  update(head?: HeadPose | null, dt?: number, now?: number): void;
  /** Re-labels the audio row; the app owns the actual audio state. */
  setAudioEnabled(enabled: boolean): void;
  dispose(): void;
}

const MENU_WIDTH = 0.9;
const MENU_HEIGHT = 0.8;
const SUMMON_DISTANCE = 1.25;
const MIN_PITCH_DEG = -12;
const MAX_PITCH_DEG = 28;
const BUTTON_DWELL = 0;

/**
 * Summoned, world-locked menu: it appears in front of the eyes once, then
 * stays put so the user can look away and come back without it following.
 * Buttons use the confirmation key (dwellTime 0); gaze only moves focus.
 */
export function createXrMenu(options: XrMenuOptions): XrMenuApi {
  const { scene, camera, input, strings } = options;
  const theme = options.theme ?? DEFAULT_SPATIAL_THEME;

  const anchor = new SpatialAnchor({
    mode: 'summoned',
    distance: SUMMON_DISTANCE,
    minPitchDeg: MIN_PITCH_DEG,
    maxPitchDeg: MAX_PITCH_DEG
  });
  anchor.object.name = 'quiet-shore-xr-menu';
  anchor.object.visible = false;

  const surface = new SpatialSurface({
    width: MENU_WIDTH,
    height: MENU_HEIGHT,
    theme,
    title: strings.menuTitle,
    renderOrder: 1000
  });
  anchor.object.add(surface.object);
  scene.add(anchor.object);

  const unregisters: Array<() => void> = [];
  const cameraHead: HeadPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  const latestHead: HeadPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  let hasLatestHead = false;
  let open = false;
  let savedUiLayer = true;
  let savedSceneLayer = true;
  let attachedSession: XRSession | null = null;

  const cameraPose = (): HeadPose => {
    camera.updateMatrixWorld();
    camera.getWorldPosition(cameraHead.position);
    camera.getWorldQuaternion(cameraHead.quaternion);
    return cameraHead;
  };

  /** Latest known head pose, falling back to the camera (2D preview). */
  const currentHead = (): HeadPose => {
    if (!hasLatestHead) {
      return cameraPose();
    }
    cameraHead.position.copy(latestHead.position);
    cameraHead.quaternion.copy(latestHead.quaternion);
    return cameraHead;
  };

  const dispatch = (action: XrMenuAction): void => {
    if (action === 'continue' || action === 'exit') {
      api.close();
    }
    options.onAction?.(action);
  };

  const continueButton = surface.addButton(
    strings.menuContinue, () => dispatch('continue'), BUTTON_DWELL);
  const recalibrateButton = surface.addButton(
    strings.menuRecalibrate, () => dispatch('recalibrate'), BUTTON_DWELL);
  const audioButton = surface.addButton(
    strings.menuAudio, () => dispatch('audio'), BUTTON_DWELL);
  const exitButton = surface.addButton(
    strings.menuExit, () => dispatch('exit'), BUTTON_DWELL);
  const buttons = [continueButton, recalibrateButton, audioButton, exitButton];

  const registerButtons = (): void => {
    if (unregisters.length > 0) {
      return;
    }
    for (let i = 0; i < buttons.length; i += 1) {
      unregisters.push(input.register(buttons[i].interactable));
    }
  };

  const unregisterButtons = (): void => {
    for (let i = 0; i < unregisters.length; i += 1) {
      unregisters[i]();
    }
    unregisters.length = 0;
  };

  const api: XrMenuApi = {
    open(): void {
      if (open) {
        return;
      }
      const layers = input.getLayers();
      savedUiLayer = layers.ui;
      savedSceneLayer = layers.scene;
      open = true;
      anchor.summon(currentHead());
      anchor.setVisible(true);
      // The menu takes over the gaze: scene targets must stop competing.
      input.setLayers(true, false);
      registerButtons();
    },

    close(): void {
      if (!open) {
        return;
      }
      open = false;
      unregisterButtons();
      anchor.setVisible(false);
      input.setLayers(savedUiLayer, savedSceneLayer);
    },

    toggle(): void {
      if (open) {
        api.close();
      } else {
        api.open();
      }
    },

    isOpen(): boolean {
      return open;
    },

    setActive(active: boolean): void {
      if (active) {
        api.open();
      } else {
        api.close();
      }
    },

    attach(session: XRSession | null): void {
      const wasAttached = attachedSession !== null;
      attachedSession = session;
      // Leaving XR must not leave the panel stranded in the 2D preview.
      if (wasAttached && session === null) {
        api.close();
      }
    },

    update(head?: HeadPose | null, dt = 0, now = 0): void {
      if (head) {
        latestHead.position.copy(head.position);
        latestHead.quaternion.copy(head.quaternion);
        hasLatestHead = true;
      }
      if (!open) {
        return;
      }
      anchor.update(head ?? cameraPose(), dt, now);
    },

    setAudioEnabled(enabled: boolean): void {
      audioButton.setLabel(enabled ? strings.audioOn : strings.audioOff);
    },

    dispose(): void {
      unregisterButtons();
      open = false;
      attachedSession = null;
      scene.remove(anchor.object);
      surface.dispose();
      anchor.dispose();
    }
  };

  return api;
}
