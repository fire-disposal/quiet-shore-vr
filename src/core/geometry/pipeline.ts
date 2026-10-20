import type { FramePhase, FrameTask } from './types';

/**
 * Ordered frame execution.
 *
 * Tasks run in fixed phase order (input → simulation → animation → layout →
 * render); inside a phase they are kept sorted by `order`, ties broken by
 * insertion sequence. The sorted lists are maintained on insert, so `run`
 * neither sorts nor allocates.
 *
 * Structural changes requested while a frame is running (add/remove) are
 * queued and applied after the frame. A cancelled task still in a list is
 * skipped immediately, so cancelling mid-frame always prevents that task from
 * running later in the same frame.
 */

export const FRAME_PHASES: readonly FramePhase[] = [
  'input',
  'simulation',
  'animation',
  'layout',
  'render'
];

const PHASE_INDEX: Readonly<Record<FramePhase, number>> = {
  input: 0,
  simulation: 1,
  animation: 2,
  layout: 3,
  render: 4
};

interface TaskSlot {
  task: FrameTask;
  seq: number;
  cancelled: boolean;
}

export class FramePipeline {
  private readonly buckets: TaskSlot[][];
  private readonly byId = new Map<string, TaskSlot>();
  private seq = 0;
  private running = false;
  private readonly pendingAdds: TaskSlot[] = [];
  private readonly pendingRemoves: TaskSlot[] = [];

  constructor(phases: readonly FramePhase[] = FRAME_PHASES) {
    this.buckets = phases.map(() => []);
  }

  get size(): number {
    return this.byId.size;
  }

  /**
   * Register a task. Returns a cancel function that removes it again; the
   * cancel function is idempotent and reports whether anything was removed.
   * Duplicate ids are rejected so cancelling is never ambiguous.
   */
  add(task: FrameTask): () => boolean {
    if (this.byId.has(task.id)) {
      throw new Error(`FramePipeline: duplicate task id "${task.id}"`);
    }
    if (this.running) {
      // Queue the slot but keep it out of the sorted list until the frame ends,
      // while reserving the id so a second add during the same frame fails.
      const slot: TaskSlot = { task, seq: this.seq++, cancelled: false };
      this.byId.set(task.id, slot);
      this.pendingAdds.push(slot);
      return () => this.remove(task.id);
    }
    this.insert({ task, seq: this.seq++, cancelled: false });
    return () => this.remove(task.id);
  }

  remove(id: string): boolean {
    const slot = this.byId.get(id);
    if (!slot) return false;
    this.byId.delete(id);
    slot.cancelled = true;
    if (this.running) {
      this.pendingRemoves.push(slot);
      return true;
    }
    const list = this.buckets[PHASE_INDEX[slot.task.phase]];
    const index = list.indexOf(slot);
    if (index >= 0) list.splice(index, 1);
    return true;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Run one frame. Re-entrant calls are ignored. */
  run(dt: number, now: number): void {
    if (this.running) return;
    this.running = true;
    try {
      for (let b = 0; b < this.buckets.length; b++) {
        const list = this.buckets[b];
        for (let i = 0; i < list.length; i++) {
          const slot = list[i];
          if (slot.cancelled) continue;
          slot.task.run(dt, now);
        }
      }
    } finally {
      this.running = false;
      this.flush();
    }
  }

  clear(): void {
    for (let b = 0; b < this.buckets.length; b++) {
      this.buckets[b].length = 0;
    }
    this.byId.clear();
    this.pendingAdds.length = 0;
    this.pendingRemoves.length = 0;
  }

  /** Insert a slot keeping its bucket sorted by (order, insertion sequence). */
  private insert(slot: TaskSlot): void {
    const task = slot.task;
    const list = this.buckets[PHASE_INDEX[task.phase]];
    let low = 0;
    let high = list.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const other = list[mid];
      if (
        other.task.order < task.order ||
        (other.task.order === task.order && other.seq < slot.seq)
      ) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    list.splice(low, 0, slot);
    this.byId.set(task.id, slot);
  }

  private flush(): void {
    for (let i = 0; i < this.pendingRemoves.length; i++) {
      const slot = this.pendingRemoves[i];
      const list = this.buckets[PHASE_INDEX[slot.task.phase]];
      const index = list.indexOf(slot);
      if (index >= 0) list.splice(index, 1);
    }
    this.pendingRemoves.length = 0;
    for (let i = 0; i < this.pendingAdds.length; i++) {
      const slot = this.pendingAdds[i];
      if (!slot.cancelled) this.insert(slot);
    }
    this.pendingAdds.length = 0;
  }
}
