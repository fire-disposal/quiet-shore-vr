import * as THREE from 'three';
import { readConfig, type AppConfig } from './config';
import { createRenderer, type Quality } from '../core/xr/renderer';
import { readHeadPose } from '../core/xr/pose';
import { createComfort, type ComfortApi, type RemapResult } from '../core/xr/comfort';
import type { HeadPose, XRManagerLike } from '../core/xr/types';
import { SceneHost } from '../core/scene/host';
import type { SceneDefinition, SceneHandle } from '../core/scene/contract';
import { getSceneDefinition, listScenes } from '../scenes/registry';
import { FramePipeline } from '../core/geometry/pipeline';
import { measureObject } from '../core/geometry/budget';
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
  playTrack,
  preloadTrack,
  setAudioMuted,
  stopAudio,
  toggleMuted,
  unlockAudio
} from '../audio/audio';
import { RemoteControl } from './remote-control';
import { TelemetrySender } from './telemetry';

const EYE_HEIGHT = 1.6;
const MAX_DT = 0.25;

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
  private readonly headEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private controlMode = false;

  private sceneId: SceneId;
  private handle: SceneHandle | null = null;
  private comfort: ComfortApi | null = null;
  private calibration: Calibration | null = null;
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

  constructor() {
    this.config = readConfig(window.location.search);
    this.strings = getStrings(this.config.lang);
    this.showPerf = this.config.showPerf;
    this.sceneId = this.config.initialScene ?? readStoredScene() ?? 'landscape';

    this.start = new StartScreen(listScenes(), this.strings, this.config.lang, {
      onEnter: () => void this.enterVR(),
      onPreview: () => this.startPreview(),
      onSelectScene: (id) => this.switchScene(id),
      onRecalibrate: () => this.recalibrate(),
      onAudio: () => this.toggleAudio(),
      onExit: () => this.exitAll(),
      onPerfChange: (enabled) => {
        this.showPerf = enabled;
        this.updateHud(performance.now());
      }
    });
    this.start.setPerf(this.showPerf);
    this.start.setMinimal(this.config.minimal);

    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.05,
      500
    );
    this.camera.position.set(0, EYE_HEIGHT, 3.2);
    this.camera.rotation.order = 'YXZ';

    const quality: Quality = { high: this.config.highQuality, aa: this.config.aa };
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
      () => ({
        scene: this.sceneId,
        session: this.session !== null,
        calibrating: this.calibration?.isActive() ?? false,
        audio: this.audioMuted
      })
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
      id: 'spatial-layout',
      phase: 'layout',
      order: 0,
      run: (dt: number, now: number) => {
        this.menu.update(this.headPose, dt, now);
        this.lab.update(this.headPose, dt, now);
        this.hud.setVisible(
          this.showPerf && !this.menu.isOpen() && (this.xr.isPresenting || this.previewing)
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
    this.start.setSelected(this.sceneId);
    this.start.setAudioLabel(false);
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
      eyeHeight: EYE_HEIGHT
    });
    this.handle = handle;
    // Wrap the host's content group, not the scene root: floor offset stays on
    // content and survives the comfort rotation.
    this.comfort = createComfort({ scene: this.scene, world: this.host.content });
    this.calibration = new Calibration({
      scene: this.scene,
      comfort: this.comfort,
      strings: this.strings,
      theme: DEFAULT_SPATIAL_THEME,
      onResult: (result) => this.onCalibrationResult(result)
    });
    this.registerSelectables(handle.selectables);
    this.host.setFloorOffset(this.session ? -EYE_HEIGHT : 0);
    this.savedBackground = this.scene.background;
    preloadTrack(definition.audio);
    this.sceneId = id;
    storeScene(id);
    this.start.setSelected(id);
    this.start.setSceneNote(this.sceneNote(definition));
    this.syncLab();
  }

  private disposeScene(): void {
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

  /** Patient-facing copy only; triangles/draw calls stay in the performance bar. */
  private sceneNote(definition: SceneDefinition): string {
    return this.start.isMinimal
      ? definition.tagline[this.config.lang]
      : `已选：${definition.name[this.config.lang]}`;
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
      this.start.setStatus(
        supported ? this.strings.xrReady : this.strings.xrUnsupported,
        supported ? 'ok' : 'error'
      );
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
      this.start.setRecalibrateEnabled(true);
      this.host.setFloorOffset(-EYE_HEIGHT);
      this.menu.attach(next);
      this.menu.close();
      this.menu.setAudioEnabled(!this.audioMuted);
      if (this.controlMode) {
        this.input.setLayers(false, false);
      }
      this.input.setLayers(true, true);
      this.syncLab();
      this.start.setStatus(this.strings.xrReady, 'ok');

      if (this.config.skipCalibration) {
        if (this.handle) {
          this.handle.root.visible = true;
        }
        this.comfort?.reset();
        this.menu.close();
        this.playSceneAudio();
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
    this.host.setFloorOffset(0);
    this.comfort?.reset();
    this.renderer.setAnimationLoop(null);
    this.start.showStart();
    this.start.setEnterEnabled(true);
    this.start.setRecalibrateEnabled(false);
    this.input.setLayers(true, true);
    this.syncLab();
    this.start.setStatus(this.strings.sessionEnded);
    this.telemetry.sendStateNow();
    this.updateHud(performance.now());
  }

  private beginCalibration(): void {
    if (!this.calibration || !this.handle) {
      return;
    }
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
      this.playSceneAudio();
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
    this.playSceneAudio();
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
    this.start.setRecalibrateEnabled(false);
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
      this.start.setSelected(this.sceneId);
      return;
    }
    if (normalized === this.sceneId && this.handle) {
      storeScene(this.sceneId);
      this.start.setSelected(this.sceneId);
      return;
    }
    this.loadScene(normalized);
    if (this.previewing) {
      this.playSceneAudio();
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
      case 'start':
        this.start.setStatus(this.strings.remoteStartNeedsGesture, 'ok');
        return;
      default:
        this.start.setStatus(`${this.strings.remoteUnknown}: ${raw}`, 'error');
    }
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
      if (this.session) {
        this.input.setLayers(true, true);
      }
      this.start.setStatus(this.strings.controlModeOff);
    }
    this.telemetry.sendStateNow();
    this.updateHud(performance.now());
  }

  private applyAudioMuted(next: boolean): void {
    setAudioMuted(next);
    this.audioMuted = next;
    this.start.setAudioLabel(next);
    this.menu.setAudioEnabled(!next);
    this.telemetry.sendStateNow();
    this.updateHud(performance.now());
  }

  private toggleAudio(): void {
    this.audioMuted = toggleMuted();
    this.start.setAudioLabel(this.audioMuted);
    this.menu.setAudioEnabled(!this.audioMuted);
    this.telemetry.sendStateNow();
    this.updateHud(performance.now());
  }

  private playSceneAudio(): void {
    const definition = getSceneDefinition(this.sceneId);
    if (definition) {
      playTrack(definition.audio);
    }
  }

  private stopSceneAudio(): void {
    stopAudio();
  }

  private onSelect(): void {
    if (this.controlMode) {
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
    const stats = this.handle ? measureObject(this.handle.root) : null;
    const triangles = stats ? `${(stats.triangles / 1000).toFixed(1)}k△` : '--';
    const draws = stats ? `${stats.drawCalls}dc` : '--';
    const summary = [
      mode,
      definition?.name[this.config.lang] ?? this.sceneId,
      calibrationState,
      this.config.highQuality ? '高' : '低',
      triangles,
      draws,
      this.audioMuted ? '声关' : '声开'
    ].join('  ');
    this.hud.setStats(this.fps, summary);
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
