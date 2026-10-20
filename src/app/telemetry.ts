export interface PoseSnapshot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface StateSnapshot {
  scene: string;
  session: boolean;
  calibrating: boolean;
  audio: boolean;
}

const POSE_MS = 200;
const STATE_MS = 1000;
const POST_OPTIONS: RequestInit = {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  cache: 'no-store',
  keepalive: true
};

/**
 * Sends live pose at 5 Hz and compact state at 1 Hz to the portal's loopback
 * server. The BLE peripheral drops these when no tablet is authenticated.
 */
export class TelemetrySender {
  private poseTimer: number | null = null;
  private stateTimer: number | null = null;

  constructor(
    private readonly getPose: () => PoseSnapshot,
    private readonly getState: () => StateSnapshot
  ) {}

  start(): void {
    if (this.poseTimer != null) {
      return;
    }
    this.poseTimer = window.setInterval(() => this.sendPose(), POSE_MS);
    this.stateTimer = window.setInterval(() => this.sendState(), STATE_MS);
    this.sendPose();
    this.sendState();
  }

  stop(): void {
    if (this.poseTimer != null) {
      window.clearInterval(this.poseTimer);
      this.poseTimer = null;
    }
    if (this.stateTimer != null) {
      window.clearInterval(this.stateTimer);
      this.stateTimer = null;
    }
  }

  sendStateNow(): void {
    this.sendState();
  }

  private sendPose(): void {
    const pose = this.getPose();
    if (![pose.x, pose.y, pose.z, pose.yaw, pose.pitch].every(Number.isFinite)) {
      return;
    }
    void fetch('/telemetry', {
      ...POST_OPTIONS,
      body: JSON.stringify(pose)
    }).catch(() => void 0);
  }

  private sendState(): void {
    const state = this.getState();
    void fetch('/state', {
      ...POST_OPTIONS,
      body: JSON.stringify(state)
    }).catch(() => void 0);
  }
}
