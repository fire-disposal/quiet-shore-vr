import * as THREE from 'three';
import { EYE_HEIGHT_MAX, EYE_HEIGHT_MIN, readConfig, type AppConfig } from './config';
import { createRenderer } from '../core/xr/renderer';
import { readHeadPose } from '../core/xr/pose';
import { SitUpPath, type CameraPose } from '../core/xr/situp-path';
import { createSitUpMotion } from '../core/xr/situp-run';
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
import { createCalibrationSampler } from '../core/xr/calibration-sample';
import { getStrings, type Strings } from '../ui/strings';
import {
  disposeAudio,
  playSceneAudio,
  preloadSceneAudio,
  setAudioMuted,
  setBuoyancySwell,
  setDuckDepth,
  stopAudio,
  toggleMuted,
  unlockAudio
} from '../audio/audio';
import { createVoicePlayer, SEQUENCES, type SequenceName } from '../audio/voice';
import { createPostureCue } from '../core/xr/posture-cue';
import type { PostureCueApi } from '../core/xr/posture-cue';
import {
  DEFAULT_FLOAT_PROFILE,
  FLOAT_PROFILES,
  FLOAT_LEVEL_CAP,
  FLOAT_MAX_LEVEL,
  easeAmplitude,
  floatAmplitudeForLevel,
  floatOffsetAt,
  floatPitchAt,
  isFloatProfileId,
  type FloatProfile
} from '../core/xr/float';
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
/** How deep the water bed breathes with the buoyancy; 0.12 is audible, not pumping. */
const SWELL_AUDIO_DEPTH = 0.12;
/** The stable window the operator (or the patient's button) starts. */
/** Hold-still window before the countdown starts (1.2 s × 1.5). */
const CALIBRATION_HOLD_MS = 1800;
/** Countdown, also the averaging window (2 s × 1.5). */
const CALIBRATION_COUNTDOWN_MS = 3000;
/** Spread allowed inside that window before it is rejected. */
const CALIBRATION_MAX_DEVIATION_DEG = 6;
/** The card must stay readable even when the sample lands immediately. */
const CALIBRATION_MIN_VISIBLE_MS = 2500;
/** Buoyancy fade constant: the visible heave is gone inside a second. */
const FLOAT_FADE_TAU_S = 0.25;
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
  private readonly voice = createVoicePlayer();
  /** Wall clock at motion onset; 0 while idle. Drives the reported session clock. */
  private sessionStartedAt = 0;
  private readonly voiceTimers: number[] = [];
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
    postureMode: false,
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
    cueIntensity: 0,
    floatLevel: 1,
    floatProfile: 'b',
    floatMm: 0,
    swayDeg: 0,
    sessionSec: 0,
    voiceId: -1
  };
  private controlMode = false;

  private eyeHeight: number;
  private cueFlow = 0;

  /** Mode the next session starts in; set before a session, never during one. */
  private pendingMode: 'float' | 'posture' = 'float';
  private handle: SceneHandle | null = null;
  private comfort: ComfortApi | null = null;
  private shell: WorldShellApi | null = null;
  private capturePending = false;
  private captureAttempts = 0;
  /** Wall clock when the stable window started; drives the card's bar. */
  private samplingStartedAt = 0;
  private calibPhase: 'settling' | 'countdown' = 'settling';
  private calibRef: THREE.Quaternion | null = null;
  private calibStableMs = 0;
  private calibCountdownAt = 0;
  private lastCalibrationFrame = 0;
  private readonly calibrationSampler = createCalibrationSampler({
    durationMs: CALIBRATION_COUNTDOWN_MS,
    maxDeviationDeg: CALIBRATION_MAX_DEVIATION_DEG
  });
  /** Technician's buoyancy choice, 0..FLOAT_MAX_LEVEL. */
  private floatLevel = 1;
  /** Which buoyancy profile is active; chosen in the room, not on a desk. */
  private floatProfile: FloatProfile = FLOAT_PROFILES[DEFAULT_FLOAT_PROFILE];
  /** Eased amplitude actually applied; drops to 0 on stop. */
  private floatAmplitude = 0;
  /** Seconds of continuous drift; kept while fading so the phase never jumps. */
  private floatSeconds = 0;
  /** Breathing layer on the heave; the strongest cheap buoyancy cue. */
  private floatBreath = true;
  /** Sit-up ramp length; the operator can slow it down for comfort. */
  private sitUpDurationMs = SITUP_DURATION_MS;
  /** Last non-zero buoyancy offset written, or 0 once settled. */
  private floatOffsetApplied = 0;
  /** Last horizon sway written, in degrees, or 0 once settled. */
  private floatSwayApplied = 0;
  private postureCueState: PostureCueApi | null = null;
  private susPanel: SusPanelApi | null = null;
  private calibrationOverlay: CalibrationOverlayApi | null = null;
  /** Operator switch for gaze dwell; on by default per product decision. */
  private gazeDwellEnabled = true;
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
  private headPose: HeadPose = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion()
  };
  /** Debounce for the single physical confirm: `select*` plus DOM fallbacks. */
  private selectHandledAt = 0;
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
    if (isFloatProfileId(this.config.floatProfile)) {
      this.floatProfile = FLOAT_PROFILES[this.config.floatProfile];
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
        this.sitUpMotion.moving ||
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
        if (this.lifecycle.phase === 'calibrating' && this.xr.isPresenting) {
          this.stepCalibration(performance.now());
        }
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
    const handle = this.host.load(definition, {
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
    this.sitUpPath = null;
    this.sitUpReference = null;
    this.sitUpMode = false;
    this.sitUpReady = false;
    this.sitUpMotion.reset();
    this.host.setFloorOffset(this.session ? -this.eyeHeight : 0);
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
      this.host.setFloorOffset(0);
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
    this.viewMotion.reset();
    this.sitUpMode = false;
    this.sitUpReady = false;
    this.sitUpPath = null;
    this.sitUpReference = null;
    this.sitUpMotion.reset();
    this.sitUpBase0.identity();
    this.stopSceneAudio();
    // A session that ends during calibration must take the overlay with it.
    this.calibrationOverlay?.hide();
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
          this.start.setStatus(`SUS ${index + 1} = ${value}`, 'ok');
        }
      });
      this.susPanel.setDwellEnabled(this.gazeDwellEnabled);
    }
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
    if (value === 'posture') {
      this.armPostureAt(1);
    } else {
      this.stopSitUp();
      this.sitUpMode = false;
      this.sitUpReady = false;
      this.sitUpPath = null;
      this.sitUpReference = null;
      this.shell?.setBasePose(null);
      this.host.setFloorOffset(this.xr.isPresenting ? -this.eyeHeight : 0);
    }
    this.dispatch({ type: 'mode', mode: value });
    this.start.setStatus(value === 'posture' ? '已切到起身' : '已切回漂浮', 'ok');
    this.link.sendStateNow();
    this.updateHud(performance.now());
  }

  /** Arms the sit-up layer at [t] (0 = supine, 1 = standing) with no motion. */
  private armPostureAt(t: number): void {
    this.sitUpPath = new SitUpPath({ standEyeHeight: this.eyeHeight });
    this.sitUpReference = {
      position: this.headPose.position.clone(),
      quaternion: this.headPose.quaternion.clone()
    };
    this.sitUpMotion.reset();
    this.sitUpMotion.seek(t);
    this.sitUpMode = true;
    this.sitUpReady = true;
    this.applySitUpTransform();
    this.host.setFloorOffset(0);
  }

  /**
   * Applies the buoyancy layer. Only the floating phase drives it; posture mode
   * and every stop path ease the amplitude to zero, so the world settles in
   * under a second instead of snapping.
   */
  private updateFloat(dt: number): void {
    if (!this.xr.isPresenting && !this.previewing) {
      return;
    }
    // Buoyancy belongs to lying down. Once the sit-up layer leaves the supine
    // pose, the posture path owns the base and the heave stops.
    const lying = this.sitUpMotion.t <= 0.02 && !this.sitUpMotion.moving;
    const active = this.lifecycle.phase !== 'stopping' && this.lifecycle.phase !== 'idle' && lying;
    const target = active ? floatAmplitudeForLevel(this.floatProfile, this.floatLevel) : 0;
    this.floatAmplitude = easeAmplitude(this.floatAmplitude, target, dt, FLOAT_FADE_TAU_S);
    if (this.floatAmplitude <= 0 && target === 0) {
      this.floatAmplitude = 0;
      // Settle exactly once, so an idle scene pays nothing per frame.
      if (this.floatOffsetApplied !== 0 || this.floatSwayApplied !== 0) {
        this.floatOffsetApplied = 0;
        this.floatSwayApplied = 0;
        this.host.setFloorOffset(this.xr.isPresenting ? -this.eyeHeight : 0);
        if (this.handle?.applyBuoyancy) {
          this.handle.applyBuoyancy({ amountM: 0, swayDeg: 0 });
        } else {
          this.host.content.rotation.x = 0;
        }
      }
      return;
    }
    this.floatSeconds += dt;
    if (!lying) {
      // Sitting up hands the world base to the posture path; the heave stops.
      setBuoyancySwell(0, this.floatProfile.periodS);
      return;
    }
    // The swell follows the visible heave: same period, depth scaled by how
    // much of the envelope is currently in use.
    setBuoyancySwell(
      (this.floatAmplitude / this.floatProfile.amplitudeM) * SWELL_AUDIO_DEPTH,
      this.floatProfile.periodS
    );
    const base = this.xr.isPresenting ? -this.eyeHeight : 0;
    this.floatOffsetApplied = floatOffsetAt(
      this.floatProfile,
      this.floatSeconds,
      this.floatAmplitude,
      this.floatBreath
    );
    // Horizon sway: a couple of degrees of world pitch, in phase with the
    // drift, is what makes the horizon feel unmoored rather than the floor.
    const swayDeg = floatPitchAt(this.floatProfile, this.floatSeconds, this.floatAmplitude);
    this.floatSwayApplied = swayDeg;
    if (this.handle?.applyBuoyancy) {
      // The scene owns the depth order, so it decides what moves. Moving the
      // whole content instead leaves the sky (the only thing a supine patient
      // looks at) effectively still.
      this.host.setFloorOffset(base);
      this.handle.applyBuoyancy({ amountM: this.floatOffsetApplied, swayDeg });
    } else {
      this.host.setFloorOffset(base + this.floatOffsetApplied);
      this.host.content.rotation.x = THREE.MathUtils.degToRad(swayDeg);
    }
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
    // The capture owns the world frame until it lands.
    this.sitUpMode = false;
    this.sitUpReady = false;
    this.sitUpPath = null;
    this.sitUpReference = null;
    this.sitUpMotion.reset();
    this.sitUpBase0.identity();
    this.viewMotion.reset();
    this.shell?.setBasePose(null);
    this.comfort?.setPosture(
      { worldPitchDeg: 0, worldRollDeg: 0, riseM: 0 },
      POSTURE_LIMITS.minDurationMs
    );
    this.input.setLayers(false, false);

    this.calibrationOverlay ??= createCalibrationOverlay({
      scene: this.scene,
      theme: DEFAULT_SPATIAL_THEME
    });
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
    this.calibPhase = 'settling';
    this.calibRef = null;
    this.calibStableMs = 0;
    this.calibCountdownAt = 0;
    this.lastCalibrationFrame = 0;
    this.capturePending = true;
    this.calibrationOverlay?.setHint('保持不动…');
    this.calibrationOverlay?.setProgress(0);
    this.calibrationSampler.reset();
    this.start.setStatus('正在记录起始朝向', 'ok');
  }

  /** Called every frame while the card is up. */
  private stepCalibration(nowMs: number): void {
    const head = this.headPose.quaternion;
    if (this.calibPhase === 'settling') {
      if (!this.calibRef) {
        this.calibRef = head.clone();
      }
      const dot = Math.abs(
        this.calibRef.x * head.x +
          this.calibRef.y * head.y +
          this.calibRef.z * head.z +
          this.calibRef.w * head.w
      );
      const deviation = (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
      if (deviation > CALIBRATION_MAX_DEVIATION_DEG) {
        // Moved: restart the window from the new pose instead of failing.
        this.calibRef = head.clone();
        this.calibStableMs = 0;
      } else if (this.lastCalibrationFrame > 0) {
        this.calibStableMs += nowMs - this.lastCalibrationFrame;
      }
      this.lastCalibrationFrame = nowMs;
      this.calibrationOverlay?.setProgress(
        Math.min(1, this.calibStableMs / CALIBRATION_HOLD_MS)
      );
      if (this.calibStableMs >= CALIBRATION_HOLD_MS) {
        this.calibPhase = 'countdown';
        this.calibCountdownAt = nowMs;
        this.calibrationSampler.start(nowMs);
        this.calibrationOverlay?.setHint('即将记录…');
      }
      return;
    }

    this.calibrationSampler.add(head, nowMs);
    const elapsed = nowMs - this.calibCountdownAt;
    this.calibrationOverlay?.setProgress(Math.min(1, elapsed / CALIBRATION_COUNTDOWN_MS));
    if (elapsed >= CALIBRATION_COUNTDOWN_MS) {
      const result = this.calibrationSampler.add(head, nowMs);
      this.finishCalibration(result);
    }
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
    // The sit-up layer is armed for every session: rising to a standing view is
    // the core of the standing-voiding scenario and the operator must be able
    // to call it at any time.
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
    if (this.session && this.handle) {
      this.startSceneAudio();
    }
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
    if (this.lifecycle.phase === 'calibrating') {
      this.restartCalibration();
      return;
    }
    this.beginCalibration();
  }

  private handleRemoteCommand(raw: string): void {
    const command = raw.trim().toLowerCase();
    if (!command) {
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
    if (command.startsWith('scene:')) {
      this.applySceneCommand(command.slice('scene:'.length));
      return;
    }
    if (command.startsWith('mode:')) {
      this.applyModeCommand(command.slice('mode:'.length));
      return;
    }
    if (command.startsWith('voice:')) {
      this.applyVoiceCommand(command);
      return;
    }
    if (command.startsWith('float:level:')) {
      const level = Number(command.slice('float:level:'.length));
      if (!Number.isInteger(level) || level < 0 || level > FLOAT_MAX_LEVEL) {
        this.start.setStatus('漂浮强度无效', 'error');
        return;
      }
      const capped = Math.min(level, FLOAT_LEVEL_CAP[this.floatProfile.id]);
      this.floatLevel = capped;
      this.start.setStatus(
        capped === level
          ? `漂浮强度 ${level}/${FLOAT_MAX_LEVEL}`
          : `沉浸档最高 ${capped} 级（近场角速度上限）`,
        'ok'
      );
      this.link.sendStateNow();
      return;
    }
    if (command.startsWith('float:profile:')) {
      const id = command.slice('float:profile:'.length);
      if (!isFloatProfileId(id)) {
        this.start.setStatus('未知漂浮档位', 'error');
        return;
      }
      this.floatProfile = FLOAT_PROFILES[id];
      // Switching to a stricter profile must also pull the level back down.
      const capped = Math.min(this.floatLevel, FLOAT_LEVEL_CAP[id]);
      if (capped !== this.floatLevel) {
        this.floatLevel = capped;
      }
      this.start.setStatus(`漂浮档位：${this.floatProfile.label}`, 'ok');
      this.link.sendStateNow();
      return;
    }
    if (command === 'float:breath:on' || command === 'float:breath:off') {
      this.floatBreath = command.endsWith(':on');
      this.start.setStatus(this.floatBreath ? '呼吸层已开启' : '呼吸层已关闭', 'ok');
      this.link.sendStateNow();
      return;
    }
    if (command.startsWith('anim:duration:')) {
      const ms = Number(command.slice('anim:duration:'.length));
      if (!Number.isFinite(ms) || ms < 4000 || ms > 20000) {
        this.start.setStatus('时长超出范围', 'error');
        return;
      }
      this.sitUpDurationMs = Math.round(ms);
      this.sitUpMotion.setDuration(this.sitUpDurationMs);
      this.start.setStatus(`起身时长 ${(this.sitUpDurationMs / 1000).toFixed(0)} 秒`, 'ok');
      this.link.sendStateNow();
      return;
    }
    if (command.startsWith('cue:intensity:')) {
      const value = Number(command.substring('cue:intensity:'.length));
      if (Number.isFinite(value) && value >= 0 && value <= 1) {
        this.postureCueState?.setIntensity(value);
      }
      return;
    }
    if (command === 'gaze:dwell:on' || command === 'gaze:dwell:off') {
      this.gazeDwellEnabled = command.endsWith(':on');
      this.susPanel?.setDwellEnabled(this.gazeDwellEnabled);
      this.start.setStatus(this.gazeDwellEnabled ? '目视选择已开启' : '目视选择已关闭', 'ok');
      this.link.sendStateNow();
      return;
    }
    if (command === 'sus:open') {
      this.openSus();
      return;
    }
    if (command === 'sus:close') {
      this.susPanel?.close();
      return;
    }
    if (command.startsWith('sus:show:')) {
      const index = Number(command.slice('sus:show:'.length));
      if (Number.isInteger(index)) {
        this.openSus();
        this.susPanel?.show(index - 1);
      }
      return;
    }
    if (command === 'sus:next' || command === 'sus:prev') {
      this.susPanel?.move(command === 'sus:next' ? 1 : -1);
      return;
    }
    if (command.startsWith('sus:answer:')) {
      const value = Number(command.slice('sus:answer:'.length));
      if (Number.isInteger(value) && value >= 1 && value <= 5) {
        this.susPanel?.answer(value);
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
        if (this.capturePending) {
          // The capture already drives posture to neutral; do not freeze it.
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
    if (!this.session || !this.sitUpMode || !this.sitUpPath) {
      this.start.setStatus('虚拟起身仅能在完成校准后的训练中使用', 'error');
      return;
    }
    if (this.capturePending) {
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
    playSceneAudio(SCENE.audio);
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
    if (this.capturePending) {
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
      // In float mode the motes rise with the buoyancy: amplitude over the
      // envelope is the flow, so a stopped drift fades them out with the cue's
      // own tau instead of cutting them.
      return this.floatAmplitude > 0
        ? Math.min(1, this.floatAmplitude / this.floatProfile.amplitudeM)
        : 0;
    }
    return comfort.getPosturePhase() === 'rising' ? 1 : 0;
  }

  /** Collect the facts telemetry, the HUD and command handlers all read. */
  private captureSnapshot(): SceneSnapshot {
    const input = this.snapshotInput;
    input.sceneId = this.sceneId;
    input.loaded = this.handle !== null;
    input.session = this.session !== null;
    input.calibrating = this.lifecycle.phase === 'calibrating';
    input.calibrated = this.comfort?.isCalibrated() ?? false;
    input.postureMode = this.lifecycle.mode === 'posture';
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
    // Applied motion, not the requested level: the mirror adds these verbatim.
    input.floatMm = this.floatOffsetApplied * 1000;
    input.swayDeg = this.floatSwayApplied;
    input.sessionSec = this.sessionStartedAt > 0
      ? Math.floor((performance.now() - this.sessionStartedAt) / 1000)
      : 0;
    const playing = this.voice.nowPlaying().id;
    input.voiceId = playing ? this.voice.indexOf(playing) : -1;
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
    input.floatLevel = this.floatLevel;
    input.floatProfile = this.floatProfile.id;
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
