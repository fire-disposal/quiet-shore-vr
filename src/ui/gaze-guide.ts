/**
 * Entry-screen gaze guide: blue dashed lines flow from the pointer (or from
 * four peripheral spokes when idle) into the "look at me" target. The effect
 * is intentionally explicit rather than decorative.
 */
export function createGazeGuide(canvas: HTMLCanvasElement, target: HTMLElement): () => void {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return () => undefined;
  }
  const context = canvas.getContext('2d');
  if (!context) {
    return () => undefined;
  }
  const ctx: CanvasRenderingContext2D = context;
  const start = document.getElementById('start');
  let width = 0;
  let height = 0;
  let dpr = 1;
  let pointerX = 0;
  let pointerY = 0;
  let pointerAt = 0;
  let running = true;

  function resize(): void {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function center(): { x: number; y: number; radius: number } {
    const box = target.getBoundingClientRect();
    return {
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
      radius: Math.max(48, Math.min(box.width, box.height) / 2)
    };
  }

  function onPointer(event: PointerEvent): void {
    if (start && start.hidden) return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    pointerAt = performance.now();
  }

  function dashedLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    phase: number,
    alpha: number,
    lineWidth: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = `rgba(112, 196, 255, ${alpha})`;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([9, 11]);
    ctx.lineDashOffset = -phase % 20;
    ctx.stroke();
  }

  function frame(now: number): void {
    if (!running) return;
    requestAnimationFrame(frame);
    if (start && start.hidden) return;

    const c = center();
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Four peripheral spokes keep pointing at the target even before the
    // pointer appears, and continue as an ambient guide while it rests.
    const fresh = now - pointerAt < 1600;
    const spokeAlpha = fresh ? 0.16 : 0.3;
    for (let i = 0; i < 4; i += 1) {
      const angle = Math.PI / 4 + i * (Math.PI / 2);
      const inner = c.radius + 34;
      const outer = c.radius + Math.max(96, Math.min(width, height) * 0.19);
      dashedLine(
        c.x + Math.cos(angle) * outer,
        c.y + Math.sin(angle) * outer * 0.72,
        c.x + Math.cos(angle) * inner,
        c.y + Math.sin(angle) * inner * 0.72,
        now / 26 + i * 4,
        spokeAlpha,
        1.2
      );
    }

    // Dashed ring around the target, slowly flowing clockwise.
    ctx.save();
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.radius + 20, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(112, 196, 255, ${fresh ? 0.18 : 0.3})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 12]);
    ctx.lineDashOffset = -(now / 60) % 16;
    ctx.stroke();
    ctx.restore();

    // The explicit guide: pointer -> target, animated inward.
    if (pointerAt > 0) {
      const dx = c.x - pointerX;
      const dy = c.y - pointerY;
      const distance = Math.hypot(dx, dy);
      if (distance > c.radius + 30) {
        const edgeX = c.x - (dx / distance) * (c.radius + 14);
        const edgeY = c.y - (dy / distance) * (c.radius + 14);
        dashedLine(pointerX, pointerY, edgeX, edgeY, now / 22, 0.72, 2);
        // A short solid pip at the pointer makes the line's origin obvious.
        ctx.beginPath();
        ctx.arc(pointerX, pointerY, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(150, 213, 255, .8)';
        ctx.fill();
      }
    }
  }

  function stop(): void {
    running = false;
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', onPointer);
    ctx.clearRect(0, 0, width, height);
  }

  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onPointer, { passive: true });
  requestAnimationFrame(frame);
  return stop;
}
