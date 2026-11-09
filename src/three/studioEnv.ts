import { CanvasTexture, EquirectangularReflectionMapping, PMREMGenerator, SRGBColorSpace } from 'three';
import type { Texture, WebGLRenderer } from 'three';

interface Panel {
  u: number; // centre, 0..1 around the horizon (0.75 = behind the camera, facing the jar)
  v: number; // centre, 0 = top .. 1 = bottom
  w: number;
  h: number;
  intensity: number;
}

// Tuning knobs: these rectangles ARE the reflections on the glass and the lid.
const PANELS: Panel[] = [
  { u: 0.75, v: 0.12, w: 0.5, h: 0.2, intensity: 1 }, // big soft key, above-front (lights the paper, lid top)
  { u: 0.62, v: 0.45, w: 0.04, h: 0.55, intensity: 1 }, // vertical strip for the long glass highlight
  { u: 0.9, v: 0.45, w: 0.05, h: 0.5, intensity: 0.85 }, // opposite rim strip
  { u: 0.25, v: 0.35, w: 0.3, h: 0.25, intensity: 0.6 }, // fill from behind
];

// Black canvas with white rectangles, prefiltered for image-based lighting.
export function createStudioEnvironment(renderer: WebGLRenderer): Texture {
  const W = 2048;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  // Not pure black: a dim studio gradient gives rough surfaces (paper) some base light.
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#4a4a4a');
  base.addColorStop(0.5, '#2a2a2a');
  base.addColorStop(1, '#141414');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  for (const p of PANELS) {
    const c = Math.round(255 * p.intensity);
    ctx.fillStyle = `rgb(${c},${c},${c})`;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 24; // soften the edges a little
    ctx.fillRect((p.u - p.w / 2) * W, (p.v - p.h / 2) * H, p.w * W, p.h * H);
  }

  const equirect = new CanvasTexture(canvas);
  equirect.mapping = EquirectangularReflectionMapping;
  equirect.colorSpace = SRGBColorSpace;

  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(equirect).texture;
  equirect.dispose();
  pmrem.dispose();
  return env;
}
