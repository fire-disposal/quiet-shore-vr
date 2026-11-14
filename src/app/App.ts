import * as THREE from 'three';
import { readConfig, type AppConfig } from './config';
import { createRenderer, XR_FRAMEBUFFER_SCALE } from '../core/xr/renderer';
import { readHeadPose } from '../core/xr/pose';
import {
  createComfort,
  type ComfortApi
} from '../core/xr/comfort';
import type { HeadPose, XRManagerLike } from '../core/xr/types';
import { SceneHost } from '../core/scene/host';
import type { SceneDefinition, SceneHandle } from '../core/scene/contract';
import { getSceneDefinition, SCENE, SCENES } from '../scenes/registry';
import { catalogEntries } from '../scenes/catalog';
import { FramePipeline } from '../core/geometry/pipeline';
import { SpatialInput } from '../ui/spatial/input';
import { DEFAULT_SPATIAL_THEME } from '../core/spatial/theme';
import { StartScreen } from '../ui/start-screen';
import { SpatialHud } from '../ui/spatial-hud';
import { SubtitleCard } from '../ui/subtitle-card';
import {
  createQuestionnairePanel,
  type QuestionnairePanelApi
} from '../ui/questionnaire-panel';
import { createCalibrationOverlay, type CalibrationOverlayApi } from '../ui/calibration-overlay';
import { createCalibrationRun, type CalibrationStatus } from './calibration-run';
import { getStrings, type Strings } from '../ui/strings';
import {
  disposeAudio,
  playSceneAudio,
  preloadSceneAudio,
  setAmbienceVolume,
  setDuckDepth,
  stopAudio,
  unlockAudio
} from '../audio/audio';
import { createVoicePlayer, SEQUENCES, type SequenceName } from '../audio/voice';
import { lyingEyeY, restMixOf } from '../core/anatomy';
import { degrees, metres } from '../core/units';
import { visualUpInContent } from '../core/xr/world-frame';
import { createFloating, type FloatingApi } from './floating';
import {
  annotateOutcome,
  recordSession,
  readSummaries,
  sessionStorageSafe,
  type SessionSegment,
  type SessionSummary
} from './session-log';
import { appLabel, isAppId, type AppId } from './apps';
import { getQuestionnaire, DEFAULT_QUESTIONNAIRE } from '../questionnaire/registry';
import type { Questionnaire } from '../questionnaire/contract';
import { createWorldRuntime, type WorldRuntimeApi } from './world-runtime';
import { planMotion, type MotionPlan } from './motion-plan';
import { parseRemoteCommand } from './commands';
import {
  buildQuestionnaireResult,
  buildQuestionnaireState,
  emptyAnswers,
  questionLabel
} from './questionnaire-payload';
import { scoreSheet } from './scoring';
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
import { INITIAL_SESSION, isActive, reduceSession, type SessionEvent, type SessionState } from './session';
import {
  INITIAL_LINK,
  LINK_LOST_GRACE_MS,
  isFrozen,
  isLost,
  reduceLink,
  type LinkEvent,
  type LinkGuardState
} from './link-guard';
import {
  OUTCOME_RECORDED,
  type OutcomeReceipt,
  type OutcomeSlot
} from './outcome-receipt';
import {
  AUTO_RISE_CUE,
  AUTO_RISE_CUE_MS,
  PREP_SCENE_ID,
  autoRiseDelayMs,
  shouldScheduleAutoRise
} from './auto-rise';
import {
  createLayoutToken,
  invalidateLayout,
  isLayoutCurrent,
  nextLayoutTicket
} from './layout';
import { canSwitchApp, shouldFileQuestionnaireSheet } from './app-switch';

const MAX_DT = 0.25;
/**
 * A supine head looks up: the preview's resting aim, radians. The camera's
 * +X rotation tilts the view up (its forward is -Z), so this is positive.
 */
const SUPINE_GAZE_RAD = 1.35;
/** Time from a stop to the fade-complete state; motion is frozen at once. */
const STOP_FADE_MS = 1000;
/**
 * The curtain between two scenes: down, swap, up.
 *
 * A live content swap is the one moment the patient sees two rooms occupy the
 * same place — the old one leaves and the new one arrives in the same frame.
 * A quarter second of black is what a theatre does with the same problem, and
 * it costs nothing: a plain DOM layer, not a second render pass.
 */
const SCENE_CUT_IN_MS = 220;
const SCENE_CUT_OUT_MS = 320;
/**
 * How long a session survives without its tablet is `LINK_LOST_GRACE_MS` from
 * `link-guard`: one definition, shared with the state machine and its tests.
 */
/** Planned session length used by the voice auto plan until the wire carries it. */
const VOICE_PLAN_SESSION_MS = 10 * 60 * 1000;
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
  /** The curtain: a full-screen black layer used only between scenes. */
  private veil: HTMLDivElement | null = null;
  private readonly strings: Strings;
  private readonly start: StartScreen;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly xr: XRManagerLike;
  private readonly scene = new THREE.Scene();
  private readonly pipeline = new FramePipeline({
    onError: (id, error) => this.reportFrameError(id, error)
  });
  private readonly host: SceneHost;
  private readonly input: SpatialInput;
  private readonly hud: SpatialHud;
  private readonly link: PortalLink;
  private linkOnline = false;
  /** The link has been up once, so a later drop is a real disconnect. */
  private linkEverOnline = false;
  /** online → frozen (5 s) → lost; see `link-guard`. */
  private linkGuard: LinkGuardState = INITIAL_LINK;
  /** The 5 s "the tablet is gone" timer; cleared the moment the link returns. */
  private linkLostTimer = 0;
  /** True while a link loss is unwinding the session. */
  private abandoned = false;
  /**
   * Generation/ticket for the page's deferred world changes. Bumped by every
   * stop, exit and dispose, so a scene swap or fade scheduled before one of
   * them cannot run after it (see `sceneChangeAllowed`).
   */
  private readonly layout = createLayoutToken();
  private readonly renderMonitor = new RenderMonitor();
  private readonly voice = createVoicePlayer();
  /** Wall clock at motion onset; 0 while idle. Drives the reported session clock. */
  private sessionStartedAt = 0;
  private readonly voiceTimers: number[] = [];
  /** Timers owned by the current session (the scheduled rise). */
  private readonly timers = new Set<number>();
  /** Id of the frame task that last threw, so a broken task reports once. */
  private frameErrorId = '';
  private readonly headEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly worldQuat = new THREE.Quaternion();
  private readonly worldPos = new THREE.Vector3();
  private readonly worldEuler = new THREE.Euler(0, 0, 0, 'XYZ');
  private readonly viewMotion: ViewMotionControllerApi;
  private readonly snapshot = new SceneSnapshot();
  /** The one description of applied motion and what may still be asked. */
  private plan: MotionPlan | null = null;
  /** Token for the scheduled auto-rise; any operator action bumps it. */
  private autoRiseToken = 0;
  private controlMode = false;
  /** Which product face owns the main area; the tablet may switch it. */
  private activeApp: AppId = 'training';
  /** The operator's scene, kept while the questionnaire face shows its own. */
  private trainingSceneId = '';

  /** Lying eye of the loaded scene; the rise is measured from it. */
  private sceneLyingEyeY = 0;
  /** Correction the loaded scene rests in (0 supine, 1 standing). */
  private sceneRestMix: 0 | 1 = 0;
  /** How much of the frame's buoyancy this scene wants as a heave, 0..1. */

  // ---- the therapy's dose, measured while it runs -------------------------
  /** Highest posture correction reached this session, 0..1. */
  private peakMix = 0;
  /** Highest up-gaze applied this session, in degrees. */
  private peakUpGazeDeg = 0;
  /** Actual dwell in each manually selected scene, in order. */
  private segments: SessionSegment[] = [];
  /** When the current scene dwell started, `performance.now()`; 0 = none. */
  private segmentStartedAt = 0;
  /** Peaks inside the current scene dwell. */
  private segmentPeakMix = 0;
  private segmentPeakUpGazeDeg = 0;
  /** Scenes are built once, off the critical path (see `preloadScenes`). */
  private scenesPreloaded = false;
  /** The page's own ledger of finished sessions (see `session-log.ts`). */
  private sessions: SessionSummary[] = [];

  private handle: SceneHandle | null = null;
  private comfort: ComfortApi | null = null;
  private shell: WorldShellApi | null = null;
  private capturePending = false;
  /**
   * The running calibration window was opened by the operator, not by the
   * session's own first recording: it skips the settle hold. Kept so the retry
   * after a failed apply reopens the same kind of window.
   */
  private calibrationSkipsSettle = false;
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
  /** The sheet, built per instrument; null until the questionnaire face opens. */
  private questionnairePanel: QuestionnairePanelApi | null = null;
  /**
   * The instrument the face is answering.
   *
   * Data, not a constant: the registry owns the wording, the question count and
   * the option values, and everything below reads them from here rather than
   * from a shipped ten-and-five.
   */
  private activeQuestionnaire: Questionnaire = DEFAULT_QUESTIONNAIRE;
  /** Questions are read aloud unless the operator turns it off. */
  private questionnaireVoice = true;
  private calibrationOverlay: CalibrationOverlayApi | null = null;
  /** Operator switch for gaze dwell; on by default per product decision. */
  private gazeDwellEnabled = true;
  /** Highest buoyancy the loaded scene allows, 0–1 (its own ceiling). */
  private sceneComfort = 1;
  /**
   * Answers live on the headset; the 28-byte state frame has no room. Length is
   * the loaded instrument's question count, so it follows a selection change.
   */
  private questionnaireAnswers: (number | null)[] = emptyAnswers(DEFAULT_QUESTIONNAIRE);
  /**
   * This sheet has already been filed once. The answers stay for the rest of
   * the questionnaire face, but the next filing is a *different* sheet, so the
   * boundary before it is a clean one instead of a second copy of the same
   * answers. Reopening after a filing starts a fresh sheet, not a resume of the
   * filed array — see `openQuestionnaire`.
   */
  private questionnaireFiled = false;
  private readonly calibrationFrame = new THREE.Quaternion();
  private readonly identityQuaternion = new THREE.Quaternion();
  private session: XRSession | null = null;
  private previewing = false;
  private headPose: HeadPose = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion()
  };
  /** Patient pressed; waiting for the technician to start the capture. */
  private awaitingCalibration = false;

  private showPerf: boolean;
  /** Scene bed (water sound) default: on, at half the authored loudness. */
  private sceneBedOn = true;
  private lastFrame = 0;
  private elapsed = 0;
  private frames = 0;
  /**
   * Frame-clock survey. The dwell fired at ~2 s while the sheet asked for
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
  private lifecycle: SessionState = INITIAL_SESSION;
  /** Loaded scene id; the operator changes it from the tablet, never mid-session. */
  private sceneId: string = SCENE.id;

  constructor() {
    this.config = readConfig(window.location.search);
    this.activeApp = this.config.initialApp;
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
    // The eye is the origin of this frame, not a height above it: the content is
    // dropped by the applied eye height (`floating.setBaseOffset(-eyeY)`), so
    // placing the camera at the standing eye as well put it 3.4 m above the room's
    // floor at `mix = 1` — above the washroom's own ceiling.
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.order = 'YXZ';

    this.renderer = createRenderer(this.start.stageElement);
    // `prefers-reduced-motion` is respected: a patient who has asked for less
    // motion gets the swap with no curtain rather than a flash.
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.veil = document.createElement('div');
      this.veil.style.cssText = [
        'position:fixed',
        'inset:0',
        'background:#000',
        'opacity:0',
        'pointer-events:none',
        'z-index:20'
      ].join(';');
      document.body.appendChild(this.veil);
    }
    // WebXRManager's public surface differs across Three typings; the narrow
    // interface is the only part this app uses.
    this.xr = this.renderer.xr as unknown as XRManagerLike;

    this.host = new SceneHost(this.scene);
    // Buoyancy reads the session through `gate()`: a running session that is
    // not capturing or rising may heave.
    this.floating = createFloating({
      host: this.host,
      handle: () => this.handle,
      gate: () => ({
        active: isActive(this.lifecycle) && this.linkGuard.phase === 'online',
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
      amount: this.config.floatAmount,
      // The scene declares how much of the frame's buoyancy it wants as a
      // heave; the app no longer keys on an id.
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
          pitch: this.headEuler.x,
          roll: this.headEuler.z
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
      (status) => this.handleLinkStatus(status),
      (level, charging) => this.start.setBattery(level, charging)
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
          // Same `now` as dt was measured from: one clock per frame.
          this.stepCalibration(now);
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
        this.handle?.controls.setMotion(this.computeSceneMotion());
        this.updateFloat(dt);
        this.questionnairePanel?.update(dt, now, this.headPose);
        // The reticle doubles as the gaze cue while the sheet is open.
        this.input.setReticleAlways(this.questionnairePanel?.isOpen() ?? false);
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
    // A relaunched entry means the last one sat unconfirmed: say what to do
    // differently instead of showing the same silent invitation again. The
    // press must land on the browser's window, so the instruction names it.
    if (this.config.entryRetry > 0) {
      this.start.setEntryHint('没有等到确认。请看向画面中央，再按一下头显右侧的按钮。');
    }
    this.updateHud(performance.now());
  }

  run(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.lastFrame = 0;
    this.link.start();
    // Building all four scenes takes a few milliseconds each; do it while the
    // entry screen is up so a later switch cannot hitch a frame.
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (typeof idle === 'function') {
      idle(() => this.preloadScenes(), { timeout: 3000 });
    } else {
      window.setTimeout(() => this.preloadScenes(), 1200);
    }
    // Cues are shipped with the page; a missing manifest leaves voice off, and
    // the entry screen says so instead of failing silently.
    if (typeof location !== 'undefined' && location.search.includes('debug')) {
      const debug = {
        /** Desktop check: feed a remote command through the real router. */
        command: (cmd: string) => {
          this.handleRemoteCommand(cmd);
          return cmd;
        },
        /** Scenes built and waiting, so a switch cannot build on the frame. */
        parked: () => this.host.preloaded,
        /** The last few finished sessions, newest last. */
        sessions: () => readSummaries(sessionStorageSafe()),
        /** In-memory copy from this page load (storage may be refused). */
        sessionsThisLoad: () => this.sessions,
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
        session: (on: boolean) => {
          this.lifecycle = on ? { phase: 'running', stopReason: null } : INITIAL_SESSION;
          if (on) {
            // A preview session needs the same clock and span the field path
            // starts at calibration, or its ledger would be empty.
            this.sessionStartedAt = performance.now();
            this.segmentStartedAt = this.sessionStartedAt;
          } else {
            this.sessionStartedAt = 0;
            this.segmentStartedAt = 0;
          }
          return this.lifecycle.phase;
        },
        /** Desktop check: the product face the next state frame reports. */
        app: () => this.activeApp,
        /**
         * Desktop check: frame clock against the wall clock. Anything but 1.00
         * means the compositor timestamp is not real time, and every dt-based
         * animation runs at that multiplier.
         */
        clock: () => ({ ...this.clockSurvey }),
        /** Desktop check: where the questionnaire sheet actually is, if open. */
        sheet: () => {
          const panel = this.questionnairePanel;
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
      // A sheet may already be on screen: the question that appeared while the
      // manifest was loading was never spoken (`speak` is silent then), so it is
      // read once now rather than waiting for the patient to reach the next one.
      if (ready && this.questionnairePanel?.isOpen()) {
        void this.speakQuestion(
          this.activeQuestionnaire,
          this.questionnairePanel.page()
        );
      }
    });
    void this.detectXR();
  }

  private bind(): void {
    // A thrown frame must not leave a silently frozen page: surface it once.
    window.addEventListener('error', (event) => {
      const message = event.message || '未知错误';
      this.start.setStatus(`页面出错：${message}`, 'error');
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
  }

  /**
   * The state a scene brings with it: its comfort ceiling, its two eye heights
   * and the correction it rests in. One writer, so a scene loaded by any path
   * (startup, operator command, live switch) lands in the same shape.
   */
  private applySceneDefinition(definition: SceneDefinition): void {
    // Placement comes from the scene's `posture`: the lying height is derived
    // by `core/anatomy.ts`, the standing height is the operator's setting (the
    // art's own number is the fallback), and `world.apply()` — driven by mix —
    // interpolates between them.
    this.sceneComfort = definition.comfort ?? 1;
    this.sceneLyingEyeY = lyingEyeY(definition.posture);
    this.sceneRestMix = restMixOf(definition.posture);
    this.world.setScene({
      lyingEyeY: this.sceneLyingEyeY,
      standingEyeY: this.config.eyeHeight,
      restMix: this.sceneRestMix
    });
    this.world.apply();
    preloadSceneAudio(definition.audio);
  }

  /**
   * Build every scene once, while the page is idle.
   *
   * The operator may change scene mid-session; `build()` on the render thread
   * is a guaranteed hitch (canvas textures, budgets, instancing). Preloading
   * costs a few milliseconds of idle time and makes every switch a pointer
   * swap.
   */
  private preloadScenes(): void {
    if (this.scenesPreloaded || this.xr.isPresenting) {
      // Building a scene inside a session would hitch the frame it is meant to
      // save; the call is retried when the session ends (`resetWorldToRest`).
      return;
    }
    this.scenesPreloaded = true;
    for (const definition of SCENES) {
      if (definition.id !== this.sceneId) {
        this.host.preload(definition);
      }
    }
  }

  private loadScene(): void {
    this.disposeScene();
    const definition = getSceneDefinition(this.sceneId) ?? SCENE;
    // Parking the outgoing scene (instead of disposing it) is what makes every
    // later switch a pointer swap; the registry is four scenes at most.
    const handle = this.host.load(definition, { keepPrevious: true });
    this.handle = handle;
    // World shell order: view pitch -> base (comfort/sit-up) -> content
    // (floor). Wrapping the host's content group, not the scene root, keeps the
    // floor offset on content and survives both rotations.
    this.comfort = createComfort({ scene: this.scene, world: this.host.content });
    // Weather is part of the same world, not a screen-space backdrop. Mount it
    // beside the content inside comfort so it inherits calibration, posture and
    // world rotation; `setBackdropOffset` still keeps it out of the heave bob.
    this.comfort.group.add(this.host.backdrop);
    this.shell = createWorldShell({ scene: this.scene, base: this.comfort.group });
    // Rebind, do not re-animate: the controller keeps its angles and state.
    this.shell.setWorldRotation(
      viewToWorld(this.viewMotion.getLookYawDeg(), this.viewMotion.getUpGazeDeg())
    );
    this.world.clearBase();
    this.applySceneDefinition(definition);
    this.floating.reset();
    // The preview starts where the patient starts: lying on their back, looking
    // up. A level preview shows the *room's* underside (a urinal bowl from
    // below, a dark shaft wall) and reads as a broken scene; aimed up it shows
    // exactly what the headset shows at mix = 0. The operator can drag from
    // here, and `?debug` can aim it precisely.
    if (!this.xr.isPresenting) {
      this.camera.rotation.set(SUPINE_GAZE_RAD, 0, 0, 'YXZ');
    }
    preloadSceneAudio(definition.audio);
  }

  private disposeScene(): void {
    if (this.comfort) {
      // Unwrap the shell first: it re-hangs the base group on the scene.
      this.shell?.dispose();
      this.shell = null;
      this.comfort.reset();
      this.scene.remove(this.comfort.group);
      this.comfort.group.remove(this.host.content);
      this.comfort.group.remove(this.host.backdrop);
      this.scene.add(this.host.content);
      this.scene.add(this.host.backdrop);
      this.floating.setBaseOffset(0);
      this.comfort = null;
    }
    this.host.unload();
    this.handle = null;
  }

  private async detectXR(): Promise<void> {
    if (!navigator.xr) {
      // No sentence: naming the browser is plumbing the operator cannot act on
      // from here. The enter key simply stays closed.
      this.start.setStatus('');
      this.start.setEnterEnabled(false);
      return;
    }
    try {
      const supported = await navigator.xr.isSessionSupported('immersive-vr');
      this.start.setEnterEnabled(supported);
      if (supported) {
        this.start.setStatus('');
      } else {
        this.start.setStatus('');
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
      return;
    }
    this.enterPending = true;
    this.start.setEnterBusy(true);
    this.start.setStatus(this.strings.entering);
    void unlockAudio().then(() => primeVoiceRoute());
    try {
      // Do not await a paint here: requestSession must stay in the same
      // transient user-activation window as the right-side confirm click.
      const next = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor']
      });
      this.session = next;
      this.dispatch({ type: 'start' });
      await this.xr.setSession(next);
      this.lastFrame = 0;
      this.renderer.setAnimationLoop(this.onFrame);
      next.addEventListener('end', () => this.onSessionEnd());
      // No select listeners: the entry click above is the patient's only
      // control. Everything inside the session is the tablet operator's, and
      // the patient must not be able to start, stop or confirm anything by
      // pressing the headset.
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

      // The questionnaire face has no training session behind it: there is no
      // posture to calibrate and nothing to record, so it enters straight into
      // its own room with the sheet up. A cold start with `app=questionnaire`
      // used to land on the training hold-still card, waiting for a capture
      // that the operator had no reason to start.
      if (this.activeApp === 'questionnaire') {
        this.enterQuestionnaireFace();
      } else if (this.config.skipCalibration) {
        if (this.handle) {
          this.handle.root.visible = true;
        }
        this.comfort?.reset();
        this.startSceneAudio();
        this.dispatch({ type: 'calibrated' });
        this.start.setStatus(this.strings.skippedCalibration, 'ok');
      } else {
        // Calibration is the technician's decision: the card asks the patient
        // to hold still and waits for `calibrate` from the tablet. There is no
        // patient-side fallback any more — the patient does nothing once they
        // are in, and `beginCalibration` refuses to run without a live
        // presenting session, so a stray press cannot start a capture.
        this.awaitingCalibration = true;
        this.startCalibrationOverlay();
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
    // Only the first calibration of a session starts its clock and ledger.
    // A mid-session recalibration is the operator's correction, not a new
    // exercise: it must not reset elapsed time, peaks or segments.
    if (previous === 'calibrating' && isActive(this.lifecycle) && this.sessionStartedAt === 0) {
      this.sessionStartedAt = performance.now();
      this.peakMix = 0;
      this.peakUpGazeDeg = 0;
      this.segmentPeakMix = 0;
      this.segmentPeakUpGazeDeg = 0;
      this.segments = [];
      this.segmentStartedAt = this.sessionStartedAt;
    }
    if (this.lifecycle.phase !== 'stopping' || previous === 'stopping') {
      return;
    }
    // Everything already scheduled for the world dies with the session it was
    // scheduled in: a scene swap still behind the curtain must not land in the
    // stopping scene, restart its audio or open a posture ramp.
    invalidateLayout(this.layout);
    this.cancelAutoRise();
    this.viewMotion.stop();
    this.stopSitUp();
    this.voice.stop();
    // Any stop — including one during calibration — takes the overlay with it.
    this.calibrationOverlay?.hide();
    // A session that actually ran leaves one line behind, before the clock is
    // cleared: the tablet only sees 1 Hz frames, and a dropped link would
    // otherwise erase the only record of how long this lasted.
    if (this.sessionStartedAt > 0) {
      this.closeSegment(performance.now());
      this.sessions = recordSession(sessionStorageSafe(), {
        at: Date.now(),
        scene: this.sceneId,
        seconds: (performance.now() - this.sessionStartedAt) / 1000,
        level: this.floating.getAmount(),
        mix: this.world.state().mix,
        stop: this.lifecycle.stopReason ?? 'unknown',
        confidence: this.comfort?.isCalibrated() ? 100 : 0,
        peakMix: this.peakMix,
        peakUpGazeDeg: this.peakUpGazeDeg,
        segments: this.segments
      });
      // The tablet keeps the durable cross-app copy of every finished record.
      const latest = this.sessions[this.sessions.length - 1];
      if (latest) {
        this.link.sendSession(latest);
      }
    }
    this.sessionStartedAt = 0;
    this.link.sendLog(this.activeApp, 'session.stopped', {
      reason: this.lifecycle.stopReason ?? 'unknown'
    });
    window.setTimeout(() => this.dispatch({ type: 'faded' }), STOP_FADE_MS);
  }

  private onSessionEnd(): void {
    this.dispatch({ type: 'stop', reason: 'session-end' });
    this.dispatch({ type: 'faded' });
    this.session = null;
    // The link guard starts clean with the session: a frozen or lost link
    // describes a run that no longer exists.
    this.resetLinkGuard();
    this.stopSceneAudio();
    this.resetWorldToRest();
    this.renderer.setAnimationLoop(null);
    // The session is over: do not invite the patient to start again. A session
    // abandoned after a link loss lands here too, which is exactly the state it
    // should land in — entry screen, world unloaded, readings at zero.
    this.start.showEnded();
    this.input.setLayers(true, true);
    this.start.setStatus(
      this.abandoned ? this.strings.linkLostExit : this.strings.sessionEnded
    );
    this.abandoned = false;
    this.link.sendStateNow();
    this.updateHud(performance.now());
  }

  /**
   * Open the questionnaire face inside a live XR session.
   *
   * The face owns its own room and its own content: the training scene, its
   * ambience and its calibration card are all put aside, and what the patient
   * sees is the survey room with the sheet in it. Everything the training path
   * needs — calibration frame, comfort, buoyancy — stays untouched, so a later
   * switch back to training still has the operator's scene and its state.
   */
  private enterQuestionnaireFace(): void {
    // `enterVR` dispatches `start` before either face is selected. APP2 has no
    // posture capture, so leaving the machine in `calibrating` made the face
    // look frozen in calibration and refused every app switch. `suspend` is
    // the idle transition without stop/fade/session-record side effects.
    if (this.lifecycle.phase === 'calibrating') {
      this.dispatch({ type: 'suspend' });
    }
    const survey = getSceneDefinition('survey');
    if (survey && survey.id !== this.sceneId) {
      this.trainingSceneId = this.sceneId;
      this.sceneId = survey.id;
      this.loadScene();
    }
    if (this.handle) {
      this.handle.root.visible = true;
    }
    this.awaitingCalibration = false;
    this.calibrationOverlay?.hide();
    // No `calibrated` dispatch: the lifecycle stays idle, which is what the
    // sheet is allowed to run in and what `canSwitchApp` expects.
    this.comfort?.reset();
    this.input.setLayers(true, true);
    this.resetQuestionnaireSheet();
    this.openQuestionnaire();
    this.start.setStatus(this.strings.modeQuestionnaire, 'ok');
  }

  /**
   * A new respondent starts a new sheet.
   *
   * Called when the questionnaire face is (re)entered: the previous patient's
   * answers must not be prefilled for this one, and the panel's own pager,
   * draft and "already said this question" state must not either — the cached
   * panel kept all three, so a fresh patient saw the last one's sheet.
   */
  private resetQuestionnaireSheet(): void {
    this.questionnaireAnswers = emptyAnswers(this.activeQuestionnaire);
    this.questionnaireFiled = false;
    this.questionnairePanel?.reset();
    this.publishQuestionnaireState();
  }

  /**
   * The sheet's answers are filed: once the last one is recorded, and once when
   * the sheet closes. Never twice for one sheet — a reopen after filing is a
   * new sheet, not a second copy of the same one in the tablet's record.
   */
  private fileQuestionnaireSheet(): void {
    if (!shouldFileQuestionnaireSheet(this.questionnaireAnswers, this.questionnaireFiled)) {
      return;
    }
    this.questionnaireFiled = true;
    this.publishQuestionnaireResult();
  }

  /**
   * Loads one published instrument and starts a clean sheet for it.
   *
   * Answers recorded for the previous instrument describe questions that are no
   * longer on the card, so they are filed first (if they were not already) and
   * then dropped: the sheet is per instrument, not per face.
   */
  private selectQuestionnaire(id: string): void {
    const next = getQuestionnaire(id);
    if (!next) {
      this.refuse(`未发布的问卷：${id}`);
      return;
    }
    if (next.id === this.activeQuestionnaire.id && this.questionnairePanel) {
      // Already loaded: selecting it again means "show me this one", not "throw
      // away the answers I have".
      this.openQuestionnaire();
      return;
    }
    // Whatever was answered on the outgoing instrument is a record in its own
    // right; a half sheet still says something about the questions that were
    // answered, and dropping it here would silently lose that.
    this.fileQuestionnaireSheet();
    this.questionnairePanel?.dispose();
    this.questionnairePanel = null;
    this.activeQuestionnaire = next;
    this.questionnaireAnswers = emptyAnswers(next);
    this.questionnaireFiled = false;
    if (this.activeApp === 'questionnaire') {
      this.openQuestionnaire();
      this.report(`问卷：${next.name.zh}`);
    }
    this.publishQuestionnaireState();
  }

  /**
   * Builds the sheet for the loaded instrument on first use and shows it.
   *
   * The panel is answered by gaze (3 s per target) because a supine patient has
   * no pointer; the operator can still answer from the tablet, and the gaze
   * feature itself is switchable from the control side. Every piece of copy on
   * it — the statement, the options, the question count — comes from the
   * instrument, so a three-question sheet is the same code as a ten-question
   * one.
   */
  private openQuestionnaire(): void {
    const questionnaire = this.activeQuestionnaire;
    // A panel is built for one instrument: its option row is positioned from
    // the option count. A selection change therefore discards the old one
    // rather than resizing buttons that can only be resized by rebuilding.
    if (this.questionnairePanel?.questionnaire().id !== questionnaire.id) {
      this.questionnairePanel?.dispose();
      this.questionnairePanel = null;
    }
    // A sheet that was already handed to the tablet is finished. Reopening it
    // is therefore the start of the *next* respondent's sheet, not a resume of
    // the filed array: without this, closing and reopening a completed sheet
    // showed the previous patient's ten answers with every option pre-chosen,
    // and the next filing would have been a second copy of them.
    //
    // A sheet that is merely closed and unfinished is not reset: a patient who
    // looked away mid-way continues where they stopped, which is what the
    // tablet's `questionnaire:open` is for.
    if (this.questionnaireFiled) {
      this.questionnaireFiled = false;
      this.questionnaireAnswers = emptyAnswers(questionnaire);
      this.questionnairePanel?.reset();
    }
    if (!this.questionnairePanel) {
      this.questionnairePanel = createQuestionnairePanel({
        scene: this.scene,
        theme: DEFAULT_SPATIAL_THEME,
        input: this.input,
        questionnaire,
        onAnswer: (index, value) => {
          this.questionnaireAnswers[index] = value;
          const label = questionLabel(questionnaire, index);
          this.report(`${label} = ${value}`);
          this.publishQuestionnaireState();
          const complete = this.questionnaireAnswers.every((answer) => answer !== null);
          if (complete) {
            this.report(`${questionnaire.name.zh} 已完成`);
            this.fileQuestionnaireSheet();
          }
        },
        onShow: (index) => {
          // Read the question as it appears: a supine patient should not have
          // to parse a card to know what was asked. The cue id is the
          // instrument's own — nothing here builds a cue id by hand.
          void this.speakQuestion(questionnaire, index);
          this.publishQuestionnaireState();
        },
        onFinish: () => {
          // The patient dwelled "完成": thank them, tell them they can take the
          // headset off and to share feedback with the staff.
          void this.speak(questionnaire.completionVoiceId, '结束语');
        },
        onClose: () => {
          // Give the layers back to whatever the session mode dictates.
          this.input.setLayers(!this.controlMode, this.session !== null && !this.controlMode);
          const filled = this.questionnaireAnswers.filter((answer) => answer !== null).length;
          const total = this.activeQuestionnaire.questions.length;
          // Closing is hide, not filing. Filing here made a half sheet look
          // complete, and the next open discarded its answers. Leaving the
          // face or ending the session is the deliberate archive point.
          this.start.setStatus(`${this.activeQuestionnaire.name.zh} 已暂停 ${filled}/${total}`, 'ok');
          this.publishQuestionnaireState();
        }
      });
      this.questionnairePanel.setDwellEnabled(this.gazeDwellEnabled);
    }
    // The sheet is the one spatial UI the patient may use by gaze, so it has to
    // be focusable even while the tablet holds control: the UI layer used to be
    // off for the whole session, which made dwell unreachable in practice.
    this.input.setLayers(true, false);
    this.questionnairePanel.open();
    this.publishQuestionnaireState();
  }

  /**
   * Says one question aloud, if the operator has voice on and the cues loaded.
   *
   * The cue id comes from the instrument. A clip that fails to sound is a lost
   * instruction, not a cosmetic problem: it is reported where the operator is
   * looking, with the player's own reason.
   */
  private async speakQuestion(questionnaire: Questionnaire, index: number): Promise<void> {
    const question = questionnaire.questions[index];
    if (!question) {
      return;
    }
    await this.speak(question.voiceId, `第 ${index + 1} 题语音`);
  }

  private async speak(voiceId: string, what: string): Promise<void> {
    if (!this.questionnaireVoice) {
      return;
    }
    if (!this.voice.isReady()) {
      // The manifest may still be loading: the app re-reads the current
      // question once it lands (see `run`), so this is not yet a failure.
      return;
    }
    const played = await this.voice.play(voiceId);
    if (!played) {
      this.start.setStatus(`${what}播放失败：${this.voice.lastError()}`, 'error');
    }
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
        this.refuse('未知语音序列');
        return;
      }
      this.voice.playSequence(name);
      return;
    }
    if (command.startsWith('voice:volume:')) {
      const percent = Number(command.slice('voice:volume:'.length));
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        this.refuse('语音音量无效');
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

  /**
   * Refuse a command the operator sent, in the words they must act on.
   *
   * The local status line is not enough: the tablet is what they are holding,
   * so the same sentence travels upstream (`notice`) and shows there. Both
   * lines are the same string on purpose — two wordings would drift.
   */
  private refuse(text: string): void {
    this.start.setStatus(text, 'error');
    this.link.sendNotice(text, 'error');
  }

  private applySceneCommand(id: string): void {
    const definition = getSceneDefinition(id);
    if (!definition) {
      this.refuse('未知场景');
      return;
    }
    if (!this.previewing && !this.session) {
      // The portal's entry page is not a place to browse scenes: the patient
      // must be inside the preparation room first. The tablet gates its list
      // on the same fact; this is the wire-level backstop.
      this.refuse('请先进入 VR，再选择正式场景');
      return;
    }
    if (this.capturePending) {
      // The card is teaching the patient to hold still; a world swap under it
      // would undo that.
      this.refuse('记录体位时无法切换场景，稍后再试');
      return;
    }
    if (this.lifecycle.phase === 'stopping') {
      // The stop fade owns the world: a swap here would race the teardown and
      // leave the next session on a scene nobody chose.
      return;
    }
    if (definition.id === this.sceneId && this.handle) {
      return;
    }
    if (this.session && this.handle) {
      // One slot: a second scene command supersedes this one, and a stop, an
      // exit or a dispose before the swap lands voids it (the check runs
      // inside the callback, after the 220 ms curtain).
      const ticket = nextLayoutTicket(this.layout);
      this.behindCurtain(() => this.switchSceneLive(definition), () =>
        this.sceneChangeAllowed(ticket)
      );
      return;
    }
    const ticket = nextLayoutTicket(this.layout);
    this.behindCurtain(() => {
      this.sceneId = definition.id;
      this.loadScene();
      if (this.previewing) {
        this.startSceneAudio();
        this.start.showStage();
      }
      this.start.setStatus(`场景：${definition.name[this.config.lang]}`, 'ok');
      this.link.sendStateNow();
      this.updateHud(performance.now());
    }, () => this.sceneChangeAllowed(ticket));
  }

  /**
   * The scene swap ordered under `ticket` still belongs to the live run.
   *
   * Every stop, exit and dispose bumps the layout token, so a change that was
   * arranged before one of them cannot swap the world, restart the scene bed,
   * write `scene.switched` or start a posture ramp after it. The lifecycle
   * check only applies inside a session: a desktop preview never enters the
   * machine, so its scene switches are gated by `previewing` alone.
   */
  private sceneChangeAllowed(ticket: number): boolean {
    if (!isLayoutCurrent(this.layout, ticket) || this.capturePending) {
      return false;
    }
    if (this.previewing) {
      return true;
    }
    return this.lifecycle.phase !== 'stopping' && this.lifecycle.phase !== 'idle';
  }

  /**
   * Change scene inside a running session.
   *
   * Only the content moves: the calibration frame, the view offset and the
   * buoyancy keep running, so the patient never loses their place or has to be
   * re-aimed. A scene whose art is drawn for a different posture changes the
   * rest correction — that lands as the operator's usual ramp, never as a snap,
   * because a 90° world rotation between two frames is the one thing a supine
   * patient cannot brace for.
   */
  /**
   * Run a scene change behind the curtain: fade to black, swap, fade back.
   *
   * The swap itself is untouched — it still happens in one synchronous call, so
   * nothing can observe a half-loaded scene. Only the moment of change is
   * covered.
   *
   * The swap waits 220 ms, which is longer than it takes to stop, exit or end
   * the session: `guard` is checked inside the callback, so a change ordered
   * before the stop but delivered after it does not run at all. The opaque
   * curtain is lifted from inside the callback for the same reason — a swap
   * that never ran must not leave the patient behind a black screen.
   */
  private behindCurtain(swap: () => void, guard: () => boolean): void {
    const veil = this.veil;
    if (!veil) {
      if (guard()) {
        swap();
      }
      return;
    }
    veil.style.transition = `opacity ${SCENE_CUT_IN_MS}ms linear`;
    veil.style.opacity = '1';
    window.setTimeout(() => {
      if (!guard()) {
        veil.style.transition = `opacity ${SCENE_CUT_IN_MS}ms linear`;
        veil.style.opacity = '0';
        return;
      }
      swap();
      veil.style.transition = `opacity ${SCENE_CUT_OUT_MS}ms linear`;
      veil.style.opacity = '0';
    }, SCENE_CUT_IN_MS);
  }

  private switchSceneLive(definition: SceneDefinition): void {
    const previousLevel = this.floating.getAmount();
    const previousRestMix = this.sceneRestMix;
    // Read before the host takes the new scene: this is the "were we in prep"
    // fact the scheduled rise is gated on.
    const previousId = this.host.definition?.id ?? this.sceneId;
    this.link.sendLog(this.activeApp, 'scene.switched', {
      from: previousId,
      to: definition.id
    });
    // A switch ends the dwell in the old scene: the ledger's segments are what
    // the session actually spent, not what was selected.
    this.closeSegment(performance.now());
    this.stopSceneAudio();
    // The preparation room is a neutral place, not a scene: entering it ends the
    // performance. A voice cue would be describing a room the patient is no
    // longer in, and the room declares no motion, so the heave stops with it.
    // The intensity readback shows the zero, so nothing is hidden.
    if (definition.id === PREP_SCENE_ID) {
      this.voice.stop();
      this.floating.setAmount(0, this.floatCap());
    }
    this.handle = this.host.load(definition, { keepPrevious: true });
    this.sceneId = definition.id;
    this.segmentStartedAt = performance.now();
    this.applySceneDefinition(definition);
    // A scene with a lower comfort ceiling must not inherit a higher level; the
    // envelope eases down by itself, so the heave never steps.
    this.floating.setAmount(previousLevel, this.sceneComfort);
    if (this.sceneRestMix !== previousRestMix) {
      // The correction ramps, so the heave's axis is about to travel with it:
      // zero the motion it would otherwise carry across the turn.
      this.floating.reset();
    }
    if (this.world.state().ready && this.world.state().mix !== this.sceneRestMix) {
      this.world.rise(this.sceneRestMix);
    }
    this.startSceneAudio();
    // Leaving the preparation room for a supine scene is the moment the rise
    // belongs to: the patient has settled, the capture landed in prep, and the
    // scene now on screen is the one the performance is about. `auto-rise`
    // refuses a standing scene, a scene with no capture, or a re-entry to prep.
    const fromPrep = previousId === PREP_SCENE_ID;
    if (fromPrep && this.session && this.world.state().ready) {
      this.scheduleAutoRise();
    }
    this.start.setStatus(`已切换：${definition.name[this.config.lang]}`, 'ok');
    this.link.sendStateNow();
    this.updateHud(performance.now());
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
  /**
   * Put the hold-still card up and wait.
   *
   * The capture itself does not start here: the operator starts it. The card
   * says what the patient must do and nothing else — no countdown, because
   * there is no timer running yet.
   */
  private startCalibrationOverlay(): void {
    // Same card as the capture uses, but with no progress bar: nothing is
    // being measured yet, the operator has not started it.
    this.world.hold(true);
    this.world.clearBase();
    this.viewMotion.reset();
    this.input.setLayers(false, false);
    this.calibrationOverlay ??= createCalibrationOverlay({
      scene: this.scene,
      theme: DEFAULT_SPATIAL_THEME
    });
    this.calibrationOverlay.show();
    this.calibrationOverlay.setProgress(null);
    this.calibrationOverlay.setHint('等待技术员开始记录');
    // The card waits outside the lifecycle machine: `calibrating` means "the
    // capture is running", and it is not running yet.
    this.link.sendStateNow();
  }

  /**
   * Start the capture. Guarded: a capture is only ever started inside a live
   * presenting session, so a stale command — the tablet's `calibrate` arriving
   * after the headset left XR, or one queued behind a link loss — cannot open a
   * card over an empty stage and then hold the world frozen forever.
   */
  private beginCalibration(skipSettle = false): void {
    if (!this.session || !this.xr.isPresenting) {
      this.awaitingCalibration = false;
      this.refuse('不在 VR 会话中，无法记录体位');
      return;
    }
    this.awaitingCalibration = false;
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
        { type: 'start' }
      );
    }
    this.calibrationOverlay.show();
    this.restartCalibration(skipSettle);
    this.link.sendStateNow();
  }

  /**
   * The flow the operator remembers from the earlier build: hold still, watch
   * the bar fill, done. No key is required, because the physical button never
   * reaches a page in this browser's immersive mode.
   */
  private restartCalibration(skipSettle = this.calibrationSkipsSettle): void {
    this.calibrationSkipsSettle = skipSettle;
    this.calibStatus = 'settling';
    this.capturePending = true;
    this.calibration.start(performance.now(), skipSettle);
    this.calibrationOverlay?.setHint(skipSettle ? '即将记录…' : '保持不动…');
    this.calibrationOverlay?.setProgress(0);
    this.start.setStatus('正在记录起始体位', 'ok');
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
      this.calibrationOverlay?.setHint('使用当前体位');
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
      this.calibrationOverlay?.setHint('这次没有记录成功，请再试一次');
      this.restartCalibration();
      return;
    }
    // Overlay down, now that the world frame is known.
    this.calibrationOverlay?.hide();
    this.input.setLayers(!this.controlMode, this.session !== null && !this.controlMode);
    this.dispatch({ type: 'calibrated' });
    this.link.sendLog(this.activeApp, 'calibration.recorded', {
      first: this.sessionStartedAt === 0
    });
    // The runtime prepares the sit-up path for every session and hands the
    // world to whichever frame the mode and the scene's authored eye call for.
    this.world.calibrate(orientation, this.headPose.position);
    this.world.hold(false);
    if (this.session && this.handle) {
      this.startSceneAudio();
      this.scheduleAutoRise();
    }
    this.link.sendStateNow();
    this.updateHud(performance.now());
  }

  /**
   * Six seconds after calibration the patient is told what is about to happen;
   * two seconds after that line ends, the world begins its rise. The cue comes
   * before the motion on purpose — a world that turns without warning is the
   * one thing a supine patient cannot brace for.
   *
   * The ramp is scheduled from the cue's *settled* promise, so a refused or
   * missing line cannot start a silent turn: `play` resolves `true` only when
   * the clip is actually sounding. No cue, no rise.
   */
  private scheduleAutoRise(): void {
    // The preparation room is where the patient settles; a standing scene has
    // nothing to lift; a scene without a landed capture has no frame to build
    // on. `auto-rise` owns those rules so they can be tested without a headset.
    if (!shouldScheduleAutoRise({
      sceneId: this.sceneId,
      restMix: this.sceneRestMix,
      session: this.session !== null,
      calibrated: this.world.state().ready
    })) {
      return;
    }
    const token = ++this.autoRiseToken;
    const cancelled = (): boolean =>
      token !== this.autoRiseToken || !this.session || !this.world.state().ready;

    this.after(AUTO_RISE_CUE_MS, () => {
      if (cancelled()) {
        return;
      }
      void this.voice.play(AUTO_RISE_CUE).then((played) => {
        // `played === false` means nothing sounded: the patient got no
        // warning, so the world stays where it is instead of turning silently.
        if (!played || cancelled()) {
          return;
        }
        this.after(autoRiseDelayMs(this.voice.clipMs(AUTO_RISE_CUE)), () => {
          if (cancelled()) {
            return;
          }
          if (this.world.rise(1)) {
            this.start.setStatus('正在进入站立视角', 'ok');
          }
        });
      });
    });
  }

  /**
   * One timer registry for the page: a scheduled rise belongs to the session
   * that scheduled it, so leaving that session must cancel it — a token alone
   * let an old timer fire into the next session and lift the world unasked.
   */
  private after(ms: number, run: () => void): void {
    const handle = window.setTimeout(() => {
      this.timers.delete(handle);
      run();
    }, ms);
    this.timers.add(handle);
  }

  private clearTimers(): void {
    for (const handle of this.timers) {
      window.clearTimeout(handle);
    }
    this.timers.clear();
  }

  /** Any operator intent cancels the scheduled rise; it never fights a button. */
  private cancelAutoRise(): void {
    this.autoRiseToken += 1;
    this.clearTimers();
  }

  /** First frame failure is surfaced; the loop keeps rendering. */
  private reportFrameError(id: string, error: unknown): void {
    if (this.frameErrorId === id) {
      return;
    }
    this.frameErrorId = id;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[frame:${id}] ${message}`);
    this.start.setStatus(`画面任务出错：${message}`, 'error');
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
    // Every way out passes here (a session ending, a preview closing, an exit),
    // so this is also where deferred world changes are voided.
    invalidateLayout(this.layout);
    this.cancelAutoRise();
    this.capturePending = false;
    // The "waiting for the technician" card is a session state, and it used to
    // survive a stop: the next session opened with the tablet's first
    // `calibrate` taking the `beginCalibration` branch of a stale wait.
    this.awaitingCalibration = false;
    this.resetLinkGuard();
    this.world.hold(false);
    // A panel is session furniture: leaving the world at rest closes it, or a
    // stopped session would keep a sheet floating in front of the patient.
    // This is a deliberate exit, so a partial sheet is filed here.
    this.fileQuestionnaireSheet();
    this.questionnairePanel?.close();
    this.viewMotion.reset();
    this.world.clearBase();
    this.comfort?.reset();
    this.floating.setBaseOffset(0);
    this.floating.reset();
    this.calibrationOverlay?.hide();
    this.shell?.update(this.headPose.position);
    // A session that started before the idle preload ran leaves the other
    // scenes unbuilt; now that nothing is presenting, catch up.
    this.preloadScenes();
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

  /**
   * The tablet's recalibrate: the operator asked for a fresh frame, so the
   * window opens straight into the countdown. The settle hold exists to start
   * the window on a still head, and the operator is watching that head.
   */
  private recalibrate(): void {
    if (!this.session || !this.xr.isPresenting) {
      this.start.setStatus(this.strings.recalibrateNeedsSession, 'error');
      return;
    }
    if (this.lifecycle.phase === 'calibrating') {
      this.restartCalibration(true);
      return;
    }
    this.beginCalibration(true);
  }

  /**
   * Hand one filed sheet to the tablet.
   *
   * The state frame is fixed at 28 bytes, so this rides the page's JSON socket
   * and the headset app forwards it on its own characteristic; the tablet
   * archives it. It goes on the reliable outbox because a sheet is a record: a
   * socket close straight after the send must not lose a respondent's session.
   */
  private publishQuestionnaireResult(): void {
    const questionnaire = this.activeQuestionnaire;
    const payload = buildQuestionnaireResult(questionnaire, this.questionnaireAnswers, {
      scene: this.sceneId,
      sessionSec:
        this.sessionStartedAt > 0
          ? (performance.now() - this.sessionStartedAt) / 1000
          : 0,
      now: Date.now(),
      app: 'questionnaire',
      score: scoreSheet(questionnaire, this.questionnaireAnswers)
    });
    console.info(`[questionnaire] ${questionnaire.id} ${JSON.stringify(payload.answers)}`);
    this.link.sendQuestionnaireResult(payload);
  }

  /**
   * The sheet's live state, for the control side.
   *
   * Not a record and not persisted anywhere: it answers "which instrument,
   * which question, what has been answered so far", which the patient changes
   * by gaze and the tablet cannot infer from its own presses. It therefore
   * bypasses the outbox — a stale replay after a reconnect would be worse than
   * no update.
   */
  private publishQuestionnaireState(): void {
    const panel = this.questionnairePanel;
    const questionnaire = this.activeQuestionnaire;
    const total = questionnaire.questions.length;
    const page = panel ? panel.page() : 0;
    const phase = panel ? panel.phase() : 'questions';
    this.link.sendQuestionnaireState(
      buildQuestionnaireState(questionnaire, {
        open: panel?.isOpen() ?? false,
        // The finish/thanks pages are past the last question; the wire's index
        // stays on the last one so the tablet never points at a slot that does
        // not exist.
        page: phase === 'questions' ? page : Math.max(0, total - 1),
        answers: this.questionnaireAnswers,
        gazeDwell: this.gazeDwellEnabled,
        voice: this.questionnaireVoice
      })
    );
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


  /**
   * Switch product face. Training and questionnaire share the shell but not
   * the main area; a running session is never silently abandoned, so the
   * switch waits for 结束.
   */
  private applyAppCommand(id: string): void {
    if (!isAppId(id)) {
      this.refuse('未知应用');
      return;
    }
    // The whole lifecycle must be `idle`, not merely "not running": the
    // technician wait before the first capture is `calibrating` with no
    // `capturePending`, so a switch there used to carry `awaitingCalibration`
    // and the hold-still card into the questionnaire — the card and the sheet
    // on screen together, and a capture starting from a face that has no
    // training session behind it. Entering or leaving a session owns the face.
    if (!canSwitchApp(this.lifecycle.phase, this.capturePending)) {
      this.refuse('先结束会话，再切换应用');
      return;
    }
    if (this.activeApp === id) {
      return;
    }
    // The questionnaire is the one face with no ambience and no training
    // content: it takes its own empty room, and the operator's scene is kept
    // aside so switching back does not cost them a choice.
    const leaving = this.activeApp;
    this.activeApp = id;
    if (id === 'questionnaire') {
      if (leaving !== 'questionnaire') {
        this.trainingSceneId = this.sceneId;
      }
      this.stopSceneAudio();
      const survey = getSceneDefinition('survey');
      if (survey && survey.id !== this.sceneId) {
        this.sceneId = survey.id;
        this.loadScene();
      }
      // Re-entering the face is a new respondent: the previous sheet — its
      // answers, its page and the panel's cached draft — belongs to them, not
      // to the person about to answer.
      this.resetQuestionnaireSheet();
      // The sheet is the face's content, not a modal it has to summon.
      this.openQuestionnaire();
    } else {
      // A face switch is a deliberate exit: archive whatever the patient has
      // answered before the panel is hidden and the answers are cleared.
      this.fileQuestionnaireSheet();
      this.questionnairePanel?.close();
      this.resetQuestionnaireSheet();
      const back = getSceneDefinition(this.trainingSceneId) ?? SCENE;
      if (back && back.id !== this.sceneId) {
        this.sceneId = back.id;
        this.loadScene();
      }
      this.startSceneAudio();
    }
    this.report(`应用：${appLabel(id)}`);
  }


  private handleRemoteCommand(raw: string): void {
    // The bedside question is answered on the tablet after the headset is off,
    // so it arrives as a command rather than as part of the session itself.
    const outcome = /^record:outcome:(attempt|success):(yes|no)$/.exec(raw);
    if (outcome) {
      const slot: OutcomeSlot = outcome[1] === 'attempt' ? 'attempt' : 'success';
      const which = slot === 'attempt' ? 'attempted' : 'succeeded';
      const value = outcome[2] === 'yes';
      this.sessions = annotateOutcome(sessionStorageSafe(), { [which]: value });
      this.start.setStatus(value ? '已记录：是' : '已记录：否', 'ok');
      // The tablet flips its own button on this receipt, never on the command
      // acknowledgement: "I sent it" and "it was written" are different facts,
      // and a refused storage write would otherwise look like a success.
      const receipt: OutcomeReceipt = { slot, value, at: Date.now() };
      this.link.sendLog(this.activeApp, OUTCOME_RECORDED, { ...receipt });
      return;
    }
    if (raw.startsWith('app:')) {
      this.applyAppCommand(raw.slice('app:'.length));
      return;
    }
    const command = parseRemoteCommand(raw);
    if (!command) {
      return;
    }
    switch (command.kind) {
      case 'viewAnim':
        if (!this.viewCommandsAllowed()) {
          this.refuse('当前无法切换视角');
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
      case 'voice':
        this.applyVoiceCommand(command.command);
        return;
      case 'audioVolume':
        if (this.activeApp === 'questionnaire') {
          this.refuse('问卷应用没有环境声');
          return;
        }
        setAmbienceVolume(command.percent / 100);
        this.report(`水声音量 ${command.percent}%`, 'ok');
        return;
      case 'floatBreath':
        this.floating.setBreath(command.on);
        this.report(command.on ? '起伏呼吸已开' : '起伏呼吸已关', 'ok');
        this.link.sendStateNow();
        return;
      case 'floatLevel': {
        const cap = this.floatCap();
        const asked = command.percent / 100;
        const applied = this.floating.setAmount(asked, cap);
        this.start.setStatus(
          applied === asked
            ? `起伏 ${Math.round(applied * 100)}%`
            : cap <= 0
              ? '本场景无起伏'
              : `本段最高 ${Math.round(cap * 100)}%`,
          'ok'
        );
        this.link.sendStateNow();
        return;
      }
      case 'riseDuration':
        this.world.setDuration(command.ms);
        this.report(`起身时长 ${(command.ms / 1000).toFixed(0)} 秒`, 'ok');
        return;
      case 'gazeDwell':
        if (this.activeApp !== 'questionnaire') {
          this.refuse('目视选择属于问卷应用');
          return;
        }
        this.gazeDwellEnabled = command.on;
        this.questionnairePanel?.setDwellEnabled(command.on);
        this.report(command.on ? '目视选择已开启' : '目视选择已关闭', 'ok');
        // The tablet draws the switch from the page, so the page says so.
        this.publishQuestionnaireState();
        return;
      // The sheet belongs to the questionnaire face, never to training: a
      // questionnaire opened under 训练 would file a record against a session
      // that never showed one.
      case 'questionnaireVoice':
        if (this.activeApp !== 'questionnaire') {
          this.refuse('问卷属于问卷应用');
          return;
        }
        this.questionnaireVoice = command.on;
        this.report(`问卷语音${command.on ? '开' : '关'}`);
        // Turning voice on is also "say this one": the operator flipped it
        // because the patient needs to hear the question they are on.
        if (command.on) {
          void this.speakQuestion(
            this.activeQuestionnaire,
            this.questionnairePanel?.page() ?? 0
          );
        }
        this.publishQuestionnaireState();
        return;
      case 'questionnaireSelect':
        this.selectQuestionnaire(command.id);
        return;
      case 'questionnaireOpen':
      case 'questionnaireClose':
      case 'questionnaireReplay':
      case 'questionnaireShow':
      case 'questionnaireAnswer':
        if (this.activeApp !== 'questionnaire') {
          this.refuse('问卷属于问卷应用');
          return;
        }
        switch (command.kind) {
          case 'questionnaireOpen':
            this.openQuestionnaire();
            return;
          case 'questionnaireReplay':
            // Reading the question again is a request aimed at whatever is on
            // the card; with no card, it opens one on the current question.
            if (this.questionnairePanel?.isOpen()) {
              this.questionnairePanel.replay();
            } else {
              this.openQuestionnaire();
            }
            return;
          case 'questionnaireShow':
            // 1-based on the wire, 0-based in the panel. The instrument's own
            // count is the bound: the grammar allows 1..100, the sheet may be
            // three questions long.
            if (command.index > this.activeQuestionnaire.questions.length) {
              this.refuse(
                `${this.activeQuestionnaire.name.zh}共 ${this.activeQuestionnaire.questions.length} 题`
              );
              return;
            }
            this.openQuestionnaire();
            this.questionnairePanel?.show(command.index - 1);
            this.publishQuestionnaireState();
            return;
          case 'questionnaireAnswer':
            // The value is one of the instrument's options, or nothing
            // happens: a four-option sheet has no answer 5.
            if (!this.activeQuestionnaire.options.some((option) => option.value === command.value)) {
              this.refuse(`${this.activeQuestionnaire.name.zh}没有选项 ${command.value}`);
              return;
            }
            this.openQuestionnaire();
            this.questionnairePanel?.answer(command.value);
            return;
          default:
            this.questionnairePanel?.close();
            return;
        }
      case 'calibrate':
        // Repeated taps while the capture is averaging used to restart the
        // window, so the operator saw a card that never completed. The capture
        // is authoritative until it lands or times out.
        if (this.capturePending) {
          this.refuse('正在记录体位，请保持不动');
          return;
        }
        if (this.awaitingCalibration) {
          this.beginCalibration();
        } else {
          this.recalibrate();
        }
        return;
      case 'exit':
        this.exitAll();
        return;
      case 'audio':
        if (this.activeApp === 'questionnaire') {
          this.refuse('问卷应用没有环境声');
          return;
        }
        this.applySceneBed(
          command.state === 'toggle' ? !this.sceneBedOn : command.state === 'on'
        );
        return;
      case 'postureMix':
        // The first sample of a drag *is* the manual override: the hand owns
        // the correction from here, so the scheduled rise and any view animation
        // stop where they are, and the page's own rate cap takes over from there.
        if (this.capturePending) {
          this.refuse('记录体位时无法调整姿态');
          return;
        }
        this.cancelAutoRise();
        this.viewMotion.stop();
        if (!this.world.setMixTarget(command.percent / 100)) {
          this.refuse('起身需要先完成体位记录');
        }
        return;
      case 'posture':
        // The operator's ramp wins: drop any scheduled automatic rise.
        this.cancelAutoRise();
        if (command.target === 'stop') {
          // The capture already drives posture to neutral; do not freeze it.
          if (!this.capturePending) {
            this.stopSitUp();
          }
          return;
        }
        this.setVirtualPosture(command.target === 'rise');
        return;
      case 'invalid':
        this.start.setStatus(command.message, 'error');
        return;
      case 'unknown':
        this.start.setStatus(`${this.strings.remoteUnknown}: ${raw}`, 'error');
        return;
    }
  }

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
        calibrated: world.ready,
        // The scalar that poses the world: the tablet's buttons and its
        // progress bar both derive from it, so they cannot disagree.
        correctionMix: world.mix,
        correctionMoving: world.moving,
        // The loaded scene's buoyancy ceiling travels with the state so the
        // tablet's stepper clamps to the same number the page enforces.
        floatCap: this.floatCap()
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
    if (this.linkOnline && !wasOnline) {
      // Every connection gets the catalogue: the tablet may have been open
      // before this page loaded, and a stale list is worse than none.
      this.link.sendCatalog(catalogEntries());
      // The questionnaire catalogue itself never crosses the link: both APKs
      // are built from the same generated data file, so the tablet already
      // holds every instrument, its wording and its options. What does cross is
      // the sheet's live state, so the control side knows which question the
      // patient is on and what the gaze has answered.
      this.publishQuestionnaireState();
    }
    // The entry screen carries the link state: without it a dead socket looks
    // exactly like a silent headset.
    // Only the fact, and only when it matters. "正在重连" is the system
    // narrating itself; the tablet either answers or it does not.
    this.start.setHint(status === 'open' ? '' : '平板未连接');
    if (status === 'open') {
      this.linkEverOnline = true;
      this.returnLink();
      return;
    }
    if (!wasOnline) {
      // Startup: the socket has not opened yet. The browser is mid-load, and a
      // timer here would kill a session that has not begun.
      return;
    }
    if (!this.linkEverOnline) {
      return;
    }
    this.dropLink();
  }

  /** Feed one event into the link guard and act on the state it lands in. */
  private advanceLink(event: LinkEvent): LinkGuardState {
    const before = this.linkGuard.phase;
    this.linkGuard = reduceLink(this.linkGuard, event);
    const after = this.linkGuard.phase;
    if (after === before) {
      return this.linkGuard;
    }
    if (after === 'frozen') {
      this.freezeForLinkLoss();
    }
    if (after === 'lost') {
      this.abandonSession();
    }
    return this.linkGuard;
  }

  /**
   * The tablet is gone: freeze the session, do not end it.
   *
   * This is the emergency stop as well as the disconnect — there is no separate
   * e-stop on the tablet, so a frozen world *is* the stop. Motion is frozen
   * where it stands (no recenter: the pitch target is held), the sit-up brakes
   * at its current angle, voice stops mid-clip and the ambience is silenced.
   * The session keeps running underneath, so a reconnect continues it.
   */
  private freezeForLinkLoss(): void {
    // One line, and it is the same whether or not a session is live: outside
    // one there is nothing frozen, only a tablet that is not answering.
    this.start.setStatus(this.session ? this.strings.linkLostGrace : this.strings.controlModeOff, 'error');
    this.cancelAutoRise();
    this.viewMotion.stop();
    this.stopSitUp();
    this.voice.stop();
    this.stopSceneAudio();
    // A capture in flight dies with the operator: the hold-still card must not
    // stay up over a frozen world, and `capturePending` would otherwise keep
    // the world held after the tablet comes back. The frame it would have
    // recorded is taken again when the operator asks, on a live link.
    if (this.capturePending) {
      this.capturePending = false;
      this.calibrationOverlay?.hide();
      this.world.hold(false);
      this.awaitingCalibration = false;
    }
  }

  /** The tablet is back inside the window: continue exactly where we were. */
  private returnLink(): void {
    const wasFrozen = isFrozen(this.linkGuard);
    if (this.linkLostTimer !== 0) {
      window.clearTimeout(this.linkLostTimer);
      this.linkLostTimer = 0;
    }
    // Resuming is not a new session: the clock, the peaks and the segments all
    // keep their values; only the frozen outputs are re-armed.
    this.linkGuard = reduceLink(this.linkGuard, { type: 'return' });
    if (!wasFrozen || !this.session) {
      return;
    }
    this.startSceneAudio();
    this.start.setStatus('已恢复连接', 'ok');
    this.link.sendStateNow();
    this.updateHud(performance.now());
  }

  /** A session ended for its own reasons; the guard starts clean. */
  private resetLinkGuard(): void {
    if (this.linkLostTimer !== 0) {
      window.clearTimeout(this.linkLostTimer);
      this.linkLostTimer = 0;
    }
    this.linkGuard = reduceLink(this.linkGuard, { type: 'reset' });
  }

  /**
   * The socket closed while a session was live.
   *
   * Outside a session this is only a hint; inside one it starts the five-second
   * window. The timer is the guard's clock: it fires `elapse` for the whole
   * grace period, so "reconnected at 4.9 s" and "reconnected at 5.1 s" are
   * decided by one state machine instead of by two timers racing.
   */
  private dropLink(): void {
    // Nothing to freeze outside a session, and a flapping socket must not
    // restart the window: a broken link cannot hold a patient forever.
    if (!this.session || this.linkGuard.phase !== 'online') {
      if (!this.session) {
        this.linkGuard = INITIAL_LINK;
      }
      return;
    }
    this.advanceLink({ type: 'drop' });
    if (this.linkLostTimer !== 0) {
      window.clearTimeout(this.linkLostTimer);
    }
    this.linkLostTimer = window.setTimeout(() => {
      this.linkLostTimer = 0;
      if (this.linkOnline) {
        return;
      }
      this.advanceLink({ type: 'elapse', ms: LINK_LOST_GRACE_MS });
    }, LINK_LOST_GRACE_MS);
  }

  /**
   * The tablet is not coming back: the session is over.
   *
   * This is the only path a link loss takes to a stop, and it stops for the one
   * reason `link-lost` — never `session-end`. The reducer is asked first so the
   * ledger records why, then `end()` runs the renderer's own teardown, which
   * fires the session's `end` event; that path lands in `onSessionEnd` and
   * returns the patient to the entry screen with the world unloaded.
   */
  private abandonSession(): void {
    this.start.setStatus(this.strings.linkLostExit);
    this.abandoned = true;
    this.dispatch({ type: 'stop', reason: 'link-lost' });
    const session = this.session;
    if (session) {
      void session.end();
    }
  }


  private setControlMode(active: boolean): void {
    if (this.controlMode === active) {
      return;
    }
    this.controlMode = active;
    document.body.classList.toggle('control-mode', active);
    if (active) {
      // Re-claiming the tablet is the reconnect for a BLE-only outage: the
      // socket may never have closed, so the five-second window must be
      // cancelled here as well as on a WebSocket open.
      this.returnLink();
      if (this.session) {
        const sheetOpen = this.questionnairePanel?.isOpen() ?? false;
        this.input.setLayers(sheetOpen, false);
      }
      this.start.setStatus(this.strings.controlModeOn, 'ok');
    } else {
      // The tablet stopped driving: that is a link loss, and it takes the same
      // path as a dead socket — freeze now, and let the five-second window
      // decide whether this was a pause or the end of the session.
      this.dropLink();
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
      this.refuse('起身需要先完成体位记录');
      return;
    }
    if (this.capturePending) {
      this.refuse('记录体位时无法调整姿态');
      return;
    }
    if (rising && this.sceneRestMix >= 1) {
      this.start.setStatus('本场景已是站立视角', 'ok');
      return;
    }
    this.world.rise(rising ? 1 : 0);
    this.start.setStatus(
      rising ? '正在放大视野，随时可停' : '正在回到现在的视角，随时可停',
      'ok'
    );
  }

  private stopSitUp(): void {
    if (!this.world.state().moving) {
      return;
    }
    this.world.stopRise();
    this.start.setStatus('已停在当前视角', 'ok');
  }

  private applySceneBed(on: boolean): void {
    // The questionnaire face is silent by construction: its room declares no
    // ambience and this switch cannot turn one on while it owns the world.
    if (this.activeApp === 'questionnaire') {
      this.sceneBedOn = false;
      this.stopSceneAudio();
      return;
    }
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
    // One short phrase per fact, joined by a hair space dot: the bar is a
    // status line, not a table. "体位" is the patient-facing word for the
    // recorded posture; "校准" belongs to the operator side
    // (docs/copy-deck.md).
    const calibrationState = state.calibrating
      ? '记录中'
      : state.calibrated
        ? '体位已记录'
        : '体位未记录';
    const mode = this.xr.isPresenting ? '头显' : this.previewing ? '预览' : '待机';
    // Actual render stats, including both XR eyes. Design-time scene counts
    // hid the real per-frame load and the double-eye render in XR.
    const render = this.renderer.info.render;
    const budget = this.renderMonitor.snapshot();
    const summary = [
      mode,
      this.host.definition?.name[this.config.lang] ?? SCENE.name[this.config.lang],
      calibrationState,
      `${XR_FRAMEBUFFER_SCALE.toFixed(2)}x`,
      `${(render.triangles / 1000).toFixed(1)}k 面`,
      `${render.calls} 批次`,
      `p95 ${budget.p95Ms.toFixed(0)}ms`,
      `t×${this.clockSurvey.ratio.toFixed(2)}`,
      this.sceneBedOn ? '水声开' : '水声关'
    ].join('︱');
    this.hud.setStats(this.fps, summary);
  }

  /**
   * Whether the loaded scene may move on its own this frame (the light well's
   * fall). It is a session fact, not a posture one: a running session or the
   * 2D preview may move the world, a stop, a calibration capture or an idle
   * page may not. Allocation-free, per frame.
   */
  private computeSceneMotion(): number {
    if (this.previewFlow !== null) {
      return this.previewFlow;
    }
    if (this.capturePending) {
      return 0;
    }
    return this.previewing || isActive(this.lifecycle) ? 1 : 0;
  }

  /** Collect the facts telemetry, the HUD and command handlers all read. */
  /**
   * One collected view of the world for the state frame. Built as a literal —
   * it is sent at ≤10 Hz, and a field-by-field mutation of a reused object was
   * 40 lines of assignments whose only benefit was avoiding one allocation.
   */
  /** Fold the current frame's dose into the session peaks and segment spans. */
  private sampleDose(worldMix: number, upGazeDeg: number): void {
    if (this.sessionStartedAt <= 0) {
      return;
    }
    this.peakMix = Math.max(this.peakMix, worldMix);
    this.peakUpGazeDeg = Math.max(this.peakUpGazeDeg, Math.abs(upGazeDeg));
    this.segmentPeakMix = Math.max(this.segmentPeakMix, worldMix);
    this.segmentPeakUpGazeDeg = Math.max(this.segmentPeakUpGazeDeg, Math.abs(upGazeDeg));
  }

  /** Buoyancy ceiling declared by the manually selected scene. */
  private floatCap(): number {
    return this.sceneComfort;
  }

  /** Close the current scene dwell at [now]; a manual scene change opens another. */
  private closeSegment(now: number): void {
    if (this.segmentStartedAt <= 0) {
      return;
    }
    const seconds = (now - this.segmentStartedAt) / 1000;
    if (seconds > 0.5) {
      this.segments.push({
        scene: this.sceneId,
        seconds,
        peakMix: Number(this.segmentPeakMix.toFixed(3)),
        peakUpGazeDeg: Math.round(this.segmentPeakUpGazeDeg)
      });
    }
    this.segmentStartedAt = 0;
  }


  private captureSnapshot(): SceneSnapshot {
    const now = performance.now();
    const world = this.world.state();
    // The dose is sampled here because this runs at the state-frame cadence and
    // both quantities are ramps measured in seconds, not frame spikes.
    this.sampleDose(world.mix, degrees(this.viewMotion.getUpGazeDeg()));
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
    const playing = this.voice.nowPlaying().id;
    const snapshot = this.snapshot.capture({
      sceneId: this.sceneId,
      app: this.activeApp,
      loaded: this.handle !== null,
      session: this.session !== null,
      calibrating: this.lifecycle.phase === 'calibrating',
      calibrated: comfort?.isCalibrated() ?? false,
      audioMuted: !this.sceneBedOn,
      // The applied eye, not the operator's setting: it rises with the mix, so
      // the tablet and the mirror show where the patient's eye actually is.
      eyeHeight: metres(world.eyeY),
      worldQuat: this.worldQuat,
      worldT: {
        x: metres(this.worldPos.x),
        y: metres(this.worldPos.y),
        z: metres(this.worldPos.z)
      },
      confidence: comfort?.isCalibrated() ? 1 : 0,
      correctionMix: world.mix,
      correctionTarget: world.target,
      correctionMoving: world.moving,
      lookYawDeg: degrees(this.viewMotion.getLookYawDeg()),
      lookYawTargetDeg: degrees(this.viewMotion.getTargetLookYawDeg()),
      upGazeDeg: degrees(this.viewMotion.getUpGazeDeg()),
      upGazeTargetDeg: degrees(this.viewMotion.getTargetUpGazeDeg()),
      viewAnim: this.viewMotion.getStateName(),
      floorOffset: metres(this.host.floor),
      floatAmount: motion.amount,
      floatBreath: motion.breath,
      // Applied motion, not the requested level: the mirror adds these verbatim.
      floatMm: motion.offsetM * 1000,
      sessionSec:
        this.sessionStartedAt > 0
          ? Math.floor((now - this.sessionStartedAt) / 1000)
          : 0,
      // The ramp the page holds, so the tablet's chosen length is a readback
      // and not a local guess that a page reload would silently invalidate.
      rampMs: Math.round(world.durationMs),
      voiceId: playing ? this.voice.indexOf(playing) : -1,
      caps: this.plan?.capabilities ?? {
        rise: false,
        lie: false,
        stop: false,
        float: false,
        view: false,
        blocked: '未开始会话',
        floatCap: this.floatCap()
      }
    });
    return snapshot;
  }

  dispose(): void {
    this.clearTimers();
    // A curtain timer belongs to the page, not to a session: void it so a
    // pending swap cannot touch a scene the disposer has already taken apart.
    invalidateLayout(this.layout);
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
