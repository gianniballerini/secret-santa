// Tiny tween helper. No GSAP in the project, so this is all the timeline needs.

export type Easing = (t: number) => number;

export const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const linear: Easing = (t) => clamp01(t);
export const easeInCubic: Easing = (t) => clamp01(t) ** 3;
export const easeInOutCubic: Easing = (t) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
};

// Same curve as CSS cubic-bezier(x1, y1, x2, y2), so 3D motion matches the tokens.
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  const coord = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3;
  const slope = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 + 6 * (b - a) * (1 - t) * t + 3 * (1 - b) * t ** 2;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // Newton first, bisection if the slope is too flat.
    let t = x;
    for (let i = 0; i < 6; i++) {
      const err = coord(x1, x2, t) - x;
      const d = slope(x1, x2, t);
      if (Math.abs(err) < 1e-6) return coord(y1, y2, t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const err = coord(x1, x2, t) - x;
      if (Math.abs(err) < 1e-6) break;
      if (err > 0) hi = t;
      else lo = t;
      t = (lo + hi) / 2;
    }
    return coord(y1, y2, t);
  };
}

// Mirror --ease-out and --ease-pop from src/styles/_tokens.scss.
export const easeOut = cubicBezier(0.215, 0.61, 0.355, 1);
export const easePop = cubicBezier(0, 1.52, 0.295, 0.86);

// Runs onUpdate(eased 0..1) every frame. Resolves true when finished, false when aborted.
export function tween(duration: number, ease: Easing, onUpdate: (v: number) => void, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const start = performance.now();
    const step = (now: number) => {
      if (signal?.aborted) return resolve(false);
      const t = duration <= 0 ? 1 : clamp01((now - start) / duration);
      onUpdate(ease(t));
      if (t >= 1) return resolve(true);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
