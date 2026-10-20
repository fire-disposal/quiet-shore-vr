export type RemoteCommandHandler = (command: string) => void;
export type ControlModeHandler = (active: boolean) => void;

interface ControlPayload {
  seq?: number;
  command?: string | null;
  control?: boolean;
  controller?: string | null;
}

const POLL_MS = 100;
const SSE_RETRY_BASE_MS = 300;
const SSE_RETRY_MAX_MS = 3000;
const SSE_MAX_RETRIES = 4;

/**
 * Receives portal commands over the loopback bridge.
 *
 * The portal pushes snapshots on `/events` (SSE). If EventSource is missing,
 * cannot connect, or keeps failing, the same snapshots are read from
 * `/control` at 100 ms. Only one transport runs at a time: polling never
 * starts while a stream is open or retrying, and a stream is closed before
 * polling starts. View movement keeps its own 300 ms TTL in App, so a dropped
 * stream cannot leave the scene moving.
 */
export class RemoteControl {
  private source: EventSource | null = null;
  private pollTimer: number | null = null;
  private retryTimer: number | null = null;
  private retries = 0;
  private running = false;
  private lastSeq = -1;
  private controlMode = false;
  private busy = false;

  constructor(
    private readonly onCommand: RemoteCommandHandler,
    private readonly onControlMode: ControlModeHandler
  ) {}

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.connectStream();
  }

  stop(): void {
    this.running = false;
    this.closeStream();
    if (this.retryTimer != null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.pollTimer != null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private connectStream(): void {
    if (!this.running) {
      return;
    }
    if (this.retryTimer != null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (typeof EventSource === 'undefined') {
      this.startPolling();
      return;
    }
    let source: EventSource;
    try {
      source = new EventSource('/events');
    } catch {
      // Constructor validation failures (bad URL, blocked scheme) are final.
      this.startPolling();
      return;
    }
    this.source = source;
    source.addEventListener('control', this.handleControl);
    source.addEventListener('state', this.handleState);
    source.addEventListener('open', this.handleOpen);
    source.addEventListener('error', this.handleError);
  }

  private closeStream(): void {
    const source = this.source;
    if (!source) {
      return;
    }
    this.source = null;
    source.removeEventListener('control', this.handleControl);
    source.removeEventListener('state', this.handleState);
    source.removeEventListener('open', this.handleOpen);
    source.removeEventListener('error', this.handleError);
    source.close();
  }

  private startPolling(): void {
    if (!this.running || this.pollTimer != null) {
      return;
    }
    this.closeStream();
    if (this.retryTimer != null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.pollTimer = window.setInterval(() => void this.poll(), POLL_MS);
    void this.poll();
  }

  private readonly handleOpen = (): void => {
    // A delivered connection proves the endpoint; forget past failures.
    this.retries = 0;
  };

  private readonly handleError = (event: Event): void => {
    const source = this.source;
    if (!this.running || !source || event.target !== source) {
      return;
    }
    // A broken push channel cannot prove the lease holder still controls.
    // Halt operator motion now; polling or the next snapshot restores the
    // authoritative flag.
    this.applyControl(false);
    // The browser only reports CLOSED for fatal responses (e.g. 204/4xx
    // endpoints); CONNECTING still permits a manual reconnect attempt.
    const fatal = source.readyState === EventSource.CLOSED;
    this.closeStream();
    if (fatal) {
      this.startPolling();
      return;
    }
    this.retries += 1;
    if (this.retries > SSE_MAX_RETRIES) {
      this.startPolling();
      return;
    }
    const delay = Math.min(
      SSE_RETRY_BASE_MS * 2 ** (this.retries - 1),
      SSE_RETRY_MAX_MS
    );
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.connectStream();
    }, delay);
  };

  private readonly handleControl = (event: Event): void => {
    if (!this.running) {
      return;
    }
    const data = (event as MessageEvent).data;
    if (typeof data !== 'string') {
      return;
    }
    let payload: ControlPayload;
    try {
      payload = JSON.parse(data) as ControlPayload;
    } catch {
      return;
    }
    this.apply(payload);
  };

  /**
   * CLAIM/RELEASE only changes `control`, not the command slot, so it arrives
   * as its own frame and must bypass seq dedupe.
   */
  private readonly handleState = (event: Event): void => {
    if (!this.running) {
      return;
    }
    const data = (event as MessageEvent).data;
    if (typeof data !== 'string') {
      return;
    }
    let payload: ControlPayload;
    try {
      payload = JSON.parse(data) as ControlPayload;
    } catch {
      return;
    }
    this.applyControl(payload.control);
  };

  /** Shared by SSE and polling so seq dedupe and mode changes stay identical. */
  private apply(data: ControlPayload): void {
    if (!this.running) {
      return;
    }
    this.applyControl(data.control);
    if (typeof data.seq !== 'number' || data.seq <= this.lastSeq) {
      return;
    }
    this.lastSeq = data.seq;
    if (typeof data.command === 'string' && data.command.length > 0) {
      this.onCommand(data.command);
    }
  }

  private applyControl(control: unknown): void {
    if (typeof control !== 'boolean' || control === this.controlMode) {
      return;
    }
    this.controlMode = control;
    this.onControlMode(control);
  }

  private async poll(): Promise<void> {
    if (!this.running || this.busy || this.pollTimer == null) {
      return;
    }
    this.busy = true;
    try {
      const response = await fetch('/control', { cache: 'no-store' });
      if (!this.running || this.pollTimer == null || !response.ok) {
        return;
      }
      const data = (await response.json()) as ControlPayload;
      this.apply(data);
    } catch {
      // Dev server or transient socket failure; keep polling.
    } finally {
      this.busy = false;
    }
  }
}
