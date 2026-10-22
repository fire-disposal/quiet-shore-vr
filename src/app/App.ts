import * as THREE from 'three';
import { EYE_HEIGHT_MAX, EYE_HEIGHT_MIN, readConfig, type AppConfig } from './config';
import { createRenderer, type Quality } from '../core/xr/renderer';
import { readHeadPose } from '../core/xr/pose';
import { SitUpPath, type CameraPose } from '../core/xr/situp-path';
import { createSitUpMotion } from '../core/xr/situp-run';
import {
  createComfort,
  POSTURE_LIMITS,
  type ComfortApi
} from '../core/xr/comfort';
import type { RemapResult } from '../core/xr/remap';
import type { HeadPose, XRManagerLike } from '../core/xr/types';
import { SceneHost } from '../core/scene/host';
import type { SceneHandle } from '../core/scene/contract';
import { getSceneDefinition } from '../scenes/registry';
import { FramePipeline } from '../core/geometry/pipeline';
import { SpatialInput } from '../ui/spatial/input';
import { DEFAULT_SPATIAL_THEME } from '../core/spatial/theme';
import { Calibration } from '../ui/calibration';
import { StartScreen } from '../ui/start-screen';
import { SpatialHud } from '../ui/spatial-hud';
import {
  normalizeSceneId,
  readStoredScene,
  storeScene,
  type SceneId
} from '../ui/scene-select';
import { getStrings, type Strings } from '../ui/strings';
import {
  disposeAudio,
  playSceneAudio,
  preloadSceneAudio,
  setAudioMuted,
  stopAudio,
  toggleMuted,
  unlockAudio
} from '../audio/audio';
import { createPostureCue } from '../core/xr/posture-cue';
import type { PostureCueApi } from '../core/xr/posture-cue';
import { RenderMonitor } from '../core/performance/render-monitor';
import { readStoredShowPerf, storeShowPerf } from './preferences';
import { PortalLink, stateFromSnapshot } from './portal-link';
import { createWorldShell, type WorldShellApi } from '../core/xr/world-shell';
import {
  createViewMotionController,
  presetCode,
  viewToWorld,
  type ViewMotionControllerApi
} from '../core/xr/view-motion';
import { SceneSnapshot, type SceneSnapshotInput } from '../core/scene/snapshot';
import { parseViewAnim, parseViewOrient } from './view-command';

const MAX_DT = 0.25;
// Sit-up performance: the confirm key toggles between the supine frame and
// the standing frame. 6 s keeps the turn decisive; the flow cue carries the
// perceived rise, the rotation only sets which way is up.
const SITUP_DURATION_MS = 6000;
/** Rotation rate that maps to full cue flow while rising. */
const CUE_FULL_DEG_PER_S = 40;
/** Floor of the cue flow during a rising transition, so motion starts at once. */
const CUE_IDLE_FLOW = 0.25;
// Strict wire forms: no sign, exponent, padding or spaces; reject, never coerce.
const EYE_HEIGHT_ARG = /^1\.\d{1,3}$/;

export class QuietShoreApp {
  private readonly config: AppConfig;
  private readonly strings: Strings;
  private readonly start: StartScreen;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly xr: XRManagerLike;
  private readonly scene = new THREE.Scene();
  private readonly pipeline = new FramePipeline();
  private readonly host: SceneHost;
  private readonly input: SpatialInput;
  private readonly hud: SpatialHud;
  private readonly link: PortalLink;
  private linkOnline = false;
  private readonly renderMonitor = new RenderMonitor();
  private readonly headEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly worldQuat = new THREE.Quaternion();
  private readonly worldEuler = new THREE.Euler(0, 0, 0, 'XYZ');
  private readonly viewMotion: ViewMotionControllerApi;
  private readonly snapshot = new SceneSnapshot();
  private readonly snapshotInput: SceneSnapshotInput = {
    sceneId: '',
    loaded: false,
    session: false,
    calibrating: false,
    calibrated: false,
    audioMuted: false,
    eyeHeight: 0,
    worldYawDeg: 0,
    worldPitchDeg: 0,
    worldRollDeg: 0,
    confidence: 0,
    sitUp: null,
    sitUpT: 0,
    sitUpTarget: 0,
    sitUpMoving: false,
    posture: null,
    baseQuaternion: new THREE.Quaternion(),
    baseReferenceQuaternion: new THREE.Quaternion(),
    lookYawDeg: 0,
    lookYawTargetDeg: 0,
    upGazeDeg: 0,
    upGazeTargetDeg: 0,
    viewAnim: 'idle',
    viewPreset: 'none',
    floorOffset: 0,
    cueFlow: 0,
    cueEnabled: false,
    cueIntensity: 0
  };
  private controlMode = false;

  private eyeHeight: number;
  private cueFlow = 0;

  private sceneId: SceneId;
  private handle: SceneHandle | null = null;
  private comfort: ComfortApi | null = null;
  private shell: WorldShellApi | null = null;
  private calibration: Calibration | null = null;
  private postureCueState: PostureCueApi | null = null;
  private sitUpPath: SitUpPath | null = null;
  private sitUpReference: CameraPose | null = null;
  /** Base rotation the sit-up starts from; telemetry measures against it. */
  private readonly sitUpBase0 = new THREE.Quaternion();
  private readonly calibrationFrame = new THREE.Quaternion();
  private readonly identityQuaternion = new THREE.Quaternion();
  private sitUpMode = false;
  private sitUpReady = false;
  private readonly sitUpMotion = createSitUpMotion({ durationMs: SITUP_DURATION_MS });
  private session: XRSession | null = null;
  private previewing = false;
  private savedBackground: THREE.Scene['background'] = null;
  private headPose: HeadPose = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion()
  };
  private selectableOffs: Array<() => void> = [];
  private focusedSelectable: THREE.Object3D | null = null;
  private flashTimers = new Set<number>();
  private selectEndHandled = false;
  private selectCount = 0;
  private showPerf: boolean;
  private audioMuted = false;
  private lastFrame = 0;
  private elapsed = 0;
  private frames = 0;
  private fps = 0;
  private fpsAt = 0;
  private hudAt = 0;
  private started = false;
  private enterPending = false;
  private patientStopped = false;

  constructor() {
    this.config = readConfig(window.location.search);
    this.eyeHeight = this.config.eyeHeight;
    this.strings = getStrings(this.config.lang);
    this.showPerf = this.config.showPerf || readStoredShowPerf();
    this.sceneId = this.config.initialScene ?? readStoredScene() ?? 'landscape';

    this.start = new StartScreen(this.strings, {
      onEnter: () => void this.enterVR(),
      onShowPerfChange: (enabled) => {
        this.showPerf = enabled;
        storeShowPerf(enabled);
        this.start.setShowPerf(enabled);
        this.updateHud(performance.now());
      }
    });
    this.start.setShowPerf(this.showPerf);

    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.05,
      500
    );
    this.camera.position.set(0, this.eyeHeight, 3.2);
    this.camera.rotation.order = 'YXZ';

    const quality: Quality = {
      high: this.config.highQuality,
      aa: this.config.aa,
      xrScale: this.config.xrScale
    };
    this.renderer = createRenderer(this.start.stageElement, quality);
    // WebXRManager's public surface differs across Three typings; the narrow
    // interface is the only part this app uses.
    this.xr = this.renderer.xr as unknown as XRManagerLike;

    this.host = new SceneHost(this.scene);
    this.input = new SpatialInput(
      this.camera,
      this.scene,
      DEFAULT_SPATIAL_THEME,
      this.strings.dwellHint
    );
    this.hud = new SpatialHud(this.scene, DEFAULT_SPATIAL_THEME);
    // One socket carries commands in and state/telemetry out; there is no
    // second transport to keep in sync.
    this.link = new PortalLink(
      (command) => this.handleRemoteCommand(command),
      (active) => this.setControlMode(active),
      () => {
        this.headEuler.setFromQuaternion(this.headPose.quaternion, 'YXZ');
        return {
          x: this.headPose.position.x,
          y: this.headPose.position.y,
          z: this.headPose.position.z,
          yaw: this.headEuler.y,
          pitch: this.headEuler.x
        };
      },
      // One collected snapshot feeds the state payload; no caller re-derives
      // posture or view numbers.
      () => stateFromSnapshot(this.captureSnapshot()),
      // The state payload carries no motion flag; the sit-up performance is
      // the only motion source that has to be reported from outside it.
      () => this.sitUpMotion.moving,
      (status) => this.handleLinkStatus(status)
    );
    // View motion is a system capability: it owns the orientation, presets,
    // hold and reset. The sink adapter is the only place the patient-centric
    // angles become a world rotation, and it targets whichever shell is bound.
    this.viewMotion = createViewMotionController({
      sink: {
        setOrientation: (lookYawDeg: number, upGazeDeg: number) =>
          this.shell?.setWorldRotation(viewToWorld(lookYawDeg, upGazeDeg))
      }
    });

    this.pipeline.add({
      id: 'scene-update',
      phase: 'simulation',
      order: 0,
      run: (dt: number) => {
        this.handle?.update(dt, this.elapsed);
        if (this.config.spin && this.focusedSelectable) {
          this.focusedSelectable.rotation.y += dt * 1.6;
        }
      }
    });
    this.pipeline.add({
      id: 'spatial-layout',
      phase: 'layout',
      order: 0,
      run: (dt: number, now: number) => {
        this.hud.setVisible(
          this.showPerf && !this.controlMode && (this.xr.isPresenting || this.previewing)
        );
        this.hud.update(this.headPose, dt, now);
        this.calibration?.update(dt, now, this.headPose);
      }
    });
    this.pipeline.add({
      id: 'world-motion',
      phase: 'render',
      order: 0,
      run: (dt: number, now: number) => {
        // The sit-up performance supersedes the calibrated comfort frame; only
        // one of them may write the world shell's base layer.
        if (this.sitUpMode) {
          this.updateSitUp(dt);
        } else {
          this.comfort?.updatePosture(dt);
        }
        this.cueFlow = this.computeCueFlow();
        this.postureCueState?.update(dt, this.headPose.position, this.cueFlow);
        this.input.update(dt, now, this.headPose);
      }
    });
    this.pipeline.add({
      id: 'view-motion',
      phase: 'render',
      order: 1,
      // Easing lives in the controller; the shell only composes transforms.
      run: (dt: number) => {
        this.viewMotion.update(dt);
        this.shell?.update(this.headPose.position);
      }
    });
    this.pipeline.add({
      id: 'render',
      phase: 'render',
      order: 10,
      run: () => {
        this.renderer.render(this.scene, this.camera);
      }
    });

    this.loadScene(this.sceneId);
    this.start.setScene(this.sceneName(this.sceneId));
    this.bind();
    this.start.setStatus(this.strings.checking);
    this.updateHud(performance.now());
  }

  run(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.lastFrame = 0;
    this.link.start();
    void this.detectXR();
  }

  private bind(): void {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    const canvas = this.renderer.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let yaw = 0;
    let pitch = 0;

    canvas.addEventListener('pointerdown', (event) => {
      if (this.xr.isPresenting) {
        return;
      }
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!dragging || this.xr.isPresenting) {
        return;
      }
      yaw -= (event.clientX - lastX) * 0.005;
      pitch -= (event.clientY - lastY) * 0.005;
      pitch = Math.max(-1.2, Math.min(1.2, pitch));
      lastX = event.clientX;
      lastY = event.clientY;
      this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    });
    window.addEventListener('pointerup', () => {
      dragging = false;
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        this.onSelectShort();
      }
    });
  }

  private loadScene(id: SceneId): void {
    const definition = getSceneDefinition(id);
    if (!definition) {
      throw new Error(`unknown scene: ${id}`);
    }

    this.disposeScene();
    const handle = this.host.load(definition, {
      quality: this.config.highQuality ? 'high' : 'low',
      eyeHeight: this.eyeHeight
    });
    this.handle = handle;
    // World shell order: view pitch -> base (comfort/sit-up) -> content
    // (floor). Wrapping the host's content group, not the scene root, keeps the
    // floor offset on content and survives both rotations.
    this.comfort = createComfort({ scene: this.scene, world: this.host.content });
    this.shell = createWorldShell({ scene: this.scene, base: this.comfort.group });
    // Rebind, do not re-animate: the controller keeps its angles and state.
    this.shell.setWorldRotation(
      viewToWorld(this.viewMotion.getLookYawDeg(), this.viewMotion.getUpGazeDeg())
    );
    this.disposePostureCue();
    // The cue lives in world space and follows the head, so it is independent
    // of the scene art and of every world rotation: install it everywhere.
    this.postureCueState = createPostureCue({ scene: this.scene });
    this.calibration = new Calibration({
      scene: this.scene,
      comfort: this.comfort,
      strings: this.strings,
      theme: DEFAULT_SPATIAL_THEME,
      onResult: (result) => this.onCalibrationResult(result)
    });
    this.sitUpPath = null;
    this.sitUpReference = null;
    this.sitUpMode = false;
    this.sitUpReady = false;
    this.sitUpMotion.reset();
    this.registerSelectables(handle.selectables);
    this.host.setFloorOffset(this.session ? -this.eyeHeight : 0);
    this.savedBackground = this.scene.background;
    preloadSceneAudio(definition.audio);
    this.sceneId = id;
    storeScene(id);
    this.start.setScene(this.sceneName(id));
  }

  private disposePostureCue(): void {
    this.postureCueState?.dispose();
    this.postureCueState = null;
  }

  private disposeScene(): void {
    this.disposePostureCue();
    this.unregisterSelectables();
    this.calibration?.dispose();
    this.calibration = null;
    if (this.comfort) {
      // Unwrap the shell first: it re-hangs the base group on the scene.
      this.shell?.dispose();
      this.shell = null;
      this.comfort.reset();
      this.scene.remove(this.comfort.group);
      this.comfort.group.remove(this.host.content);
      this.scene.add(this.host.content);
      this.host.setFloorOffset(0);
      this.comfort = null;
    }
    this.host.unload();
    this.handle = null;
    for (const timer of this.flashTimers) {
      window.clearTimeout(timer);
    }
    this.flashTimers.clear();
  }

  private registerSelectables(objects: readonly THREE.Object3D[]): void {
    for (let i = 0; i < objects.length; i += 1) {
      const object = objects[i];
      const off = this.input.register({
        object,
        layer: 'scene',
        dwellTime: 6,
        onFocus: (focused: boolean) => {
          if (focused) {
            this.focusedSelectable = object;
          } else if (this.focusedSelectable === object) {
            this.focusedSelectable = null;
          }
        },
        onSelect: () => this.flash(object)
      });
      this.selectableOffs.push(off);
    }
  }

  private unregisterSelectables(): void {
    for (let i = 0; i < this.selectableOffs.length; i += 1) {
      this.selectableOffs[i]();
    }
    this.selectableOffs = [];
    this.focusedSelectable = null;
  }

  private flash(object: THREE.Object3D): void {
    this.selectCount += 1;
    const scale = object.scale.x;
    object.scale.setScalar(scale * 1.12);
    const timer = window.setTimeout(() => {
      object.scale.setScalar(scale);
      this.flashTimers.delete(timer);
    }, 180);
    this.flashTimers.add(timer);
  }

  private sceneName(id: string): string {
    return getSceneDefinition(id)?.name[this.config.lang] ?? id;
  }

  private async detectXR(): Promise<void> {
    if (!navigator.xr) {
      this.start.setStatus(this.strings.noXR, 'error');
      this.start.setEnterEnabled(false);
      return;
    }
    try {
      const supported = await navigator.xr.isSessionSupported('immersive-vr');
      this.start.setEnterEnabled(supported);
      if (supported) {
        this.start.setStatus('');
      } else {
        this.start.setStatus(this.strings.xrUnsupported, 'error');
      }
    } catch {
      this.start.setStatus(this.strings.xrFailed, 'error');
      this.start.setEnterEnabled(false);
    }
  }

  private async enterVR(): Promise<void> {
    if (this.session || this.enterPending) {
      return;
    }
    if (!navigator.xr) {
      this.start.setStatus(this.strings.noXR, 'error');
      return;
    }
    this.enterPending = true;
    this.start.setEnterBusy(true);
    this.start.setStatus(this.strings.entering);
    void unlockAudio();
    try {
      // Do not await a paint here: requestSession must stay in the same
      // transient user-activation window as the right-side confirm click.
      this.patientStopped = false;
      const next = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor']
      });
      this.session = next;
      await this.xr.setSession(next);
      this.lastFrame = 0;
      this.renderer.setAnimationLoop(this.onFrame);
      next.addEventListener('end', () => this.onSessionEnd());
      next.addEventListener('selectstart', () => this.onSelectStart());
      next.addEventListener('selectend', () => this.onSelectEnd());
      next.addEventListener('select', () => this.onSelectFallback());

      this.start.showStage();
      this.start.setEnterEnabled(false);
      this.host.setFloorOffset(-this.eyeHeight);
      if (this.controlMode) {
        this.input.setLayers(false, false);
      }
      this.input.setLayers(true, true);
      this.start.setStatus('');

      if (this.config.skipCalibration) {
        if (this.handle) {
          this.handle.root.visible = true;
        }
        this.comfort?.reset();
        this.startSceneAudio();
        this.start.setStatus(this.strings.skippedCalibration, 'ok');
      } else {
        this.beginCalibration();
      }
      this.updateHud(performance.now());
    } catch (error) {
      this.session = null;
      this.start.setStatus(
        `${this.strings.enterFailed}：${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    } finally {
      this.enterPending = false;
      this.start.setEnterBusy(false);
    }
  }

  private onSessionEnd(): void {
    this.session = null;
    // A patient stop freezes first, then the end-of-session reset zeroes the
    // pitch: stop never eases and never recenters on its own.
    if (this.patientStopped) {
      this.viewMotion.stop();
    }
    this.viewMotion.reset();
    this.sitUpMode = false;
    this.sitUpReady = false;
    this.sitUpPath = null;
    this.sitUpReference = null;
    this.sitUpMotion.reset();
    this.sitUpBase0.identity();
    this.stopSceneAudio();
    this.calibration?.stop();
    this.scene.background = this.savedBackground;
    if (this.handle) {
      this.handle.root.visible = true;
    }
    this.host.setFloorOffset(0);
    this.comfort?.reset();
    // Drop the sit-up base pose so the reset comfort frame is what remains.
    this.shell?.setBasePose(null);
    this.shell?.update(this.headPose.position);
    this.postureCueState?.update(0, this.headPose.position, 0);
    this.renderer.setAnimationLoop(null);
    this.start.showStart();
    this.start.setEnterEnabled(true);
    this.input.setLayers(true, true);
    this.start.setStatus(
      this.patientStopped ? this.strings.patientStop : this.strings.sessionEnded
    );
    this.patientStopped = false;
    this.link.sendStateNow();
    this.updateHud(performance.now());
  }

  private beginCalibration(): void {
    if (!this.calibration || !this.handle) {
      return;
    }
    // Calibration owns the world frame until the patient confirms the sit-up.
    this.sitUpMode = false;
    this.sitUpReady = false;
    this.sitUpPath = null;
    this.sitUpReference = null;
    this.sitUpMotion.reset();
    this.sitUpBase0.identity();
    // Calibration starts level: the operator's pitch correction is dropped and
    // the sit-up base pose is released so comfort owns the world again.
    this.viewMotion.reset();
    this.shell?.setBasePose(null);
    // A running posture transition must not keep advancing through the
    // capture. setPosture supersedes it and heads for neutral; the API's
    // 1 s floor runs while the scene is hidden.
    this.comfort?.setPosture(
      { worldPitchDeg: 0, worldRollDeg: 0, riseM: 0 },
      POSTURE_LIMITS.minDurationMs
    );
    this.savedBackground = this.scene.background;
    this.scene.background = new THREE.Color(0x000000);
    this.handle.root.visible = false;
    this.input.setLayers(false, false);
    this.calibration.start();
    this.link.sendStateNow();
    this.updateHud(performance.now());
  }

  private onCalibrationResult(result: RemapResult): void {
    this.scene.background = this.savedBackground;
    if (this.handle) {
      this.handle.root.visible = true;
    }
    this.input.setLayers(!this.controlMode, this.session !== null && !this.controlMode);
    if (result.ok) {
      // Start supine and let the patient press the confirm key to rise. The
      // sit-up path owns the world base while it is active; comfort.q0 stays
      // the fallback frame when the animation is reset.
      this.sitUpPath = new SitUpPath({ standEyeHeight: this.eyeHeight });
      this.sitUpReference = {
        position: this.headPose.position.clone(),
        quaternion: this.headPose.quaternion.clone()
      };
      this.sitUpMotion.reset();
      this.sitUpMode = true;
      this.sitUpReady = true;
      this.sitUpBase0.copy(
        this.sitUpPath.worldFor(this.sitUpReference, this.sitUpPath.at(0)).quaternion
      );
      this.host.setFloorOffset(0);
      this.applySitUpTransform();
    }
    if (this.session) {
      this.startSceneAudio();
    }
    this.start.setStatus(
      result.ok ? this.strings.calibrationDone : `${this.strings.calibrationFailed}：${result.reason ?? 'unknown'}`,
      result.ok ? 'ok' : 'error'
    );
    this.link.sendStateNow();
    this.updateHud(performance.now());
  }

  private startPreview(): void {
    if (this.session) {
      return;
    }
    this.previewing = true;
    void unlockAudio();
    this.startSceneAudio();
    this.start.showStage();
    if (this.handle) {
      this.handle.root.visible = true;
    }
    this.host.setFloorOffset(0);
    this.input.setLayers(true, true);
    this.lastFrame = 0;
    this.renderer.setAnimationLoop(this.onFrame);
    this.start.setStatus(this.strings.modePreview);
    this.updateHud(performance.now());
  }

  private exitAll(): void {
    if (this.session) {
      void this.session.end();
      return;
    }
    this.previewing = false;
    this.stopSceneAudio();
    this.host.setFloorOffset(0);
    this.renderer.setAnimationLoop(null);
    this.start.showStart();
    this.start.setStatus(this.strings.modeIdle);
    this.updateHud(performance.now());
  }

  private recalibrate(): void {
    if (!this.session || !this.xr.isPresenting) {
      this.start.setStatus(this.strings.recalibrateNeedsSession, 'error');
      return;
    }
    if (this.calibration?.isActive()) {
      return;
    }
    this.beginCalibration();
  }

  private switchScene(nextId: SceneId): void {
    const normalized = normalizeSceneId(nextId);
    if (!normalized) {
      return;
    }
    if (this.session) {
      this.start.setStatus(this.strings.sceneSwitchBlocked, 'error');
      this.start.setScene(this.sceneName(this.sceneId));
      return;
    }
    if (normalized === this.sceneId && this.handle) {
      storeScene(this.sceneId);
      this.start.setScene(this.sceneName(this.sceneId));
      // Re-selecting the current scene is still an accepted command; the link
      // refreshes the tablet readback for it.
      return;
    }
    this.loadScene(normalized);
    if (this.previewing) {
      this.startSceneAudio();
      this.start.showStage();
    }
    this.start.setStatus(
      `${this.strings.sceneSelectedStatus}${getSceneDefinition(normalized)?.name[this.config.lang] ?? normalized}`
    );
    this.link.sendStateNow();
  }

  private handleRemoteCommand(raw: string): void {
    const command = raw.trim().toLowerCase();
    if (!command) {
      return;
    }
    if (command.startsWith('scene:')) {
      this.switchScene(command.slice('scene:'.length) as SceneId);
      return;
    }
    if (command.startsWith('settings:eyeheight:')) {
      this.applyEyeHeightCommand(command.slice('settings:eyeheight:'.length));
      return;
    }
    if (command.startsWith('view:orient:')) {
      this.applyViewOrientation(command.slice('view:orient:'.length));
      return;
    }
    if (command.startsWith('view:anim:')) {
      this.playViewAnim(command.slice('view:anim:'.length));
      return;
    }
    if (command === 'view:stop') {
      // Hold, never recenter: only `view:anim:recenter` returns to 0°.
      this.viewMotion.stop();
      this.start.setStatus('已保持当前视角', 'ok');
      return;
    }
    if (command.startsWith('cue:intensity:')) {
      const value = Number(command.substring('cue:intensity:'.length));
      if (Number.isFinite(value) && value >= 0 && value <= 1) {
        this.postureCueState?.setIntensity(value);
      }
      return;
    }
    switch (command) {
      case 'preview':
        this.startPreview();
        return;
      case 'calibrate':
        this.recalibrate();
        return;
      case 'exit':
      case 'stop':
        this.exitAll();
        return;
      case 'audio:on':
        this.applyAudioMuted(false);
        return;
      case 'audio:off':
        this.applyAudioMuted(true);
        return;
      case 'audio:toggle':
        this.toggleAudio();
        return;
      case 'posture:rise':
        this.setVirtualPosture(true);
        return;
      case 'posture:lower':
        this.setVirtualPosture(false);
        return;
      case 'posture:stop':
        if (this.calibration?.isActive()) {
          // Calibration already drives posture to neutral; do not freeze it.
          return;
        }
        this.stopSitUp();
        return;
      case 'cue:on':
        this.postureCueState?.setEnabled(true);
        return;
      case 'cue:off':
        this.postureCueState?.setEnabled(false);
        return;
      case 'status':
        // The link refreshes the readback after every discrete command, so a
        // newly claiming controller is never left with a stale snapshot.
        return;
      case 'start':
        this.start.setStatus(this.strings.remoteStartNeedsGesture, 'ok');
        return;
      default:
        this.start.setStatus(`${this.strings.remoteUnknown}: ${raw}`, 'error');
    }
  }

  /** `settings:eyeheight:<m>`: strict 1.2–1.9 decimal, no scene rebuild. */
  private applyEyeHeightCommand(raw: string): void {
    // Resent values must be rejected whole, never clamped into range.
    if (!EYE_HEIGHT_ARG.test(raw)) {
      this.start.setStatus(`视点高度无效：${raw}`, 'error');
      return;
    }
    const next = Number(raw);
    if (!Number.isFinite(next) || next < EYE_HEIGHT_MIN || next > EYE_HEIGHT_MAX) {
      this.start.setStatus(`视点高度无效：${raw}`, 'error');
      return;
    }
    if (this.calibration?.isActive()) {
      this.start.setStatus('校准中无法调整视点高度', 'error');
      return;
    }
    this.eyeHeight = next;
    // In XR the headset owns camera height; moving the content floor keeps the
    // world under the patient's physical floor without rebuilding the scene.
    if (!this.xr.isPresenting) {
      this.camera.position.y = next;
    }
    if (this.session) {
      this.host.setFloorOffset(this.sitUpMode ? 0 : -next);
    }
    if (this.sitUpMode && this.sitUpReference) {
      this.sitUpPath = new SitUpPath({ standEyeHeight: next });
      this.applySitUpTransform();
    }
    this.start.setStatus(`视点高度 ${next.toFixed(2)} m`, 'ok');
  }

  /**
   * `view:orient:<yaw>,<pitch>`: absolute orientation in degrees, resent at
   * ≤10 Hz while the operator drags. There is no translation channel.
   * Invalid frames are rejected whole and out-of-session frames are ignored so
   * a stuck tablet cannot move the view.
   */
  private applyViewOrientation(raw: string): void {
    const target = parseViewOrient(raw);
    if (target === null) {
      this.start.setStatus(`视角参数无效：${raw}`, 'error');
      return;
    }
    if (!this.viewCommandsAllowed()) {
      return;
    }
    this.viewMotion.setTarget(target.lookYawDeg, target.upGazeDeg);
  }

  /** `view:anim:<name>`: fixed one-shot presets only. */
  private playViewAnim(raw: string): void {
    const name = parseViewAnim(raw);
    if (!name) {
      this.start.setStatus(`未知视角动画：${raw}`, 'error');
      return;
    }
    if (!this.viewCommandsAllowed()) {
      this.start.setStatus('当前无法播放视角动画', 'error');
      return;
    }
    this.viewMotion.play(name);
  }

  /** Rejected during calibration and whenever the patient is not in XR. */
  private viewCommandsAllowed(): boolean {
    return this.session !== null
      && this.xr.isPresenting
      && !(this.calibration?.isActive() ?? false);
  }

  /**
   * Socket faults are visible to the operator: a drop after a working link
   * reads as the tablet link being gone. The motion halt itself is owned by
   * the link (it resets control mode) and by setControlMode below.
   */
  private handleLinkStatus(status: 'open' | 'closed'): void {
    const wasOnline = this.linkOnline;
    this.linkOnline = status === 'open';
    if (status === 'open' || !wasOnline) {
      return;
    }
    this.start.setStatus(this.strings.controlModeOff, 'error');
  }

  private setControlMode(active: boolean): void {
    if (this.controlMode === active) {
      return;
    }
    this.controlMode = active;
    document.body.classList.toggle('control-mode', active);
    if (active) {
      if (this.session) {
        this.input.setLayers(false, false);
      }
      this.start.setStatus(this.strings.controlModeOn, 'ok');
    } else {
      // Losing the tablet must never leave motion latched on. Freeze the view
      // where it is (no recenter: the pitch target is held), brake the comfort
      // posture and stop the sit-up performance at its current angle.
      this.viewMotion.stop();
      this.comfort?.stopPosture();
      this.stopSitUp();
      if (this.session) {
        this.input.setLayers(true, true);
      }
      this.start.setStatus(this.strings.controlModeOff);
    }
    this.link.sendStateNow();
    this.updateHud(performance.now());
  }

  private setVirtualPosture(rising: boolean): void {
    if (!this.session || !this.sitUpMode || !this.sitUpPath) {
      this.start.setStatus('虚拟起身仅能在完成校准后的训练中使用', 'error');
      return;
    }
    if (this.calibration?.isActive()) {
      this.start.setStatus('校准中无法调整姿态', 'error');
      return;
    }
    this.sitUpMotion.setTarget(rising ? 1 : 0);
    this.start.setStatus(rising ? '虚拟起身中，随时可停止' : '正在回到卧床视角', 'ok');
  }

  private stopSitUp(): void {
    if (!this.sitUpMode) {
      return;
    }
    this.sitUpMotion.stop();
    this.applySitUpTransform();
    this.start.setStatus('已停止虚拟起身', 'ok');
  }

  private updateSitUp(dt: number): void {
    if (!this.sitUpMode) {
      return;
    }
    if (this.sitUpMotion.update(dt)) {
      this.applySitUpTransform();
    }
  }

  /**
   * Invert the virtual camera path into the world shell's base layer. The
   * shell keeps this separate from the view pitch, so the two never overwrite
   * each other and neither writes a transform directly from here.
   */
  private applySitUpTransform(): void {
    if (!this.sitUpMode || !this.sitUpPath || !this.sitUpReference || !this.shell) {
      return;
    }
    const camera = this.sitUpPath.at(this.sitUpMotion.t);
    this.shell.setBasePose(this.sitUpPath.worldFor(this.sitUpReference, camera));
  }

  private applyAudioMuted(next: boolean): void {
    setAudioMuted(next);
    this.audioMuted = next;
    this.link.sendStateNow();
    this.updateHud(performance.now());
  }

  private toggleAudio(): void {
    this.audioMuted = toggleMuted();
    this.link.sendStateNow();
    this.updateHud(performance.now());
  }

  private startSceneAudio(): void {
    const definition = getSceneDefinition(this.sceneId);
    if (definition) {
      playSceneAudio(definition.audio);
    }
  }

  private stopSceneAudio(): void {
    stopAudio();
  }

  private onSelectStart(): void {
    this.selectEndHandled = false;
  }

  private onSelectEnd(): void {
    if (this.selectEndHandled) {
      return;
    }
    this.selectEndHandled = true;
    this.onSelectShort();
  }

  /** Firefox emits `select` after `selectend`; this is only a fallback. */
  private onSelectFallback(): void {
    this.onSelectEnd();
  }

  /**
   * The only in-headset click action: toggle the sit-up animation. Scene
   * targets are still chosen by 6 s gaze dwell, and there is no web menu.
   */
  private onSelectShort(): void {
    if (!this.session || !this.sitUpReady || (this.calibration?.isActive() ?? false)) {
      return;
    }
    const rising = this.sitUpMotion.target < 0.5;
    this.sitUpMotion.setTarget(rising ? 1 : 0);
    this.start.setStatus(rising ? '正在坐起' : '正在回躺', 'ok');
  }

  private onFrame = (): void => {
    const now = performance.now();
    const dt = this.lastFrame > 0 ? Math.min((now - this.lastFrame) / 1000, MAX_DT) : 0;
    this.lastFrame = now;
    this.elapsed += dt;
    this.renderMonitor.push(dt * 1000);

    readHeadPose(this.camera, this.xr, this.headPose);
    this.pipeline.run(dt, now);

    this.frames += 1;
    if (now - this.fpsAt >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsAt));
      this.frames = 0;
      this.fpsAt = now;
    }
    if (now - this.hudAt >= 500) {
      this.hudAt = now;
      this.updateHud(now);
    }
  };

  private updateHud(_now: number): void {
    const visible = this.showPerf
      && (this.xr.isPresenting || this.previewing);
    this.hud.setVisible(visible);
    if (!visible) {
      return;
    }
    const state = this.captureSnapshot();
    const definition = getSceneDefinition(this.sceneId);
    const calibrationState = state.calibrating
      ? '校准中'
      : state.calibrated
        ? '校准✓'
        : '未校准';
    const mode = this.xr.isPresenting
      ? 'XR'
      : this.previewing
        ? '预览'
        : '待机';
    // Actual render stats, including both XR eyes. Design-time scene counts
    // hid the real per-frame load and the double-eye render in XR.
    const render = this.renderer.info.render;
    const budget = this.renderMonitor.snapshot();
    const triangles = `${(render.triangles / 1000).toFixed(1)}k△`;
    const draws = `${render.calls}dc`;
    const summary = [
      mode,
      definition?.name[this.config.lang] ?? this.sceneId,
      calibrationState,
      this.config.highQuality ? `高 ${Math.round(this.config.xrScale * 100)}%` : `低 ${Math.round(this.config.xrScale * 100)}%`,
      triangles,
      draws,
      `p95 ${budget.p95Ms.toFixed(0)}ms`,
      this.audioMuted ? '声关' : '声开'
    ].join('  ');
    this.hud.setStats(this.fps, summary);
  }

  /**
   * Flow gate for the near-field cue: +1 only while a rising transition is
   * actually moving. Lowering, braking, stop, calibration and lease loss all
   * report 0, which freezes the motes and fades them with the cue's own τ.
   */
  private computeCueFlow(): number {
    if (this.calibration?.isActive() ?? false) {
      return 0;
    }
    if (this.sitUpMode) {
      if (!this.sitUpMotion.moving) {
        return 0;
      }
      // Lowering (or a stopped ramp) freezes the motes: only rising reads as
      // weightlessness. A small floor makes the first frames move immediately.
      if (this.sitUpMotion.target <= this.sitUpMotion.t) {
        return 0;
      }
      const rate = this.sitUpPath?.pitchRateAt(this.sitUpMotion.t, SITUP_DURATION_MS) ?? 0;
      return Math.max(CUE_IDLE_FLOW, Math.min(1, rate / CUE_FULL_DEG_PER_S));
    }
    const comfort = this.comfort;
    if (!comfort || !comfort.isPostureMoving()) {
      return 0;
    }
    return comfort.getPosturePhase() === 'rising' ? 1 : 0;
  }

  /** Collect the facts telemetry, the HUD and command handlers all read. */
  private captureSnapshot(): SceneSnapshot {
    const input = this.snapshotInput;
    input.sceneId = this.sceneId;
    input.loaded = this.handle !== null;
    input.session = this.session !== null;
    input.calibrating = this.calibration?.isActive() ?? false;
    input.calibrated = this.comfort?.isCalibrated() ?? false;
    input.audioMuted = this.audioMuted;
    input.eyeHeight = this.eyeHeight;
    // The mirror must see the same world the patient sees: shell (view) times
    // base (comfort calibration or sit-up inverse), not just the head pose.
    if (this.shell) {
      this.worldQuat.copy(this.shell.group.quaternion).multiply(this.shell.base.quaternion);
    } else {
      this.worldQuat.identity();
    }
    this.worldEuler.setFromQuaternion(this.worldQuat, 'XYZ');
    input.worldYawDeg = THREE.MathUtils.radToDeg(this.worldEuler.y);
    input.worldPitchDeg = THREE.MathUtils.radToDeg(this.worldEuler.x);
    input.worldRollDeg = THREE.MathUtils.radToDeg(this.worldEuler.z);
    const comfortState = this.comfort?.getState();
    input.confidence = comfortState?.remap?.confidence ?? (comfortState?.calibrated ? 1 : 0);
    input.sitUp = this.sitUpMode ? this.sitUpPath : null;
    input.sitUpT = this.sitUpMotion.t;
    input.sitUpTarget = this.sitUpMotion.target;
    input.sitUpMoving = this.sitUpMotion.moving;
    input.posture = this.comfort?.getPostureState() ?? null;
    const comfort = this.comfort;
    const shell = this.shell;
    input.baseQuaternion = shell ? shell.base.quaternion : this.identityQuaternion;
    input.baseReferenceQuaternion = this.sitUpMode
      ? this.sitUpBase0
      : comfort
        ? comfort.getCalibrationQuaternion(this.calibrationFrame)
        : this.identityQuaternion;
    input.lookYawDeg = this.viewMotion.getLookYawDeg();
    input.lookYawTargetDeg = this.viewMotion.getTargetLookYawDeg();
    input.upGazeDeg = this.viewMotion.getUpGazeDeg();
    input.upGazeTargetDeg = this.viewMotion.getTargetUpGazeDeg();
    input.viewAnim = this.viewMotion.getStateName();
    input.viewPreset = presetCode(this.viewMotion.getPresetId());
    input.floorOffset = this.host.floor;
    input.cueFlow = this.cueFlow;
    const cue = this.postureCueState?.getState();
    input.cueEnabled = cue?.enabled ?? false;
    input.cueIntensity = cue?.intensity ?? 0;
    return this.snapshot.capture(input);
  }

  get postureCue(): PostureCueApi | null {
    return this.postureCueState;
  }

  dispose(): void {
    this.link.stop();
    this.stopSceneAudio();
    disposeAudio();
    this.hud.dispose();
    this.input.dispose();
    this.disposeScene();
    this.host.dispose();
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
  }
}
