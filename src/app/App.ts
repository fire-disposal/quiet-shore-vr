import * as THREE from 'three';
import { readConfig, type AppConfig } from './config';
import { createRenderer } from '../core/xr/renderer';
import { readHeadPose } from '../core/xr/pose';
import {
  createComfort,
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
import { SubtitleCard } from '../ui/subtitle-card';
import { createSusPanel, type SusPanelApi } from '../ui/sus-panel';
import { createCalibrationOverlay, type CalibrationOverlayApi } from '../ui/calibration-overlay';
import { createCalibrationRun, type CalibrationStatus } from './calibration-run';
import { getStrings, type Strings } from '../ui/strings';
import {
  disposeAudio,
  playSceneAudio,
  preloadSceneAudio,
  setDuckDepth,
  stopAudio,
  unlockAudio
} from '../audio/audio';
import { createVoicePlayer, SEQUENCES, type SequenceName } from '../audio/voice';
import { createPostureCue } from '../core/xr/posture-cue';
import type { PostureCueApi } from '../core/xr/posture-cue';
import { FLOAT_MAX_LEVEL, isFloatProfileId } from '../core/xr/float';
import { visualUpInContent } from '../core/xr/world-frame';
import { createFloating, type FloatingApi } from './floating';
import { createWorldRuntime, type WorldRuntimeApi } from './world-runtime';
import { planMotion, type MotionPlan } from './motion-plan';
import { parseRemoteCommand } from './commands';
import { buildSusPayload } from './sus';
import { RenderMonitor } from '../core/performance/render-monitor';
import { PortalLink, stateFromSnapshot } from './portal-link';
import { primeVoiceRoute } from '../audio/voice';
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
  private readonly worldPos = new THREE.Vector3();
  private readonly worldEuler = new THREE.Euler(0, 0, 0, 'XYZ');
  private readonly viewMotion: ViewMotionControllerApi;
  private readonly snapshot = new SceneSnapshot();
  /** The one description of applied motion and what may still be asked. */
  private plan: MotionPlan | null = null;
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
  /** Dev-only flow override for scene inspection (see `debug.flow`). */
  private previewFlow: number | null = null;
  /** Buoyancy: level, profile, envelope and the content offset it rides on. */
  private readonly floating: FloatingApi;
  /** Base pose: calibration frame, sit-up path and the placement that goes with them. */
  private readonly world: WorldRuntimeApi;
  /** Scratch for the visual-up axis and the frame plan; per-frame, no allocation. */
  private readonly visualUp = new THREE.Vector3();
  /** Scratch for the composed parent rotation (shell x base) of the content. */
  private readonly parentQuaternion = new THREE.Quaternion();
  /** Sit-up ramp length; the operator can slow it down for comfort. */
  private postureCueState: PostureCueApi | null = null;
  private susPanel: SusPanelApi | null = null;
  /** SUS statements are read aloud unless the operator turns it off. */
  private susVoice = true;
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
  /** Scene bed (water sound) default: on, at half the authored loudness. */
  private sceneBedOn = true;
  private lastFrame = 0;
  private elapsed = 0;
  private frames = 0;
  /**
   * Frame-clock survey. The dwell fired at ~2 s while the SUS panel asked for
   * 5 s, so the compositor timestamp and `performance.now()` may not tick at
   * the same rate. Sampling both per frame gives the ratio directly instead of
   * guessing it from a stopwatch.
   */
  private readonly clockSurvey = {
    firstFrame: 0,
    firstWall: 0,
    lastFrame: 0,
    lastWall: 0,
    frames: 0,
    ratio: 1
  };
  private clockWarned = false;
  private fps = 0;
  private fpsAt = 0;
  private hudAt = 0;
  /** Subtitle card: the line the voice is speaking, below the centre. */
  private subtitleCard: SubtitleCard | null = null;
  /** Operator switch (tablet voice page). On by default. */
  private subtitlesOn = true;
  /** Line text by cue id, from `/voice/lines.json`. */
  private readonly voiceTexts = new Map<string, string>();
  /** Id last drawn on the card; `undefined` forces a redraw. */
  private lastSubtitleId: string | null | undefined = undefined;
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
      // The axis must undo **every** parent rotation, not just the base: the
      // shell's view pitch sits on top of the base, so with the operator's
      // up-gaze at 30 degrees a heave computed from the base alone would tilt
      // 30 degrees in the patient's view. Compose shell x base, invert once.
      axis: (out) => {
        const shell = this.shell;
        if (!shell) {
          return out.set(0, 1, 0);
        }
        this.parentQuaternion.copy(shell.group.quaternion).multiply(shell.base.quaternion);
        return visualUpInContent(this.headPose.quaternion, this.parentQuaternion, out);
      },
      level: this.config.floatLevel,
      profile: isFloatProfileId(this.config.floatProfile) ? this.config.floatProfile : undefined,
      breath: true,
      // The big heave is the lake's 飘浮; the other scenes keep the breath
      // swell only, so a tiled room or the shaft never sways like water.
      heaveScale: () => (this.sceneId === 'shore' ? 1 : 0)
    });
    // The base pose owner sits on top of buoyancy: it decides which frame poses
    // the world and hands the frame's offset to the buoyancy module.
    this.world = createWorldRuntime({
      comfort: () => this.comfort,
      setBaseOffset: (y) => this.floating.setBaseOffset(y)
    });
    this.input = new SpatialInput(
      this.camera,
      this.scene,
      DEFAULT_SPATIAL_THEME,
      this.strings.dwellHint
    );
    this.hud = new SpatialHud(this.scene, DEFAULT_SPATIAL_THEME);
    this.subtitleCard = new SubtitleCard(this.scene, DEFAULT_SPATIAL_THEME);
    void this.loadVoiceTexts();
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
        // Driven by the capture flag, not by the card's visibility: a hidden
        // card must never be able to keep `capturePending` latched forever.
        if (this.capturePending && this.xr.isPresenting) {
          this.stepCalibration(performance.now());
        }
      }
    });
    this.pipeline.add({
      id: 'view-motion',
      phase: 'render',
      order: 0,
      // Easing lives in the controller; the shell only composes transforms.
      run: (dt: number) => {
        this.viewMotion.update(dt);
        this.shell?.update(this.headPose.position);
      }
    });
    this.pipeline.add({
      id: 'world-motion',
      phase: 'render',
      order: 1,
      run: (dt: number, now: number) => {
        // One owner: the runtime advances the sit-up ramp or the comfort
        // posture, and never both.
        this.world.update(dt);
        this.cueFlow = this.computeCueFlow();
        this.handle?.setFlow?.(this.cueFlow);
        this.postureCueState?.update(dt, this.headPose.position, this.cueFlow);
        this.updateFloat(dt);
        this.susPanel?.update(dt, now, this.headPose);
        // The reticle doubles as the gaze cue while the SUS panel is open.
        this.input.setReticleAlways(this.susPanel?.isOpen() ?? false);
        this.updateMotionPlan();
        this.syncSubtitle();
        this.subtitleCard?.update(this.headPose, dt, now);
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
          correctionMix: this.world.state().mix,
          correctionMoving: this.world.state().moving,
          baseFloorOffset: this.floating.getState().baseOffset,
          bobM: this.floating.getState().offsetM,
          swayDeg: 0, // retired channel: the world never tilts
          contentY: this.host.content.position.y,
          upGazeDeg: this.viewMotion.getUpGazeDeg()
        }),
        /**
         * Desktop check: hold the scene flow (0..1) so a scene's own animation
         * can be inspected without a session. `null` returns control to the
         * buoyancy.
         */
        flow: (value: number | null) => {
          this.previewFlow = value === null ? null : Math.min(1, Math.max(0, value));
          return this.previewFlow;
        },
        /**
         * Desktop check: open the buoyancy gate without a real session, so the
         * vertical motion can be measured on a desk. Never reachable outside
         * `?debug=1`; it writes the same lifecycle the field path writes.
         */
        session: (on: boolean, mode: 'float' | 'posture' = 'float') => {
          this.lifecycle = on
            ? { phase: mode === 'posture' ? 'posture' : 'floating', mode, stopReason: null }
            : INITIAL_SESSION;
          return { phase: this.lifecycle.phase, mode: this.lifecycle.mode };
        },
        /**
         * Desktop check: frame clock against the wall clock. Anything but 1.00
         * means the compositor timestamp is not real time, and every dt-based
         * animation runs at that multiplier.
         */
        clock: () => ({ ...this.clockSurvey }),
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
    // of the scene art and of every world rotation. The well is the exception:
    // its motion is wall-based, and floating motes there read as fluff over the
    // picture rather than as a cue.
    if (definition.id !== 'lightwell') {
      this.postureCueState = createPostureCue({ scene: this.scene });
    }
    this.world.clearBase();
    // The floor comes from the scene's authored eye, never from the operator's
    // height setting: a 0.85 m bed and a 1.7 m room are both correct, and the
    // second number would sink the ward by a metre.
    this.world.apply();
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
    void unlockAudio().then(() => primeVoiceRoute());
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
      this.world.apply();
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
        onShow: (index) => {
          // Read the statement as it appears: a supine patient should not have
          // to parse a card to know what was asked.
          if (!this.susVoice) {
            return;
          }
          void this.voice.play(`v-sus-${index + 1}`).then((played) => {
            if (!played && this.voice.isReady()) {
              this.start.setHint(`SUS 语音播放失败：${this.voice.lastError()}`);
            }
          });
        },
        onFinish: () => {
          // The patient dwelled "完成": thank them, tell them they can take
          // the headset off and to share feedback with the staff.
          if (!this.susVoice) {
            return;
          }
          void this.voice.play('v-thanks-1').then((played) => {
            if (!played && this.voice.isReady()) {
              this.start.setHint(`SUS 结束语播放失败：${this.voice.lastError()}`);
            }
          });
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
    if (command === 'voice:subtitle:on' || command === 'voice:subtitle:off') {
      this.subtitlesOn = command.endsWith(':on');
      this.lastSubtitleId = undefined;
      return;
    }
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
    // One place releases the capture, whichever path arrived here: the window
    // timing out, the patient pressing confirm, or the tablet's recalibrate.
    this.capturePending = false;
    const finite =
      Number.isFinite(orientation.x) &&
      Number.isFinite(orientation.y) &&
      Number.isFinite(orientation.z) &&
      Number.isFinite(orientation.w) &&
      (orientation.x !== 0 || orientation.y !== 0 || orientation.z !== 0 || orientation.w !== 0);
    if (!finite) {
      // No usable pose: leave the frame alone rather than building a world from
      // zeros — but release the freeze, or the session would run with the world
      // nailed in place and no ramp ever starting.
      this.world.hold(false);
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
      // Restart the window rather than leaving an inert card on screen: the
      // hint asks for another attempt, so the run that produces it must live.
      this.calibrationOverlay?.setHint('这次没有取到有效朝向，请再试一次');
      this.restartCalibration();
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
    // A stop during calibration must release every flag it set, or the next
    // session starts with the float gated off and the view commands refused.
    this.capturePending = false;
    this.world.hold(false);
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
    void unlockAudio().then(() => primeVoiceRoute());
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
      case 'susVoice':
        // Default on: the statement is read as it appears. Turning it off is
        // for a room where the operator reads the card instead.
        this.susVoice = command.on;
        this.report(`SUS 语音${command.on ? '开' : '关'}`);
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
    // The frame is placed by the scene's authored eye (`eyeY`), so the
    // operator's height setting no longer moves the world; it still drives the
    // preview camera and the state readback.
    this.start.setStatus(`视点高度 ${next.toFixed(2)} m`, 'ok');
  }

  /** Rejected during calibration and whenever the patient is not in XR. */
  /**
   * Composed once per frame; every consumer reads this instead of re-deriving
   * "can I move" from whichever field happens to be nearby.
   */
  private updateMotionPlan(): void {
    const world = this.world.state();
    this.plan = planMotion(
      {
        session: this.session !== null,
        presenting: this.xr.isPresenting,
        capturing: this.capturePending,
        // The applied correction, measured from the transforms rather than
        // inferred from progress: the same number the tablet shows.
        correctionDeg: this.snapshot.worldPitchDeg,
        correctionMoving: world.moving
      },
      this.plan ?? undefined
    );
  }

  get motionPlan(): MotionPlan | null {
    return this.plan;
  }

  private viewCommandsAllowed(): boolean {
    return this.plan?.capabilities.view ?? false;
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
    // The rise is the pitch correction itself: 0 = the real ceiling overhead,
    // 1 = the patient's forward is the front wall. It works in either session
    // mode because it no longer swaps world frames, it ramps the one frame the
    // calibration built.
    if (!this.session || !this.world.state().ready) {
      this.start.setStatus('起身仅能在完成校准后的训练中使用', 'error');
      return;
    }
    if (this.capturePending) {
      this.start.setStatus('校准中无法调整姿态', 'error');
      return;
    }
    this.world.rise(rising ? 1 : 0);
    this.start.setStatus(
      rising ? '正在修正到面向前方，随时可停' : '正在回到天花板视角，随时可停',
      'ok'
    );
  }

  private stopSitUp(): void {
    if (!this.world.state().moving) {
      return;
    }
    this.world.stopRise();
    this.start.setStatus('已停在当前修正角度', 'ok');
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
    /**
     * `dt` comes from the wall clock, not from the XR frame timestamp.
     *
     * The compositor timestamp is a presentation time: on the headset it can
     * advance at a different rate than real time, and every dt-based animation
     * then runs at that multiplier. Measured in the field: the 5 s gaze dwell
     * fired after ~2 s, and a 13 s buoyancy cycle read as "periodic trembling"
     * instead of a slow heave. The frame timestamp is still sampled (see
     * `sampleClock`) so the ratio stays visible, but it never drives time.
     */
    const now = performance.now();
    if (frameTime !== undefined) {
      this.sampleClock(frameTime);
    }
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

  /**
   * Tracks how fast the frame clock runs against the wall clock. A ratio away
   * from 1 means every `dt`-based animation (and the dwell) runs at that speed.
   */
  private sampleClock(frameNow: number): void {
    const wall = performance.now();
    const survey = this.clockSurvey;
    if (survey.frames === 0) {
      survey.firstFrame = frameNow;
      survey.firstWall = wall;
    }
    survey.lastFrame = frameNow;
    survey.lastWall = wall;
    survey.frames += 1;
    const wallSpan = survey.lastWall - survey.firstWall;
    const frameSpan = survey.lastFrame - survey.firstFrame;
    if (wallSpan < 3000 || frameSpan <= 0) {
      return;
    }
    survey.ratio = frameSpan / wallSpan;
    if (!this.clockWarned && Math.abs(survey.ratio - 1) > 0.05) {
      this.clockWarned = true;
      console.warn(
        `[clock] frame clock runs at ${survey.ratio.toFixed(3)}x wall; ` +
          `dwell and easing scale with it`
      );
    }
  }

  /**
   * Pull the cue texts once: the subtitle card needs the sentence, and the
   * manifest only carries files, not words.
   */
  private async loadVoiceTexts(): Promise<void> {
    try {
      const response = await fetch('/voice/lines.json', { cache: 'no-store' });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as { lines?: { id?: string; text?: string }[] };
      for (const line of payload.lines ?? []) {
        if (line.id && line.text) {
          this.voiceTexts.set(line.id, line.text);
        }
      }
      // A cue may already be speaking before the file lands.
      this.lastSubtitleId = undefined;
    } catch {
      // No texts means no subtitles; the voice itself is unaffected.
    }
  }

  /** A subtitle follows the audio, so the audio owns when it disappears. */
  private syncSubtitle(): void {
    const card = this.subtitleCard;
    if (!card) {
      return;
    }
    const playing = this.voice.nowPlaying().id;
    const id = this.subtitlesOn ? playing : null;
    if (id === this.lastSubtitleId) {
      return;
    }
    this.lastSubtitleId = id;
    card.setLine(id ? this.voiceTexts.get(id) ?? null : null);
  }

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
      `t×${this.clockSurvey.ratio.toFixed(2)}`,
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
    if (this.previewFlow !== null) {
      return this.previewFlow;
    }
    if (this.capturePending) {
      return 0;
    }
    const frame = this.world.state();
    if (frame.moving) {
      // Only a rise (increasing correction) reads as weightlessness; lowering
      // or a frozen ramp keeps the motes still.
      if (frame.target <= frame.mix) {
        return 0;
      }
      // The correction sweeps up to 90° over the ramp; a smootherstep's peak
      // rate is 1.875x its mean.
      const peakDegPerSec = (90 * 1.875) / Math.max(1, frame.durationMs / 1000);
      return Math.max(CUE_IDLE_FLOW, Math.min(1, peakDegPerSec / CUE_FULL_DEG_PER_S));
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
    // The mirror must see the same world the patient sees: shell (view) times
    // base (comfort calibration or sit-up inverse), not just the head pose.
    // Rotation alone is not enough: the correction turns about the calibration
    // eye, so the composed transform also carries a translation the mirror
    // must subtract before undoing the rotation.
    if (shell) {
      this.worldQuat.copy(shell.group.quaternion).multiply(shell.base.quaternion);
      this.worldPos
        .copy(shell.base.position)
        .applyQuaternion(shell.group.quaternion)
        .add(shell.group.position);
    } else {
      this.worldQuat.identity();
      this.worldPos.set(0, 0, 0);
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
      worldXM: this.worldPos.x,
      worldYM: this.worldPos.y,
      worldZM: this.worldPos.z,
      confidence: comfort?.isCalibrated() ? 1 : 0,
      correctionMix: world.mix,
      correctionTarget: world.target,
      correctionMoving: world.moving,
      baseQuaternion: shell ? shell.base.quaternion : this.identityQuaternion,
      baseReferenceQuaternion: comfort
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
      // Retired: the horizon never tilts. The byte stays for frame compatibility.
      swayDeg: 0,
      sessionSec:
        this.sessionStartedAt > 0
          ? Math.floor((performance.now() - this.sessionStartedAt) / 1000)
          : 0,
      voiceId: playing ? this.voice.indexOf(playing) : -1,
      caps: this.plan?.capabilities ?? {
        rise: false,
        lie: false,
        stop: false,
        float: false,
        view: false,
        blocked: '未开始会话'
      }
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
