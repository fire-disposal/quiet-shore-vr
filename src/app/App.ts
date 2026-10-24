import * as THREE from 'three';
import { readConfig, type AppConfig } from './config';
import { createRenderer } from '../core/xr/renderer';
import { readHeadPose } from '../core/xr/pose';
import {
  createComfort,
  POSTURE_LIMITS,
  type ComfortApi
} from '../core/xr/comfort';
import type { HeadPose, XRManagerLike } from '../core/xr/types';
import { SceneHost } from '../core/scene/host';
import type { SceneHandle } from '../core/scene/contract';
import { getSceneDefinition, SCENE } from '../scenes/registry';
import { FramePipeline } from '../core/geometry/pipeline';
import { SpatialInput } from '../ui/spatial/input';
import { DEFAULT_SPATIAL_THEME } from '../core/spatial/theme';
import { StartScreen } from '../ui/start-screen';
import { SpatialHud } from '../ui/spatial-hud';
import { createSusPanel, type SusPanelApi } from '../ui/sus-panel';
import { createCalibrationOverlay, type CalibrationOverlayApi } from '../ui/calibration-overlay';
import { createCalibrationRun, type CalibrationStatus } from './calibration-run';
import { getStrings, type Strings } from '../ui/strings';
import {
  disposeAudio,
  playSceneAudio,
  preloadSceneAudio,
  setBuoyancySwell,
  setDuckDepth,
  stopAudio,
  unlockAudio
} from '../audio/audio';
import { createVoicePlayer, SEQUENCES, type SequenceName } from '../audio/voice';
import { createPostureCue } from '../core/xr/posture-cue';
import type { PostureCueApi } from '../core/xr/posture-cue';
import { FLOAT_MAX_LEVEL, isFloatProfileId } from '../core/xr/float';
import { planFrame, visualUpInContent } from '../core/xr/world-frame';
import { createFloating, type FloatingApi } from './floating';
import { createWorldRuntime, type WorldRuntimeApi } from './world-runtime';
import { parseRemoteCommand } from './commands';
import { buildSusPayload } from './sus';
import { RenderMonitor } from '../core/performance/render-monitor';
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
import { INITIAL_SESSION, isActive, reduceSession, type SessionEvent, type SessionState } from './session';

const MAX_DT = 0.25;
// Sit-up performance: the confirm key toggles between the supine frame and
// the standing frame. 6 s keeps the turn decisive; the flow cue carries the
// perceived rise, the rotation only sets which way is up.
const SITUP_DURATION_MS = 6000;
/** Rotation rate that maps to full cue flow while rising. */
const CUE_FULL_DEG_PER_S = 40;
/** Floor of the cue flow during a rising transition, so motion starts at once. */
const CUE_IDLE_FLOW = 0.25;
/** Time from a stop to the fade-complete state; motion is frozen at once. */
const STOP_FADE_MS = 1000;
/** Planned session length used by the voice auto plan until the wire carries it. */
const VOICE_PLAN_SESSION_MS = 10 * 60 * 1000;
/** The stable window the operator (or the patient's button) starts. */
/** Hold-still window before the countdown starts (1.2 s × 1.5). */
const CALIBRATION_HOLD_MS = 1800;
/** Countdown, also the averaging window (2 s × 1.5). */
const CALIBRATION_COUNTDOWN_MS = 3000;
/** The card may never outlive this, whatever the pose does. */
const CALIBRATION_DEADLINE_MS = 9000;
/** Spread allowed inside that window before it is rejected. */
const CALIBRATION_MAX_DEVIATION_DEG = 6;
/** The card must stay readable even when the sample lands immediately. */
const CALIBRATION_MIN_VISIBLE_MS = 2500;
// Strict wire forms: no sign, exponent, padding or spaces; reject, never coerce.

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
  private readonly voice = createVoicePlayer();
  /** Wall clock at motion onset; 0 while idle. Drives the reported session clock. */
  private sessionStartedAt = 0;
  private readonly voiceTimers: number[] = [];
  private readonly headEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly worldQuat = new THREE.Quaternion();
  private readonly worldEuler = new THREE.Euler(0, 0, 0, 'XYZ');
  private readonly viewMotion: ViewMotionControllerApi;
  private readonly snapshot = new SceneSnapshot();
  private controlMode = false;

  private eyeHeight: number;
  private cueFlow = 0;

  /** Mode the next session starts in; set before a session, never during one. */
  private pendingMode: 'float' | 'posture' = 'float';
  private handle: SceneHandle | null = null;
  private comfort: ComfortApi | null = null;
  private shell: WorldShellApi | null = null;
  private capturePending = false;
  /** The calibration window; App renders it, the module owns the policy. */
  private readonly calibration = createCalibrationRun({
    holdMs: CALIBRATION_HOLD_MS,
    countdownMs: CALIBRATION_COUNTDOWN_MS,
    deadlineMs: CALIBRATION_DEADLINE_MS,
    maxDeviationDeg: CALIBRATION_MAX_DEVIATION_DEG
  });
  private calibStatus: CalibrationStatus = 'done';
  /** Buoyancy: level, profile, envelope and the content offset it rides on. */
  private readonly floating: FloatingApi;
  /** Base pose: calibration frame, sit-up path and the placement that goes with them. */
  private readonly world: WorldRuntimeApi;
  /** Scratch for the visual-up axis and the frame plan; per-frame, no allocation. */
  private readonly visualUp = new THREE.Vector3();
  /** Sit-up ramp length; the operator can slow it down for comfort. */
  private postureCueState: PostureCueApi | null = null;
  private susPanel: SusPanelApi | null = null;
  private calibrationOverlay: CalibrationOverlayApi | null = null;
  /** Operator switch for gaze dwell; on by default per product decision. */
  private gazeDwellEnabled = true;
  /** Highest float level the loaded scene allows (its own comfort ceiling). */
  private sceneComfortLevel = FLOAT_MAX_LEVEL;
  /** SUS answers live on the headset; the 20-byte state frame has no room. */
  private readonly susAnswers: (number | null)[] = new Array(10).fill(null);
  private readonly calibrationFrame = new THREE.Quaternion();
  private readonly identityQuaternion = new THREE.Quaternion();
  private session: XRSession | null = null;
  private previewing = false;
  private headPose: HeadPose = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion()
  };
  /** Debounce for the single physical confirm: `select*` plus DOM fallbacks. */
  private selectHandledAt = 0;
  private showPerf: boolean;
  /** Scene bed. Off until the operator starts it; voice cues are independent. */
  private sceneBedOn = false;
  private lastFrame = 0;
  private elapsed = 0;
  private frames = 0;
  private fps = 0;
  private fpsAt = 0;
  private hudAt = 0;
  private started = false;
  private enterPending = false;
  private patientStopped = false;
  private lifecycle: SessionState = INITIAL_SESSION;
  /** Loaded scene id; the operator changes it from the tablet, never mid-session. */
  private sceneId: string = SCENE.id;

  constructor() {
    this.config = readConfig(window.location.search);
    this.eyeHeight = this.config.eyeHeight;
    this.strings = getStrings(this.config.lang);
    this.showPerf = this.config.showPerf;
    if (this.config.initialScene) {
      const requested = getSceneDefinition(this.config.initialScene);
      if (requested) {
        this.sceneId = requested.id;
      }
    }
    this.start = new StartScreen(this.strings, {
      onEnter: () => void this.enterVR()
    });

    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.05,
      500
    );
    // The room is built around the standing eye at the origin; the preview
    // camera starts inside it, not outside the front wall.
    this.camera.position.set(0, this.eyeHeight, 0);
    this.camera.rotation.order = 'YXZ';

    this.renderer = createRenderer(this.start.stageElement);
    // WebXRManager's public surface differs across Three typings; the narrow
    // interface is the only part this app uses.
    this.xr = this.renderer.xr as unknown as XRManagerLike;

    this.host = new SceneHost(this.scene);
    // Buoyancy reads the session through `gate()`: the mode and the frame that
    // currently poses the world decide whether the heave may run at all.
    this.floating = createFloating({
      host: this.host,
      handle: () => this.handle,
      gate: () => ({
        mode: this.lifecycle.mode,
        active: isActive(this.lifecycle),
        capturePending: this.capturePending,
        rising: this.world.isRising()
      }),
      swell: (depth, periodS) => setBuoyancySwell(depth, periodS),
      axis: (out) =>
        visualUpInContent(
          this.headPose.quaternion,
          this.shell?.base.quaternion ?? this.identityQuaternion,
          out
        ),
      level: 1,
      profile: isFloatProfileId(this.config.floatProfile) ? this.config.floatProfile : undefined,
      breath: true
    });
    // The base pose owner sits on top of buoyancy: it decides which frame poses
    // the world and hands the frame's offset to the buoyancy module.
    this.world = createWorldRuntime({
      shell: () => this.shell,
      comfort: () => this.comfort,
      eyeHeight: () => this.eyeHeight,
      setBaseOffset: (y) => this.floating.setBaseOffset(y),
      mode: () => this.lifecycle.mode
    });
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
      // Anything that moves the world needs the fast cadence. Reporting only
      // the sit-up left a floating session at 1 Hz, which the tablet then had
      // to smooth into 60 fps by itself.
      () =>
        this.world.isRising() ||
        isActive(this.lifecycle) ||
        this.viewMotion.getStateName() !== 'idle',
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
        this.calibrationOverlay?.update(dt, now, this.headPose);
        // Driven by the card's own visibility: the reducer phase was a second
        // source of truth, and a stale phase left the bar frozen.
        if (this.calibrationOverlay?.isVisible() && this.xr.isPresenting) {
          this.stepCalibration(performance.now());
        }
      }
    });
    this.pipeline.add({
      id: 'world-motion',
      phase: 'render',
      order: 0,
      run: (dt: number, now: number) => {
        // One owner: the runtime advances the sit-up ramp or the comfort
        // posture, and never both.
        this.world.update(dt);
        this.cueFlow = this.computeCueFlow();
        this.handle?.setFlow?.(this.cueFlow);
        this.postureCueState?.update(dt, this.headPose.position, this.cueFlow);
        this.updateFloat(dt);
        this.susPanel?.update(dt, now, this.headPose);
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

    this.loadScene();
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
    // Cues are shipped with the page; a missing manifest leaves voice off, and
    // the entry screen says so instead of failing silently.
    if (typeof location !== 'undefined' && location.search.includes('debug')) {
      const debug = {
        /** Desktop check: feed a remote command through the real router. */
        command: (cmd: string) => {
          this.handleRemoteCommand(cmd);
          return cmd;
        },
        /** Desktop check: load a scene in the 2D preview. */
        scene: (id: string) => {
          if (!this.previewing && !this.xr.isPresenting) {
            this.startPreview();
          }
          this.applySceneCommand(id);
          return this.sceneId;
        },
        /**
         * Desktop check: the world frame the render loop is writing. Mirrors the
         * three animation owners: the frame offset, the buoyancy delta and the
         * operator's up-gaze.
         */
        frame: () => ({
          mode: this.lifecycle.mode,
          phase: this.lifecycle.phase,
          frame: this.world.state().posturePosesBase ? 'situp' : 'calibrated',
          sitUpT: this.world.state().sitUpT,
          baseFloorOffset: this.floating.getState().baseOffset,
          bobM: this.floating.getState().offsetM,
          swayDeg: this.floating.getState().swayDeg,
          contentY: this.host.content.position.y,
          upGazeDeg: this.viewMotion.getUpGazeDeg()
        }),
        /** Desktop check: where the SUS panel actually is, if it is open. */
        sus: () => {
          const panel = this.susPanel;
          const at = new THREE.Vector3();
          panel?.object.getWorldPosition(at);
          return {
            open: panel?.isOpen() ?? false,
            at: at.toArray().map((value) => Math.round(value * 100) / 100)
          };
        },
        /**
         * Desktop check: stand in for the headset pose. Spatial UI anchors and
         * the gaze reticle read `headPose`, which the XR loop would otherwise
         * be the only writer of.
         */
        pose: (next: { x?: number; y?: number; z?: number; yawDeg?: number; pitchDeg?: number } = {}) => {
          const yaw = THREE.MathUtils.degToRad(next.yawDeg ?? 0);
          const pitch = THREE.MathUtils.degToRad(next.pitchDeg ?? 0);
          if (!this.xr.isPresenting) {
            // The loop copies the preview camera into `headPose`, so aiming the
            // camera is what aims the gaze.
            this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
            if (next.y !== undefined) {
              this.camera.position.y = next.y;
            }
          }
          this.headEuler.set(pitch, yaw, 0, 'YXZ');
          this.headPose.quaternion.setFromEuler(this.headEuler);
          this.headPose.position.set(next.x ?? 0, next.y ?? 0, next.z ?? 0);
          return [
            this.headPose.position.x,
            this.headPose.position.y,
            this.headPose.position.z,
            next.yawDeg ?? 0,
            next.pitchDeg ?? 0
          ];
        },
        calibration: (visible: boolean) => {
          this.calibrationOverlay ??= createCalibrationOverlay({
            scene: this.scene,
            theme: DEFAULT_SPATIAL_THEME
          });
          if (visible) {
            // Desktop check: show the 2D stage so the overlay is on screen.
            if (!this.previewing && !this.xr.isPresenting) {
              this.startPreview();
            }
            this.calibrationOverlay.setHint('');
            this.calibrationOverlay.show();
            this.calibrationOverlay.setProgress(0.45);
          } else {
            this.calibrationOverlay.hide();
          }
        }
      };
      (window as unknown as Record<string, unknown>).QuietShoreDebug = debug;
      // Field diagnostics: `?debug=1` exposes the player so a desktop browser
      // can exercise the same code path the headset runs.
      (window as unknown as Record<string, unknown>).QuietShoreVoice = this.voice;
    }
    void this.voice.load().then((ready) => {
      this.start.setHint(ready ? '语音已就绪' : `语音未加载：${this.voice.lastError()}`);
    });
    void this.detectXR();
  }

  private bind(): void {
    // A thrown frame must not leave a silently frozen page: surface it once.
    window.addEventListener('error', (event) => {
      const message = event.message || '未知错误';
      this.start.setStatus(`页面出错：${message}`, 'error');
    });
    // The headset's physical button reaches a page in two different shapes
    // depending on the runtime: an XR `select` (bound in enterVR) or a DOM
    // event. Both mean "the patient pressed confirm"; both are debounced by
    // onSelectEnd, so wiring all of them cannot double-fire.
    // The headset button has reached the page as a DOM key or click in some
    // builds and as an XR select in others; every channel lands in the same
    // debounced handler, and the handler itself decides what the phase means.
    const onConfirmKey = (event: KeyboardEvent): void => {
      if (
        event.key === 'Enter' ||
        event.key === ' ' ||
        event.code === 'Enter' ||
        event.code === 'Space' ||
        event.keyCode === 13
      ) {
        this.onSelectShort('keydown');
      }
    };
    window.addEventListener('keydown', onConfirmKey, { capture: true });
    document.addEventListener('keydown', onConfirmKey, { capture: true });
    document.addEventListener('click', () => this.onSelectShort('click'), {
      capture: true
    });
    document.addEventListener('pointerdown', () => this.onSelectShort('pointer'), {
      capture: true
    });
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

  private loadScene(): void {
    this.disposeScene();
    const definition = getSceneDefinition(this.sceneId) ?? SCENE;
    const handle = this.host.load(definition);
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
    this.world.clearBase();
    this.floating.setBaseOffset(this.session ? -this.eyeHeight : 0);
    this.floating.reset();
    preloadSceneAudio(definition.audio);
    this.start.setScene(definition.name[this.config.lang]);
  }

  private disposePostureCue(): void {
    this.postureCueState?.dispose();
    this.postureCueState = null;
  }

  private disposeScene(): void {
    this.disposePostureCue();
    if (this.comfort) {
      // Unwrap the shell first: it re-hangs the base group on the scene.
      this.shell?.dispose();
      this.shell = null;
      this.comfort.reset();
      this.scene.remove(this.comfort.group);
      this.comfort.group.remove(this.host.content);
      this.scene.add(this.host.content);
      this.floating.setBaseOffset(0);
      this.comfort = null;
    }
    this.host.unload();
    this.handle = null;
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
      this.dispatch({ type: 'start', mode: this.pendingMode });
      await this.xr.setSession(next);
      this.lastFrame = 0;
      this.renderer.setAnimationLoop(this.onFrame);
      next.addEventListener('end', () => this.onSessionEnd());
      next.addEventListener('selectstart', () => this.onSelectStart());
      next.addEventListener('selectend', () => this.onSelectEnd('xr-select'));
      next.addEventListener('select', () => this.onSelectEnd('xr-select'));

      this.start.showStage();
      this.start.setEnterEnabled(false);
      // A page that opened before the cue route was ready retries here: the
      // manifest is small and this runs inside the entry gesture.
      if (!this.voice.isReady()) {
        void this.voice.load();
      }
      this.floating.setBaseOffset(-this.eyeHeight);
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
        this.dispatch({ type: 'calibrated' });
        this.start.setStatus(this.strings.skippedCalibration, 'ok');
      } else {
        this.beginCalibration();
      }
      this.updateHud(performance.now());
    } catch (error) {
      this.session = null;
      this.dispatch({ type: 'stop', reason: 'session-end' });
      this.dispatch({ type: 'faded' });
      this.start.setStatus(
        `${this.strings.enterFailed}：${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    } finally {
      this.enterPending = false;
      this.start.setEnterBusy(false);
    }
  }

  /**
   * Single entry for the session lifecycle. Entering `stopping` freezes every
   * motion source at once and schedules the fade; the reducer decides whether
   * each transition is legal.
   */
  private dispatch(event: SessionEvent): void {
    const previous = this.lifecycle.phase;
    this.lifecycle = reduceSession(this.lifecycle, event);
    if (previous === 'calibrating' && isActive(this.lifecycle)) {
      this.sessionStartedAt = performance.now();
    }
    if (this.lifecycle.phase !== 'stopping' || previous === 'stopping') {
      return;
    }
    this.viewMotion.stop();
    this.comfort?.stopPosture();
    this.stopSitUp();
    this.voice.stop();
    // Any stop — including one during calibration — takes the overlay with it.
    this.calibrationOverlay?.hide();
    this.sessionStartedAt = 0;
    window.setTimeout(() => this.dispatch({ type: 'faded' }), STOP_FADE_MS);
  }

  private onSessionEnd(): void {
    this.dispatch({ type: 'stop', reason: 'session-end' });
    this.dispatch({ type: 'faded' });
    this.session = null;
    // A patient stop freezes first, then the end-of-session reset zeroes the
    // pitch: stop never eases and never recenters on its own.
    if (this.patientStopped) {
      this.viewMotion.stop();
    }
    this.stopSceneAudio();
    this.resetWorldToRest();
    this.renderer.setAnimationLoop(null);
    // The session is over: do not invite the patient to start again.
    this.start.showEnded();
    this.input.setLayers(true, true);
    this.start.setStatus(
      this.patientStopped ? this.strings.patientStop : this.strings.sessionEnded
    );
    this.patientStopped = false;
    this.link.sendStateNow();
    this.updateHud(performance.now());
  }

  /**
   * Builds the SUS panel on first use and shows it.
   *
   * The panel is answered by gaze (5 s per target) because a supine patient has
   * no pointer; the operator can still answer from the tablet, and the gaze
   * feature itself is switchable from the control side.
   */
  private openSus(): void {
    if (!this.susPanel) {
      this.susPanel = createSusPanel({
        scene: this.scene,
        theme: DEFAULT_SPATIAL_THEME,
        input: this.input,
        stringsDwellHint: this.strings.dwellHint,
        onAnswer: (index, value) => {
          this.susAnswers[index] = value;
          this.report(`SUS ${index + 1} = ${value}`);
          if (this.susAnswers.every((answer) => answer !== null)) {
            this.report('SUS 已完成');
            this.publishSus();
          }
        },
        onClose: () => {
          // Give the layers back to whatever the session mode dictates.
          this.input.setLayers(!this.controlMode, this.session !== null && !this.controlMode);
          const filled = this.susAnswers.filter((answer) => answer !== null).length;
          // A half-finished sheet is still worth keeping: the tablet records it
          // as incomplete rather than losing what the patient did answer.
          if (filled > 0) {
            this.publishSus();
          }
          this.start.setStatus(`SUS 已记录 ${filled}/${this.susAnswers.length}`, 'ok');
        }
      });
      this.susPanel.setDwellEnabled(this.gazeDwellEnabled);
    }
    // The panel is the one spatial UI the patient may use by gaze, so it has
    // to be focusable even while the tablet holds control: the UI layer used to
    // be off for the whole session, which made dwell unreachable in practice.
    this.input.setLayers(true, false);
    this.susPanel.open();
  }

  /**
   * Mode can be chosen before a session or switched during one. While running,
   * the phase follows the mode and the world is handed over without a jump:
   * entering posture arms the sit-up at "standing" (what the patient currently
   * sees) and leaves the lowering to the operator; leaving posture releases the
   * sit-up base so the comfort frame and buoyancy take over again.
   */
  /** Voice cues: the tablet names a clip or a sequence; audio never crosses the wire. */
  private applyVoiceCommand(command: string): void {
    if (command === 'voice:stop') {
      this.voice.stop();
      return;
    }
    if (command.startsWith('voice:play:')) {
      const id = command.slice('voice:play:'.length);
      void this.voice.play(id).then((played) => {
        if (!played) {
          this.start.setHint(`语音播放失败：${this.voice.lastError()}`);
        }
      });
      return;
    }
    if (command.startsWith('voice:seq:')) {
      const name = command.slice('voice:seq:'.length) as SequenceName;
      if (!(name in SEQUENCES)) {
        this.start.setStatus('未知语音序列', 'error');
        return;
      }
      this.voice.playSequence(name);
      return;
    }
    if (command.startsWith('voice:volume:')) {
      const percent = Number(command.slice('voice:volume:'.length));
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        this.start.setStatus('语音音量无效', 'error');
        return;
      }
      this.voice.setVolume(percent);
      return;
    }
    if (command.startsWith('voice:mix:duck:')) {
      const depth = Number(command.slice('voice:mix:duck:'.length));
      if (Number.isFinite(depth) && depth >= 0 && depth <= 18) {
        setDuckDepth(depth);
      }
      return;
    }
    if (command === 'voice:set:male' || command === 'voice:set:female') {
      this.voice.setSet(command.endsWith(':male') ? 'male' : 'female');
    }
  }

  private applySceneCommand(id: string): void {
    const definition = getSceneDefinition(id);
    if (!definition) {
      this.start.setStatus('未知场景', 'error');
      return;
    }
    if (this.session) {
      this.start.setStatus('训练中不可切换场景', 'error');
      return;
    }
    if (definition.id === this.sceneId && this.handle) {
      return;
    }
    this.sceneId = definition.id;
    this.loadScene();
    if (this.previewing) {
      this.startSceneAudio();
      this.start.showStage();
    }
    this.start.setStatus(`场景：${definition.name[this.config.lang]}`, 'ok');
    this.link.sendStateNow();
    this.updateHud(performance.now());
  }

  private applyModeCommand(value: string): void {
    if (value !== 'float' && value !== 'posture') {
      this.start.setStatus('未知模式', 'error');
      return;
    }
    if (!isActive(this.lifecycle)) {
      this.pendingMode = value;
      this.start.setStatus(value === 'posture' ? '模式：起身' : '模式：漂浮', 'ok');
      this.link.sendStateNow();
      return;
    }
    if (this.lifecycle.mode === value) {
      return;
    }
    // The two modes run in different world frames: switching mid-session would
    // snap the world by ~90°, so the mode stays a start parameter (core.md §4).
    this.report('模式只能在会话开始前选择', 'error');
  }

  /**
   * Hand the world to the frame the session mode and the scene's authored eye
   * call for. The runtime owns the decision; this is the name App uses.
   */
  private applyFrame(): void {
    this.world.apply();
  }

  /**
   * The buoyancy frame: the module owns the envelope, the gate and the writes;
   * App only says whether a headset or the preview is showing the world.
   */
  private updateFloat(dt: number): void {
    if (!this.xr.isPresenting && !this.previewing) {
      return;
    }
    this.floating.update(dt);
  }

  /** The active frame moves the world; buoyancy keeps its delta on top. */
  private setBaseFloorOffset(next: number): void {
    this.floating.setBaseOffset(next);
  }

  /**
   * Records the heading the patient is holding right now and makes it the
   * neutral (standing) world frame. There is no stability window and no
   * countdown: the technician aims the patient, the session starts, the first
   * frame's head orientation is the reference.
   */
  private beginCalibration(): void {
    if (!this.handle) {
      return;
    }
    // The capture owns the world frame until it lands, and nothing else may
    // move the world while the card asks the patient to hold still.
    this.world.hold(true);
    this.world.clearBase();
    this.viewMotion.reset();
    this.comfort?.setPosture(
      { worldPitchDeg: 0, worldRollDeg: 0, riseM: 0 },
      POSTURE_LIMITS.minDurationMs
    );
    this.input.setLayers(false, false);

    this.calibrationOverlay ??= createCalibrationOverlay({
      scene: this.scene,
      theme: DEFAULT_SPATIAL_THEME
    });
    if (this.lifecycle.phase !== 'calibrating') {
      this.lifecycle = reduceSession(
        { ...this.lifecycle, phase: 'idle' },
        { type: 'start', mode: this.pendingMode }
      );
    }
    this.calibrationOverlay.show();
    this.restartCalibration();
    this.link.sendStateNow();
  }

  /**
   * The flow the operator remembers from the earlier build: hold still, watch
   * the bar fill, done. No key is required, because the physical button never
   * reaches a page in this browser's immersive mode.
   */
  private restartCalibration(): void {
    this.calibStatus = 'settling';
    this.capturePending = true;
    this.calibration.start(performance.now());
    this.calibrationOverlay?.setHint('保持不动…');
    this.calibrationOverlay?.setProgress(0);
    this.start.setStatus('正在记录起始朝向', 'ok');
  }

  /** Called every frame while the card is up. */
  private stepCalibration(nowMs: number): void {
    const step = this.calibration.update(this.headPose.quaternion, nowMs);
    if (step.status !== this.calibStatus) {
      this.calibStatus = step.status;
      if (step.status === 'countdown') {
        this.calibrationOverlay?.setHint('即将记录…');
      }
    }
    if (step.status === 'done') {
      this.finishCalibration(step.result ?? null);
      return;
    }
    this.calibrationOverlay?.setProgress(step.progress);
  }

  private finishCalibration(result: {
    ok: boolean;
    quaternion?: { x: number; y: number; z: number; w: number };
    deviationDeg: number;
  } | null): void {
    this.capturePending = false;
    this.calibrationOverlay?.setProgress(null);
    if (!result || !result.ok || !result.quaternion) {
      // A wobbly countdown still has to produce a world frame: take the pose
      // the patient is holding right now and move on.
      this.calibrationOverlay?.setHint('使用当前朝向');
      this.applyCalibration(this.headPose.quaternion);
      return;
    }
    this.applyCalibration(result.quaternion);
  }

  private applyCalibration(orientation: { x: number; y: number; z: number; w: number }): void {
    const comfort = this.comfort;
    if (!comfort) {
      return;
    }
    const finite =
      Number.isFinite(orientation.x) &&
      Number.isFinite(orientation.y) &&
      Number.isFinite(orientation.z) &&
      Number.isFinite(orientation.w) &&
      (orientation.x !== 0 || orientation.y !== 0 || orientation.z !== 0 || orientation.w !== 0);
    if (!finite) {
      // No usable pose: leave the comfort frame alone rather than building a
      // world from zeros.
      this.calibrationOverlay?.hide();
      this.dispatch({ type: 'calibrated' });
      return;
    }
    this.calibrationOverlay?.hide();
    const position = this.headPose.position;
    const ok = comfort.calibrate({
      transform: {
        position: { x: position.x, y: position.y, z: position.z },
        orientation: {
          x: orientation.x,
          y: orientation.y,
          z: orientation.z,
          w: orientation.w
        }
      }
    });
    if (!ok) {
      this.calibrationOverlay?.setHint('这次没有取到有效朝向，请再试一次');
      this.calibrationOverlay?.show();
      return;
    }
    // Overlay down, now that the world frame is known.
    this.calibrationOverlay?.hide();
    this.input.setLayers(!this.controlMode, this.session !== null && !this.controlMode);
    this.dispatch({ type: 'calibrated' });
    // The runtime prepares the sit-up path for every session and hands the
    // world to whichever frame the mode and the scene's authored eye call for.
    this.world.calibrate(orientation, this.headPose.position);
    this.world.hold(false);
    if (this.session && this.handle) {
      this.startSceneAudio();
    }
    this.link.sendStateNow();
    this.updateHud(performance.now());
  }

  /** Bring the 3D stage up: audio, input layers, render loop. */
  private enterStage(): void {
    this.start.showStage();
    this.startSceneAudio();
    this.input.setLayers(true, true);
    this.lastFrame = 0;
    this.renderer.setAnimationLoop(this.onFrame);
  }

  /**
   * Leave the world at rest. Every way out — a session ending, a preview
   * closing, a mode command — must land here, so "no session" has one shape:
   * view recentred, sit-up base dropped, comfort frame cleared, buoyancy off.
   */
  private resetWorldToRest(): void {
    // A panel is session furniture: leaving the world at rest closes it, or a
    // stopped session would keep a SUS card floating in front of the patient.
    this.susPanel?.close();
    this.viewMotion.reset();
    this.world.clearBase();
    this.comfort?.reset();
    this.floating.setBaseOffset(0);
    this.floating.reset();
    this.calibrationOverlay?.hide();
    this.shell?.update(this.headPose.position);
    this.postureCueState?.update(0, this.headPose.position, 0);
  }

  private startPreview(): void {
    if (this.session) {
      return;
    }
    this.previewing = true;
    void unlockAudio();
    if (this.handle) {
      this.handle.root.visible = true;
    }
    this.enterStage();
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
    this.resetWorldToRest();
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
    if (this.lifecycle.phase === 'calibrating') {
      this.restartCalibration();
      return;
    }
    this.beginCalibration();
  }

  /**
   * Hand one SUS sheet to the tablet. The state frame is fixed at 20 bytes, so
   * this rides the page's JSON socket and the headset app forwards it on its
   * own characteristic; the tablet scores and persists it.
   */
  private publishSus(): void {
    const payload = buildSusPayload(this.susAnswers, {
      scene: this.sceneId,
      sessionSec:
        this.sessionStartedAt > 0
          ? (performance.now() - this.sessionStartedAt) / 1000
          : 0,
      now: Date.now()
    });
    console.info(`[sus] ${JSON.stringify(payload.answers)}`);
    this.link.sendSus(payload);
  }

  /**
   * Operator-facing line on the headset page, and the state refresh that goes
   * with it: every discrete command ends with both, so they are one call.
   */
  private report(text: string, kind: 'ok' | 'error' = 'ok', sync = true): void {
    this.start.setStatus(text, kind);
    if (sync) {
      this.link.sendStateNow();
    }
  }

  private handleRemoteCommand(raw: string): void {
    const command = parseRemoteCommand(raw);
    if (!command) {
      return;
    }
    switch (command.kind) {
      case 'eyeHeight':
        this.applyEyeHeight(command.meters);
        return;
      case 'viewOrient':
        if (!this.viewCommandsAllowed()) {
          return;
        }
        this.viewMotion.setTarget(command.lookYawDeg, command.upGazeDeg);
        return;
      case 'viewAnim':
        if (!this.viewCommandsAllowed()) {
          this.start.setStatus('当前无法播放视角动画', 'error');
          return;
        }
        this.viewMotion.play(command.name);
        return;
      case 'viewStop':
        // Hold, never recenter: only `view:anim:recenter` returns to 0°.
        this.viewMotion.stop();
        this.start.setStatus('已保持当前视角', 'ok');
        return;
      case 'scene':
        this.applySceneCommand(command.id);
        return;
      case 'mode':
        this.applyModeCommand(command.mode);
        return;
      case 'voice':
        this.applyVoiceCommand(command.command);
        return;
      case 'floatLevel': {
        const capped = this.floating.setLevel(command.level, this.sceneComfortLevel);
        this.start.setStatus(
          capped === command.level
            ? `漂浮强度 ${command.level}/${FLOAT_MAX_LEVEL}`
            : this.sceneComfortLevel < FLOAT_MAX_LEVEL
              ? `本场景最高 ${this.sceneComfortLevel} 级（垂直流动上限）`
              : `沉浸档最高 ${capped} 级（近场角速度上限）`,
          'ok'
        );
        this.link.sendStateNow();
        return;
      }
      case 'floatProfile':
        this.floating.setProfile(command.id);
        this.report(`漂浮档位：${this.floating.getProfile().label}`);
        return;
      case 'floatBreath':
        this.floating.setBreath(command.on);
        this.report(command.on ? '呼吸层已开启' : '呼吸层已关闭', 'ok');
        return;
      case 'riseDuration':
        this.world.setDuration(command.ms);
        this.report(`起身时长 ${(command.ms / 1000).toFixed(0)} 秒`, 'ok');
        return;
      case 'cueIntensity':
        this.postureCueState?.setIntensity(command.value);
        return;
      case 'gazeDwell':
        this.gazeDwellEnabled = command.on;
        this.susPanel?.setDwellEnabled(command.on);
        this.report(command.on ? '目视选择已开启' : '目视选择已关闭', 'ok');
        return;
      case 'susOpen':
        this.openSus();
        return;
      case 'susClose':
        this.susPanel?.close();
        return;
      case 'susShow':
        this.openSus();
        this.susPanel?.show(command.index - 1);
        return;
      case 'susMove':
        this.susPanel?.move(command.delta);
        return;
      case 'susAnswer':
        this.susPanel?.answer(command.value);
        return;
      case 'preview':
        this.startPreview();
        return;
      case 'calibrate':
        this.recalibrate();
        return;
      case 'exit':
        this.exitAll();
        return;
      case 'audio':
        this.applySceneBed(
          command.state === 'toggle' ? !this.sceneBedOn : command.state === 'on'
        );
        return;
      case 'posture':
        if (command.target === 'stop') {
          // The capture already drives posture to neutral; do not freeze it.
          if (!this.capturePending) {
            this.stopSitUp();
          }
          return;
        }
        this.setVirtualPosture(command.target === 'rise');
        return;
      case 'cue':
        this.postureCueState?.setEnabled(command.on);
        return;
      case 'status':
        // The link refreshes the readback after every discrete command, so a
        // newly claiming controller is never left with a stale snapshot.
        return;
      case 'start':
        this.start.setStatus(this.strings.remoteStartNeedsGesture, 'ok');
        return;
      case 'invalid':
        this.start.setStatus(command.message, 'error');
        return;
      case 'unknown':
        this.start.setStatus(`${this.strings.remoteUnknown}: ${raw}`, 'error');
        return;
    }
  }

  /** `settings:eyeheight:<m>`: the parser already rejected bad payloads. */
  private applyEyeHeight(next: number): void {
    if (this.capturePending) {
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
      this.world.setEyeHeight(next);
    }
    this.start.setStatus(`视点高度 ${next.toFixed(2)} m`, 'ok');
  }

  /** Rejected during calibration and whenever the patient is not in XR. */
  private viewCommandsAllowed(): boolean {
    return this.session !== null
      && this.xr.isPresenting
      && !this.capturePending;
  }

  /**
   * Socket faults are visible to the operator: a drop after a working link
   * reads as the tablet link being gone. The motion halt itself is owned by
   * the link (it resets control mode) and by setControlMode below.
   */
  private handleLinkStatus(status: 'open' | 'closed'): void {
    const wasOnline = this.linkOnline;
    this.linkOnline = status === 'open';
    // The entry screen carries the link state: without it a dead socket looks
    // exactly like a silent headset.
    this.start.setHint(status === 'open' ? '已连接控制端' : '控制端未连接（等待重连）');
    if (status === 'open' || !wasOnline) {
      return;
    }
    this.dispatch({ type: 'stop', reason: 'link-lost' });
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
      this.dispatch({ type: 'stop', reason: 'link-lost' });
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
    // The rise animates the sit-up frame, which is a different world frame from
    // the calibrated one the floating mode runs in. Switching under the patient
    // would snap the world; the mode selector is the sanctioned way across.
    if (this.lifecycle.mode !== 'posture') {
      this.start.setStatus('虚拟起身在起身模式中可用，请先切换模式', 'error');
      return;
    }
    if (!this.session || !this.world.state().sitUpReady) {
      this.start.setStatus('虚拟起身仅能在完成校准后的训练中使用', 'error');
      return;
    }
    if (this.capturePending) {
      this.start.setStatus('校准中无法调整姿态', 'error');
      return;
    }
    this.world.rise(rising ? 1 : 0);
    this.start.setStatus(rising ? '虚拟起身中，随时可停止' : '正在回到卧床视角', 'ok');
  }

  private stopSitUp(): void {
    if (!this.world.state().posturePosesBase) {
      return;
    }
    this.world.stopRise();
    this.start.setStatus('已停止虚拟起身', 'ok');
  }

  private applySceneBed(on: boolean): void {
    this.sceneBedOn = on;
    if (on) {
      this.startSceneAudio();
    } else {
      this.stopSceneAudio();
    }
    this.link.sendStateNow();
    this.updateHud(performance.now());
  }

  private startSceneAudio(): void {
    if (!this.sceneBedOn) {
      return;
    }
    playSceneAudio(this.host.definition?.audio);
  }

  private stopSceneAudio(): void {
    stopAudio();
  }

  private onSelectStart(): void {
    // The press itself is not an action; `selectend`/`select` decide.
  }

  private onSelectEnd(source: string = 'xr'): void {
    // One action per press regardless of how many event shapes the runtime
    // delivers (selectstart/selectend/select, plus the DOM fallbacks).
    const now = performance.now();
    if (now - this.selectHandledAt < 250) {
      return;
    }
    this.selectHandledAt = now;
    this.onSelectShort(source);
  }

  /** Firefox emits `select` after `selectend`; this is only a fallback. */


  /**
   * The only in-headset click: start (after calibration) or stop the session.
   * It never switches mode. Scene targets are still chosen by 6 s gaze dwell.
   */
  private onSelectShort(source: string = 'xr'): void {
    if (this.lifecycle.phase === 'calibrating') {
      // The flow runs by itself; a confirm simply ends the wait early.
      this.calibrationOverlay?.setHint(`确认来源：${source}`);
      this.applyCalibration(this.headPose.quaternion);
      return;
    }
    // Outside a session the confirm key is the entry gesture; nothing else.
    if (isActive(this.lifecycle)) {
      this.dispatch({ type: 'confirm' });
    }
  }

  private onFrame = (frameTime?: number): void => {
    // The XR frame timestamp is the one the compositor will present; reading
    // performance.now() here mixes two clocks and jitters the easing.
    const now = frameTime !== undefined ? frameTime : performance.now();
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
      this.host.definition?.name[this.config.lang] ?? SCENE.name[this.config.lang],
      calibrationState,
      '1.25x',
      triangles,
      draws,
      `p95 ${budget.p95Ms.toFixed(0)}ms`,
      this.sceneBedOn ? '水声开' : '水声关'
    ].join('  ');
    this.hud.setStats(this.fps, summary);
  }

  /**
   * Flow gate for the near-field cue: +1 only while a rising transition is
   * actually moving. Lowering, braking, stop, calibration and lease loss all
   * report 0, which freezes the motes and fades them with the cue's own τ.
   */
  private computeCueFlow(): number {
    if (this.capturePending) {
      return 0;
    }
    const posture = this.world.state();
    if (posture.posturePosesBase && posture.sitUpMoving) {
      // The rise owns the scene while it runs. Lowering (or a stopped ramp)
      // freezes the motes: only rising reads as weightlessness.
      if (posture.sitUpTarget <= posture.sitUpT) {
        return 0;
      }
      const rate = posture.path?.pitchRateAt(posture.sitUpT, SITUP_DURATION_MS) ?? 0;
      return Math.max(CUE_IDLE_FLOW, Math.min(1, rate / CUE_FULL_DEG_PER_S));
    }
    // Everything else — both modes, both frames — is driven by the buoyancy.
    // Gating this on "the sit-up does not pose the base" froze the light well's
    // rings for a whole session, which read as a still image glued to the view.
    const comfort = this.comfort;
    if (comfort?.isPostureMoving()) {
      return comfort.getPosturePhase() === 'rising' ? 1 : 0;
    }
    return this.floating.getFlow();
  }

  /** Collect the facts telemetry, the HUD and command handlers all read. */
  /**
   * One collected view of the world for the state frame. Built as a literal —
   * it is sent at ≤10 Hz, and a field-by-field mutation of a reused object was
   * 40 lines of assignments whose only benefit was avoiding one allocation.
   */
  private captureSnapshot(): SceneSnapshot {
    const world = this.world.state();
    const motion = this.floating.getState();
    const comfort = this.comfort;
    const shell = this.shell;
    const comfortState = comfort?.getState();
    // The mirror must see the same world the patient sees: shell (view) times
    // base (comfort calibration or sit-up inverse), not just the head pose.
    if (shell) {
      this.worldQuat.copy(shell.group.quaternion).multiply(shell.base.quaternion);
    } else {
      this.worldQuat.identity();
    }
    this.worldEuler.setFromQuaternion(this.worldQuat, 'XYZ');
    const cue = this.postureCueState?.getState();
    const playing = this.voice.nowPlaying().id;
    return this.snapshot.capture({
      sceneId: this.sceneId,
      loaded: this.handle !== null,
      session: this.session !== null,
      calibrating: this.lifecycle.phase === 'calibrating',
      calibrated: comfort?.isCalibrated() ?? false,
      postureMode: this.lifecycle.mode === 'posture',
      audioMuted: !this.sceneBedOn,
      eyeHeight: this.eyeHeight,
      worldYawDeg: THREE.MathUtils.radToDeg(this.worldEuler.y),
      worldPitchDeg: THREE.MathUtils.radToDeg(this.worldEuler.x),
      worldRollDeg: THREE.MathUtils.radToDeg(this.worldEuler.z),
      confidence: comfortState?.remap?.confidence ?? (comfortState?.calibrated ? 1 : 0),
      sitUp: world.posturePosesBase ? world.path : null,
      sitUpT: world.sitUpT,
      sitUpTarget: world.sitUpTarget,
      sitUpMoving: world.sitUpMoving,
      posture: comfort?.getPostureState() ?? null,
      baseQuaternion: shell ? shell.base.quaternion : this.identityQuaternion,
      baseReferenceQuaternion: world.posturePosesBase
        ? world.base0
        : comfort
          ? comfort.getCalibrationQuaternion(this.calibrationFrame)
          : this.identityQuaternion,
      lookYawDeg: this.viewMotion.getLookYawDeg(),
      lookYawTargetDeg: this.viewMotion.getTargetLookYawDeg(),
      upGazeDeg: this.viewMotion.getUpGazeDeg(),
      upGazeTargetDeg: this.viewMotion.getTargetUpGazeDeg(),
      viewAnim: this.viewMotion.getStateName(),
      viewPreset: presetCode(this.viewMotion.getPresetId()),
      floorOffset: this.host.floor,
      cueFlow: this.cueFlow,
      cueEnabled: cue?.enabled ?? false,
      cueIntensity: cue?.intensity ?? 0,
      floatLevel: motion.level,
      floatProfile: motion.profile,
      // Applied motion, not the requested level: the mirror adds these verbatim.
      floatMm: motion.offsetM * 1000,
      swayDeg: motion.swayDeg,
      sessionSec:
        this.sessionStartedAt > 0
          ? Math.floor((performance.now() - this.sessionStartedAt) / 1000)
          : 0,
      voiceId: playing ? this.voice.indexOf(playing) : -1
    });
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
