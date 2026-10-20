import * as THREE from 'three';
import { EYE_HEIGHT_MAX, EYE_HEIGHT_MIN, readConfig, type AppConfig } from './config';
import { createRenderer, type Quality } from '../core/xr/renderer';
import { readHeadPose } from '../core/xr/pose';
import {
  createComfort,
  POSTURE_LIMITS,
  type ComfortApi,
  type RemapResult
} from '../core/xr/comfort';
import type { HeadPose, XRManagerLike } from '../core/xr/types';
import { SceneHost } from '../core/scene/host';
import type { SceneHandle } from '../core/scene/contract';
import { getSceneDefinition } from '../scenes/registry';
import { FramePipeline } from '../core/geometry/pipeline';
import { createSpatialLab, type SpatialLabApi } from '../ui/spatial-lab';
import { createXrMenu, type XrMenuApi } from '../ui/xr-menu';
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
import { RemoteControl } from './remote-control';
import { createPostureCue } from '../core/xr/posture-cue';
import type { PostureCueApi } from '../core/xr/posture-cue';
import { RenderMonitor } from '../core/performance/render-monitor';
import { readStoredShowPerf, storeShowPerf } from './preferences';
import { TelemetrySender } from './telemetry';

const MAX_DT = 0.25;
/** Operator view movement: bounded virtual translation, never the XR camera. */
const VIEW_MAX_SPEED = 0.3; // m/s at full joystick deflection
const VIEW_MAX_OFFSET = 0.45; // m radial, from the session origin
const VIEW_TTL_MS = 300; // no intent update → stop within this window
// Strict wire forms: no sign, exponent, padding or spaces; reject, never coerce.
const EYE_HEIGHT_ARG = /^1\.\d{1,3}$/;
const VIEW_ARG = /^-?\d+(?:\.\d+)?$/;

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
  private readonly menu: XrMenuApi;
  private readonly lab: SpatialLabApi;
  private readonly hud: SpatialHud;
  private readonly remote: RemoteControl;
  private readonly telemetry: TelemetrySender;
  private readonly renderMonitor = new RenderMonitor();
  private readonly headEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private controlMode = false;

  private eyeHeight: number;
  private viewVelocityX = 0;
  private viewVelocityZ = 0;
  private viewOffsetX = 0;
  private viewOffsetZ = 0;
  private viewExpiresAt = 0;

  private sceneId: SceneId;
  private handle: SceneHandle | null = null;
  private comfort: ComfortApi | null = null;
  private calibration: Calibration | null = null;
  private postureCueState: PostureCueApi | null = null;
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
    this.input = new SpatialInput(this.camera, this.scene, DEFAULT_SPATIAL_THEME);
    this.menu = createXrMenu({
      scene: this.scene,
      camera: this.camera,
      input: this.input,
      strings: this.strings,
      theme: DEFAULT_SPATIAL_THEME,
      onAction: (action) => {
        if (action === 'recalibrate') {
          if (this.session) {
            this.beginCalibration();
          } else {
            this.start.setStatus(this.strings.recalibrateNeedsSession, 'error');
          }
        } else if (action === 'audio') {
          this.toggleAudio();
        } else if (action === 'exit') {
          if (this.session) {
            void this.session.end();
          } else {
            this.exitAll();
          }
        }
      }
    });
    this.lab = createSpatialLab({
      scene: this.scene,
      camera: this.camera,
      input: this.input,
      theme: DEFAULT_SPATIAL_THEME
    });
    this.hud = new SpatialHud(this.scene, DEFAULT_SPATIAL_THEME);
    this.remote = new RemoteControl(
      (command) => this.handleRemoteCommand(command),
      (active) => this.setControlMode(active)
    );
    this.telemetry = new TelemetrySender(
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
      () => {
        const posture = this.comfort?.getPostureState();
        const cue = this.postureCueState?.getState();
        const remap = this.comfort?.getState().remap;
        return {
          scene: this.sceneId,
          session: this.session !== null,
          calibrating: this.calibration?.isActive() ?? false,
          audio: this.audioMuted,
          eyeHeight: this.eyeHeight,
          posturePitch: posture?.pitchDeg ?? 0,
          postureRoll: posture?.rollDeg ?? 0,
          postureRise: posture?.riseM ?? 0,
          postureProgress: posture?.progress ?? 0,
          viewX: this.viewOffsetX,
          viewZ: this.viewOffsetZ,
          cueEnabled: cue?.enabled ?? false,
          cueIntensity: cue?.intensity ?? 0,
          calibrationConfidence: remap?.confidence ?? 0
        };
      }
    );

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
      id: 'view-movement',
      phase: 'simulation',
      order: 5,
      // Translate scene content, never the XR camera: head pose stays the
      // patient's own, and comfort calibration keeps working on its wrapper.
      run: (dt: number, now: number) => this.updateViewMovement(dt, now)
    });
    this.pipeline.add({
      id: 'spatial-layout',
      phase: 'layout',
      order: 0,
      run: (dt: number, now: number) => {
        this.menu.update(this.headPose, dt, now);
        this.lab.update(this.headPose, dt, now);
        this.hud.setVisible(
          this.showPerf && !this.controlMode && !this.menu.isOpen()
            && (this.xr.isPresenting || this.previewing)
        );
        this.hud.update(this.headPose, dt, now);
        this.calibration?.update(dt, now, this.headPose);
      }
    });
    this.pipeline.add({
      id: 'spatial-input',
      phase: 'render',
      order: 0,
      run: (dt: number, now: number) => {
        this.comfort?.updatePosture(dt);
        if (this.postureCueState) {
          const progress = this.comfort?.getPostureProgress() ?? 0;
          this.postureCueState.setMoving(this.comfort?.isPostureMoving() ?? false);
          this.postureCueState.update(dt, progress, this.headPose.position);
        }
        this.input.update(dt, now, this.headPose);
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
    this.menu.setAudioEnabled(true);
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
    this.remote.start();
    this.telemetry.start();
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
      if (event.key === 'm' || event.key === 'M') {
        this.menu.toggle();
        event.preventDefault();
      } else if (event.key === 'Escape') {
        this.menu.close();
      } else if (event.key === 'Enter' || event.key === ' ') {
        this.onSelect();
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
    // Wrap the host's content group, not the scene root: floor offset stays on
    // content and survives the comfort rotation.
    this.comfort = createComfort({ scene: this.scene, world: this.host.content });
    this.disposePostureCue();
    if (id === 'landscape') {
      this.postureCueState = createPostureCue({ scene: this.scene });
    }
    this.calibration = new Calibration({
      scene: this.scene,
      comfort: this.comfort,
      strings: this.strings,
      theme: DEFAULT_SPATIAL_THEME,
      onResult: (result) => this.onCalibrationResult(result)
    });
    this.registerSelectables(handle.selectables);
    this.host.setFloorOffset(this.session ? -this.eyeHeight : 0);
    this.savedBackground = this.scene.background;
    preloadSceneAudio(definition.audio);
    this.sceneId = id;
    storeScene(id);
    this.start.setScene(this.sceneName(id));
    this.syncLab();
  }

  private disposePostureCue(): void {
    this.postureCueState?.dispose();
    this.postureCueState = null;
  }

  private disposeScene(): void {
    this.disposePostureCue();
    this.lab.setActive(false);
    this.unregisterSelectables();
    this.calibration?.dispose();
    this.calibration = null;
    if (this.comfort) {
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
        dwellTime: 1.2,
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

  private syncLab(): void {
    const active = this.sceneId === 'lab'
      && (this.previewing || this.xr.isPresenting)
      && !(this.calibration?.isActive() ?? false);
    this.lab.setActive(active);
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
      next.addEventListener('select', () => this.onSelect());

      this.start.showStage();
      this.start.setEnterEnabled(false);
      this.host.setFloorOffset(-this.eyeHeight);
      this.menu.attach(next);
      this.menu.close();
      this.menu.setAudioEnabled(!this.audioMuted);
      if (this.controlMode) {
        this.input.setLayers(false, false);
      }
      this.input.setLayers(true, true);
      this.syncLab();
      this.start.setStatus('');

      if (this.config.skipCalibration) {
        if (this.handle) {
          this.handle.root.visible = true;
        }
        this.comfort?.reset();
        this.menu.close();
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
    this.stopSceneAudio();
    this.menu.attach(null);
    this.menu.close();
    this.calibration?.stop();
    this.scene.background = this.savedBackground;
    if (this.handle) {
      this.handle.root.visible = true;
    }
    this.resetViewMovement();
    this.host.setFloorOffset(0);
    this.comfort?.reset();
    this.postureCueState?.update(0, 0, this.headPose.position);
    this.renderer.setAnimationLoop(null);
    this.start.showStart();
    this.start.setEnterEnabled(true);
    this.input.setLayers(true, true);
    this.syncLab();
    this.start.setStatus(
      this.patientStopped ? this.strings.patientStop : this.strings.sessionEnded
    );
    this.patientStopped = false;
    this.telemetry.sendStateNow();
    this.updateHud(performance.now());
  }

  private beginCalibration(): void {
    if (!this.calibration || !this.handle) {
      return;
    }
    // Calibration starts from the session origin: no residual operator offset.
    this.resetViewMovement();
    // A running posture transition must not keep advancing through the
    // capture. setPosture supersedes it and heads for neutral; the API's
    // 1 s floor runs while the scene is hidden.
    this.comfort?.setPosture({ pitchDeg: 0, rollDeg: 0, riseM: 0 }, POSTURE_LIMITS.minDurationMs);
    this.savedBackground = this.scene.background;
    this.scene.background = new THREE.Color(0x000000);
    this.handle.root.visible = false;
    this.menu.close();
    this.input.setLayers(false, false);
    this.calibration.start();
    this.syncLab();
    this.telemetry.sendStateNow();
    this.updateHud(performance.now());
  }

  private onCalibrationResult(result: RemapResult): void {
    this.scene.background = this.savedBackground;
    if (this.handle) {
      this.handle.root.visible = true;
    }
    this.input.setLayers(!this.controlMode, this.session !== null && !this.controlMode);
    this.syncLab();
    if (this.session) {
      this.startSceneAudio();
    }
    this.start.setStatus(
      result.ok ? this.strings.calibrationDone : `${this.strings.calibrationFailed}：${result.reason ?? 'unknown'}`,
      result.ok ? 'ok' : 'error'
    );
    this.telemetry.sendStateNow();
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
    this.menu.attach(null);
    this.menu.close();
    this.menu.setAudioEnabled(!this.audioMuted);
    this.input.setLayers(true, true);
    this.lastFrame = 0;
    this.renderer.setAnimationLoop(this.onFrame);
    this.start.setStatus(this.strings.modePreview);
    this.syncLab();
    this.updateHud(performance.now());
  }

  private exitAll(): void {
    if (this.session) {
      void this.session.end();
      return;
    }
    this.previewing = false;
    this.stopSceneAudio();
    this.menu.attach(null);
    this.menu.close();
    this.host.setFloorOffset(0);
    this.renderer.setAnimationLoop(null);
    this.start.showStart();
    this.start.setStatus(this.strings.modeIdle);
    this.syncLab();
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
    this.telemetry.sendStateNow();
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
    if (command.startsWith('view:move:')) {
      this.startViewMovement(command.slice('view:move:'.length));
      return;
    }
    if (command === 'view:stop') {
      this.haltViewMovement();
      this.start.setStatus('已停止视角移动', 'ok');
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
        this.comfort?.stopPosture();
        this.start.setStatus('已停止虚拟起身', 'ok');
        return;
      case 'cue:on':
        this.postureCueState?.setEnabled(true);
        return;
      case 'cue:off':
        this.postureCueState?.setEnabled(false);
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
      this.host.setFloorOffset(-next);
    }
    this.start.setStatus(`视点高度 ${next.toFixed(2)} m`, 'ok');
  }

  /**
   * `view:move:<x>,<z>`: normalized intent, resent at ~10 Hz while held.
   * Every accepted update refreshes the TTL; invalid or out-of-session
   * commands are ignored so a stuck tablet cannot move the view.
   */
  private startViewMovement(raw: string): void {
    const comma = raw.indexOf(',');
    if (comma < 0 || raw.indexOf(',', comma + 1) >= 0) {
      this.start.setStatus(`视角移动参数无效：${raw}`, 'error');
      return;
    }
    const rawX = raw.slice(0, comma);
    const rawZ = raw.slice(comma + 1);
    if (!VIEW_ARG.test(rawX) || !VIEW_ARG.test(rawZ)) {
      this.start.setStatus(`视角移动参数无效：${raw}`, 'error');
      return;
    }
    const x = Number(rawX);
    const z = Number(rawZ);
    if (
      !Number.isFinite(x) || !Number.isFinite(z)
      || x < -1 || x > 1 || z < -1 || z > 1
    ) {
      this.start.setStatus(`视角移动参数无效：${raw}`, 'error');
      return;
    }
    if (
      !this.session
      || !this.xr.isPresenting
      || (this.calibration?.isActive() ?? false)
    ) {
      return;
    }
    let vx = x;
    let vz = z;
    const length = Math.hypot(vx, vz);
    if (length > 1) {
      vx /= length;
      vz /= length;
    }
    this.viewVelocityX = vx;
    this.viewVelocityZ = vz;
    this.viewExpiresAt = performance.now() + VIEW_TTL_MS;
  }

  private haltViewMovement(): void {
    this.viewVelocityX = 0;
    this.viewVelocityZ = 0;
    this.viewExpiresAt = 0;
  }

  private resetViewMovement(): void {
    this.haltViewMovement();
    this.viewOffsetX = 0;
    this.viewOffsetZ = 0;
    this.applyViewOffset();
  }

  private applyViewOffset(): void {
    // Viewpoint moves opposite the content: right (+x) shifts content left,
    // forward (+z, camera looks down -z) shifts content behind the viewer.
    this.host.content.position.x = -this.viewOffsetX;
    this.host.content.position.z = this.viewOffsetZ;
  }

  private updateViewMovement(dt: number, now: number): void {
    if (this.viewExpiresAt === 0) {
      return;
    }
    if (
      now >= this.viewExpiresAt
      || !this.session
      || !this.xr.isPresenting
      || (this.calibration?.isActive() ?? false)
    ) {
      this.haltViewMovement();
      return;
    }
    if (dt <= 0) {
      return;
    }
    const step = VIEW_MAX_SPEED * dt;
    const nextX = this.viewOffsetX + this.viewVelocityX * step;
    const nextZ = this.viewOffsetZ + this.viewVelocityZ * step;
    const distance = Math.hypot(nextX, nextZ);
    if (distance > VIEW_MAX_OFFSET) {
      // Project onto the 0.45 m circle and drop only the outward component:
      // the operator can slide along the boundary without bouncing off it.
      const nx = nextX / distance;
      const nz = nextZ / distance;
      this.viewOffsetX = nx * VIEW_MAX_OFFSET;
      this.viewOffsetZ = nz * VIEW_MAX_OFFSET;
      const outward = this.viewVelocityX * nx + this.viewVelocityZ * nz;
      if (outward > 0) {
        this.viewVelocityX -= outward * nx;
        this.viewVelocityZ -= outward * nz;
      }
    } else {
      this.viewOffsetX = nextX;
      this.viewOffsetZ = nextZ;
    }
    this.applyViewOffset();
  }

  private setControlMode(active: boolean): void {
    if (this.controlMode === active) {
      return;
    }
    this.controlMode = active;
    document.body.classList.toggle('control-mode', active);
    if (active) {
      this.menu.close();
      if (this.session) {
        this.input.setLayers(false, false);
      }
      this.start.setStatus(this.strings.controlModeOn, 'ok');
    } else {
      // Losing the tablet must never leave motion latched on.
      this.haltViewMovement();
      if (this.session) {
        this.input.setLayers(true, true);
      }
      this.start.setStatus(this.strings.controlModeOff);
    }
    this.telemetry.sendStateNow();
    this.updateHud(performance.now());
  }

  private setVirtualPosture(rising: boolean): void {
    if (!this.session || !this.comfort) {
      this.start.setStatus('虚拟起身仅能在训练中使用', 'error');
      return;
    }
    if (this.calibration?.isActive()) {
      this.start.setStatus('校准中无法调整姿态', 'error');
      return;
    }
    if (!this.comfort.isCalibrated()) {
      this.start.setStatus('请先完成方向校准', 'error');
      return;
    }
    if (rising) {
      this.comfort.setPosture({ pitchDeg: -8, riseM: 0.45 }, 18000);
      this.start.setStatus('虚拟起身中，随时可停止', 'ok');
    } else {
      this.comfort.setPosture({ pitchDeg: 0, riseM: 0 }, 18000);
      this.start.setStatus('正在回到卧床视角', 'ok');
    }
  }

  private applyAudioMuted(next: boolean): void {
    setAudioMuted(next);
    this.audioMuted = next;
    this.menu.setAudioEnabled(!next);
    this.telemetry.sendStateNow();
    this.updateHud(performance.now());
  }

  private toggleAudio(): void {
    this.audioMuted = toggleMuted();
    this.menu.setAudioEnabled(!this.audioMuted);
    this.telemetry.sendStateNow();
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

  private onSelect(): void {
    if (this.controlMode) {
      // Safety exception: in guided mode the headset confirm key still ends
      // the session immediately, so the patient is never trapped.
      if (this.session) {
        this.patientStopped = true;
        void this.session.end();
      }
      return;
    }
    if (this.menu.isOpen()) {
      this.input.select();
      if (!this.input.getFocused()) {
        this.menu.close();
      }
      return;
    }
    if (this.input.getFocused()) {
      this.input.select();
      return;
    }
    if (this.session || this.previewing) {
      this.menu.open();
    }
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
      && !this.menu.isOpen()
      && (this.xr.isPresenting || this.previewing);
    this.hud.setVisible(visible);
    if (!visible) {
      return;
    }
    const definition = getSceneDefinition(this.sceneId);
    const calibrationState = this.calibration?.isActive()
      ? '校准中'
      : this.comfort?.isCalibrated()
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

  get postureCue(): PostureCueApi | null {
    return this.postureCueState;
  }

  dispose(): void {
    this.remote.stop();
    this.telemetry.stop();
    this.stopSceneAudio();
    disposeAudio();
    this.menu.dispose();
    this.lab.dispose();
    this.hud.dispose();
    this.input.dispose();
    this.disposeScene();
    this.host.dispose();
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
  }
}
