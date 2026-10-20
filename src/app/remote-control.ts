export type RemoteCommandHandler = (command: string) => void;
export type ControlModeHandler = (active: boolean) => void;

interface ControlPayload {
  seq?: number;
  command?: string | null;
  control?: boolean;
}

const POLL_MS = 400;

/**
 * Polls the portal's loopback /control endpoint. The portal writes BLE
 * commands there; same-origin fetch keeps the WebXR page sandboxed.
 */
export class RemoteControl {
  private timer: number | null = null;
  private lastSeq = -1;
  private controlMode = false;
  private busy = false;

  constructor(
    private readonly onCommand: RemoteCommandHandler,
    private readonly onControlMode: ControlModeHandler
  ) {}

  start(): void {
    if (this.timer != null) {
      return;
    }
    this.timer = window.setInterval(() => void this.poll(), POLL_MS);
    void this.poll();
  }

  stop(): void {
    if (this.timer != null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      const response = await fetch('/control', { cache: 'no-store' });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as ControlPayload;
      if (typeof data.control === 'boolean' && data.control !== this.controlMode) {
        this.controlMode = data.control;
        this.onControlMode(data.control);
      }
      if (typeof data.seq !== 'number' || data.seq <= this.lastSeq) {
        return;
      }
      this.lastSeq = data.seq;
      if (typeof data.command === 'string' && data.command.length > 0) {
        this.onCommand(data.command);
      }
    } catch {
      // Dev server or transient socket failure; keep polling.
    } finally {
      this.busy = false;
    }
  }
}
