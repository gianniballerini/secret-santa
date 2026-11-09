import { clamp01 } from './tween';

/** What the jar can be asked to do. Spin values are radians; velocity is radians per millisecond. */
export interface JarControlHandlers {
  onSpinStart(): void;
  onSpin(delta: number): void;
  onSpinEnd(velocity: number): void;
  onTap(): void;
  onShake(): void;
  /** x and y in -1..1: pointer position on desktop, device tilt on phones. */
  onTilt(x: number, y: number): void;
}

export interface JarControls {
  /** Take the current device orientation as neutral, so parallax starts centred. */
  resetTiltBaseline(): void;
}

const TAP_SLOP = 6; // px of movement before a press becomes a drag
const TAP_MS = 300;
const SPIN_PER_WIDTH = Math.PI; // dragging across the whole stage turns the jar half a turn
const SHAKE_DELTA = 15; // m/s² jump between motion samples that counts as a jolt
const SHAKE_JOLTS = 2; // jolts needed inside the window
const SHAKE_WINDOW_MS = 400;
const SHAKE_COOLDOWN_MS = 1000;
const TILT_RANGE = 20; // degrees of device tilt that map to full parallax

const clampUnit = (v: number) => clamp01((v + 1) / 2) * 2 - 1;

type PermissionRequest = { requestPermission?: () => Promise<string> };
let permissionAsked = false;

/** iOS only delivers motion and orientation after the user grants it from a gesture. Elsewhere this is a no-op. */
export function requestMotionPermission(): void {
  if (permissionAsked) return;
  permissionAsked = true;
  const ctors = [window.DeviceMotionEvent, window.DeviceOrientationEvent] as unknown as Array<PermissionRequest | undefined>;
  for (const ctor of ctors) {
    const request = ctor?.requestPermission;
    if (request) void request.call(ctor).catch(() => {});
  }
}

export function createJarControls(target: HTMLElement, h: JarControlHandlers, signal: AbortSignal): JarControls {
  const opts = { signal };

  // Drag to spin, tap to shake.
  let pointer = -1;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let lastX = 0;
  let lastTime = 0;
  let velocity = 0;
  let dragging = false;

  const toRadians = (px: number) => (px / Math.max(target.clientWidth, 1)) * SPIN_PER_WIDTH;

  target.addEventListener('pointerdown', (e) => {
    if (pointer !== -1 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pointer = e.pointerId;
    startX = lastX = e.clientX;
    startY = e.clientY;
    startTime = lastTime = e.timeStamp;
    velocity = 0;
    dragging = false;
    target.setPointerCapture(e.pointerId);
  }, opts);

  target.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointer) return;
    if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) > TAP_SLOP) {
      dragging = true;
      target.classList.add('is-dragging');
      h.onSpinStart();
    }
    if (!dragging) return;
    const delta = toRadians(e.clientX - lastX);
    const dt = e.timeStamp - lastTime;
    if (dt > 0) velocity = velocity * 0.5 + (delta / dt) * 0.5;
    lastX = e.clientX;
    lastTime = e.timeStamp;
    h.onSpin(delta);
  }, opts);

  const release = (e: PointerEvent, cancelled: boolean) => {
    if (e.pointerId !== pointer) return;
    pointer = -1;
    target.classList.remove('is-dragging');
    if (dragging) {
      // A pause before letting go means no fling.
      h.onSpinEnd(e.timeStamp - lastTime > 80 ? 0 : velocity);
    } else if (!cancelled && e.timeStamp - startTime < TAP_MS) {
      requestMotionPermission();
      h.onTap();
    }
    dragging = false;
  };
  target.addEventListener('pointerup', (e) => release(e, false), opts);
  // Fires when the browser takes over a vertical swipe to scroll the page.
  target.addEventListener('pointercancel', (e) => release(e, true), opts);

  // Physical shake.
  let last: { x: number; y: number; z: number } | null = null;
  let jolts: number[] = [];
  let lastShake = -Infinity;
  window.addEventListener('devicemotion', (e) => {
    const a = e.accelerationIncludingGravity;
    if (a?.x == null || a.y == null || a.z == null) return;
    const now = e.timeStamp;
    if (last) {
      const jump = Math.hypot(a.x - last.x, a.y - last.y, a.z - last.z);
      if (jump > SHAKE_DELTA) jolts.push(now);
      jolts = jolts.filter((t) => now - t < SHAKE_WINDOW_MS);
      if (jolts.length >= SHAKE_JOLTS && now - lastShake > SHAKE_COOLDOWN_MS) {
        lastShake = now;
        jolts = [];
        h.onShake();
      }
    }
    last = { x: a.x, y: a.y, z: a.z };
  }, opts);

  // Tilt: device orientation when the phone reports it, otherwise the mouse.
  let baseline: { beta: number; gamma: number } | null = null;
  let hasOrientation = false;
  window.addEventListener('deviceorientation', (e) => {
    if (e.beta == null || e.gamma == null) return;
    hasOrientation = true;
    baseline ??= { beta: e.beta, gamma: e.gamma };
    h.onTilt(clampUnit((e.gamma - baseline.gamma) / TILT_RANGE), clampUnit((e.beta - baseline.beta) / TILT_RANGE));
  }, opts);
  window.addEventListener('pointermove', (e) => {
    if (hasOrientation || e.pointerType === 'touch') return;
    h.onTilt(clampUnit((e.clientX / window.innerWidth) * 2 - 1), clampUnit((e.clientY / window.innerHeight) * 2 - 1));
  }, opts);

  return {
    resetTiltBaseline() {
      baseline = null;
    },
  };
}
