import {
  BackSide,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MirroredRepeatWrapping,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import artUrl from '../assets/images/intro-facets.svg?url';
import { FACET_SIDES, JAR } from './jarGeometry';
import { clamp01, easeOut, easePop, lerp, linear, tween } from './tween';

// The info sticker on the back of the jar. It is one flat facet of the 12-sided jar, so it needs no fold:
// the art is the 390x844 `intro-facets.svg`, and every text block is its own quad so blocks can animate apart.
// Layout is written in "design px" (the 390x844 art), then mapped to scene units.

const DESIGN_W = 390;
const DESIGN_H = 844;
const LABEL_WIDTH = 0.4; // scene units; the facet is 0.4245 wide
const K = LABEL_WIDTH / DESIGN_W; // scene units per design px
const GLASS_OFFSET = 0.004; // keeps the sticker off the glass surface
const FACET_ANGLE = Math.PI - Math.PI / FACET_SIDES; // the facet centred at 165 degrees
const APOTHEM = JAR.radius * Math.cos(Math.PI / FACET_SIDES);

/** Geometry the scene needs to frame the label. All in jar space, scene units. */
export const BACK_LABEL = {
  width: LABEL_WIDTH,
  height: DESIGN_H * K,
  centerY: 0.68,
  /** Rotation of the label (and of the jar, to bring it to the camera) about Y. */
  facetAngle: FACET_ANGLE,
  /** Distance from the jar axis to the flat facet. */
  apothem: APOTHEM,
  /** Distance from the jar axis to the sticker surface. */
  surface: APOTHEM + GLASS_OFFSET,
};

const ART_PX: [number, number] = [780, 1688];
// How many label widths and heights the art extends to while the camera is parked on the sticker. It lies on the
// tangent plane of the facet, so it clears the jar, and covers screens whose shape differs from the sticker's.
const BLEED_TILES_X = 7;
const BLEED_TILES_Y = 1.5;
const BLEED_Z = -0.001; // behind the opaque art, still in front of the glass
const TEXT_PX_PER_UNIT = 2600; // text texture density, so blocks stay sharp up close
const TEX_SCALE = TEXT_PX_PER_UNIT * K; // canvas px per design px
// Text sits on the navy art. The scene is tone-mapped, which greys pure white a little; this brings it back.
const INK_BOOST = 1.3;
const RISE = 8 * K; // how far a block rises while it fades in

const CREAM = '#fff6e0';
const KICKER_INK = '#bcd7f2';
const WARNING_INK = '#8f1414';
const NAVY = '#10214a';
const BACKING = '#fff3de'; // plain sticker backing seen through the glass

const LOBSTER = (px: number) => `${px}px "Lobster", cursive`;
const SLAB = (px: number) => `${px}px "Alfa Slab One", Georgia, serif`;
const NUNITO = (px: number, weight = 700, italic = false) =>
  `${italic ? 'italic ' : ''}${weight} ${px}px "Nunito", system-ui, sans-serif`;
const GLYPH_SAMPLE = 'ÁÉÍÓÚÑáéíóúñ¿¡·0123 abc';

// Layout, in design px. The bottom ~13% (below y = 734) stays clear for the DOM button.
const MARGIN_X = 28;
const INNER_W = DESIGN_W - 2 * MARGIN_X;
const KICKER_Y = 74;
const HELLO_Y = 108;
const NAME_Y = 174;
const GREETING_Y = 276;
const TABLE_Y = 368;
const ROW_H = 44;
const WARNING_Y = 532;
const WARNING_MAX_H = 136;
const FOOTER_Y = 688;
const FOOTER_H = 46;

export interface BackLabelContent {
  kicker: string;
  hello: string;
  /** The giver. Shown in capitals; also seeds the barcode. */
  name: string;
  greeting: string;
  rows: Array<{ label: string; value: string }>;
  warningTitle: string;
  warning: string;
  footer: string;
}

export interface BackLabel {
  /** Place at the facet. Add to the jar group. */
  group: Group;
  /** Staggered entry. Resolves true when done, false when aborted. `onFrame` fires after each update. */
  playEntry(signal: AbortSignal, onFrame: () => void): Promise<boolean>;
  /** Everything visible at once (reduced motion). */
  showAll(): void;
  /** Fades the art that extends past the sticker (1 = covers the screen, 0 = only the real sticker remains). */
  setBleed(opacity: number): void;
  dispose(): void;
}

type Motion = 'rise' | 'stamp' | 'fade';

interface BlockSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  motion: Motion;
  delay: number;
  duration: number;
  draw(ctx: CanvasRenderingContext2D): void;
}

interface Block {
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  texture: CanvasTexture;
  baseY: number;
  motion: Motion;
  delay: number;
  duration: number;
}

const RISE_MS = 420;
const STAMP_MS = 520;
const STAMP_FROM = 1.35;

// Text helpers -----------------------------------------------------------------------------------

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Largest size in [min, start] at which `text` fits `maxWidth`. */
function fitSize(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, maxWidth: number, start: number, min: number): number {
  let size = start;
  ctx.font = font(size);
  while (size > min && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = font(size);
  }
  return size;
}

/** Letter-spaced, centred text (canvas letterSpacing is not available everywhere). */
function trackedText(ctx: CanvasRenderingContext2D, text: string, centerX: number, y: number, tracking: number): void {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * (chars.length - 1);
  let x = centerX - total / 2;
  ctx.textAlign = 'left';
  chars.forEach((c, i) => {
    ctx.fillText(c, x, y);
    x += widths[i] + tracking;
  });
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Splits a name over two lines where the longer line is shortest. */
function balancedSplit(ctx: CanvasRenderingContext2D, name: string): [string, string] | null {
  const words = name.split(/\s+/);
  if (words.length < 2) return null;
  let best: [string, string] | null = null;
  let bestWidth = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const width = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (width < bestWidth) {
      bestWidth = width;
      best = [a, b];
    }
  }
  return best;
}

// Block painters ---------------------------------------------------------------------------------

function drawKicker(text: string): BlockSpec['draw'] {
  return (ctx) => {
    ctx.fillStyle = KICKER_INK;
    ctx.textBaseline = 'middle';
    ctx.font = NUNITO(14, 800);
    trackedText(ctx, text, INNER_W / 2, 13, 2.6);
  };
}

function drawHello(text: string, h: number): BlockSpec['draw'] {
  return (ctx) => {
    ctx.fillStyle = CREAM;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = LOBSTER(54);
    ctx.fillText(text, INNER_W / 2, h / 2 + 2, INNER_W);
  };
}

function drawName(name: string, h: number, scratch: CanvasRenderingContext2D): BlockSpec['draw'] {
  const upper = name.toLocaleUpperCase('es');
  // One line at a good size; a long name with spaces breaks over two lines before it gets tiny.
  let size = fitSize(scratch, upper, SLAB, INNER_W, 64, 18);
  let lines = [upper];
  if (size < 38) {
    scratch.font = SLAB(40);
    const split = balancedSplit(scratch, upper);
    if (split) {
      const sizeTwo = Math.min(
        fitSize(scratch, split[0], SLAB, INNER_W, 40, 14),
        fitSize(scratch, split[1], SLAB, INNER_W, 40, 14),
      );
      if (sizeTwo > size) {
        size = sizeTwo;
        lines = split;
      }
    }
  }
  return (ctx) => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = SLAB(size);
    const lineHeight = size * 1.08;
    const top = h / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => {
      const y = top + i * lineHeight;
      // A hard offset shadow gives the stamped, printed look.
      ctx.fillStyle = 'rgba(8, 16, 40, 0.55)';
      ctx.fillText(line, INNER_W / 2 + 1.5, y + 2.5, INNER_W);
      ctx.fillStyle = CREAM;
      ctx.fillText(line, INNER_W / 2, y, INNER_W);
    });
  };
}

function drawGreeting(text: string): BlockSpec['draw'] {
  return (ctx) => {
    ctx.fillStyle = CREAM;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = NUNITO(21, 600, true);
    const lines = wrapLines(ctx, text, INNER_W - 30);
    const lineHeight = 28;
    const top = 30 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => ctx.fillText(line, INNER_W / 2, top + i * lineHeight));
  };
}

function drawRow(row: { label: string; value: string }, index: number, count: number): BlockSpec['draw'] {
  return (ctx) => {
    ctx.fillStyle = CREAM;
    ctx.textBaseline = 'middle';
    // Heavy rules at the top and bottom of the table, hairlines between rows.
    if (index === 0) ctx.fillRect(0, 0, INNER_W, 3);
    ctx.fillRect(0, ROW_H - (index === count - 1 ? 3 : 1), INNER_W, index === count - 1 ? 3 : 1);
    const labelSize = 16;
    ctx.font = NUNITO(labelSize, 800);
    const labelWidth = ctx.measureText(row.label).width;
    const room = INNER_W - 8 - labelWidth - 14;
    ctx.font = NUNITO(16, 600);
    let valueSize = 16;
    while (valueSize > 11 && ctx.measureText(row.value).width > room) {
      valueSize -= 1;
      ctx.font = NUNITO(valueSize, 600);
    }
    ctx.textAlign = 'right';
    ctx.fillText(row.value, INNER_W - 4, ROW_H / 2 + 1);
    ctx.font = NUNITO(labelSize, 800);
    ctx.textAlign = 'left';
    ctx.fillText(row.label, 4, ROW_H / 2 + 1);
  };
}

interface WarningLayout {
  h: number;
  size: number;
  lines: string[];
}

const WARNING_PAD = 16;
const WARNING_TITLE_H = 30;

function layoutWarning(text: string, scratch: CanvasRenderingContext2D): WarningLayout {
  let size = 16;
  let lines: string[] = [];
  let h = 0;
  for (; size >= 11; size -= 1) {
    scratch.font = NUNITO(size, 700);
    lines = wrapLines(scratch, text, INNER_W - 2 * 20);
    h = WARNING_PAD * 2 + WARNING_TITLE_H + lines.length * size * 1.32;
    if (h <= WARNING_MAX_H) break;
  }
  return { h: Math.ceil(h), size: Math.max(size, 11), lines };
}

function drawWarning(title: string, layout: WarningLayout): BlockSpec['draw'] {
  return (ctx) => {
    const { h, size, lines } = layout;
    // A cream panel with deep-red ink, like the slip.
    ctx.fillStyle = CREAM;
    ctx.beginPath();
    ctx.roundRect(0, 0, INNER_W, h, 12);
    ctx.fill();
    ctx.strokeStyle = WARNING_INK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(5, 5, INNER_W - 10, h - 10, 8);
    ctx.stroke();
    ctx.fillStyle = WARNING_INK;
    ctx.textBaseline = 'middle';
    ctx.font = NUNITO(15, 800);
    trackedText(ctx, title, INNER_W / 2, WARNING_PAD + 8, 3);
    ctx.textAlign = 'center';
    ctx.font = NUNITO(size, 700);
    const lineHeight = size * 1.32;
    lines.forEach((line, i) => ctx.fillText(line, INNER_W / 2, WARNING_PAD + WARNING_TITLE_H + i * lineHeight + lineHeight / 2));
  };
}

function drawFooter(text: string, seed: string): BlockSpec['draw'] {
  return (ctx) => {
    // A barcode drawn from the name: the same giver always gets the same one.
    const random = seededRandom(hashString(seed));
    const barcodeW = 150;
    const barcodeH = 22;
    const left = (INNER_W - barcodeW) / 2;
    ctx.fillStyle = CREAM;
    let x = 0;
    let bar = true;
    while (x < barcodeW) {
      const width = bar ? 1 + Math.floor(random() * 3) : 1 + Math.floor(random() * 2);
      if (bar) ctx.fillRect(left + x, 0, Math.min(width, barcodeW - x), barcodeH);
      x += width;
      bar = !bar;
    }
    ctx.textBaseline = 'middle';
    ctx.font = NUNITO(13, 700);
    ctx.globalAlpha = 0.9;
    trackedText(ctx, text, INNER_W / 2, barcodeH + 14, 1);
    ctx.globalAlpha = 1;
  };
}

// Assembly ---------------------------------------------------------------------------------------

function blockSpecs(content: BackLabelContent, scratch: CanvasRenderingContext2D): BlockSpec[] {
  const specs: BlockSpec[] = [];
  const add = (spec: Omit<BlockSpec, 'x' | 'w'>) => specs.push({ x: MARGIN_X, w: INNER_W, ...spec });
  add({ y: KICKER_Y, h: 26, motion: 'rise', delay: 0, duration: RISE_MS, draw: drawKicker(content.kicker) });
  add({ y: HELLO_Y, h: 66, motion: 'rise', delay: 150, duration: RISE_MS, draw: drawHello(content.hello, 66) });
  add({ y: NAME_Y, h: 96, motion: 'stamp', delay: 350, duration: STAMP_MS, draw: drawName(content.name, 96, scratch) });
  add({ y: GREETING_Y, h: 60, motion: 'rise', delay: 700, duration: RISE_MS, draw: drawGreeting(content.greeting) });
  content.rows.forEach((row, i) =>
    add({ y: TABLE_Y + i * ROW_H, h: ROW_H, motion: 'rise', delay: 900 + i * 100, duration: RISE_MS, draw: drawRow(row, i, content.rows.length) }),
  );
  const warning = layoutWarning(content.warning, scratch);
  add({ y: WARNING_Y, h: warning.h, motion: 'stamp', delay: 1300, duration: STAMP_MS, draw: drawWarning(content.warningTitle, warning) });
  add({ y: FOOTER_Y, h: FOOTER_H, motion: 'fade', delay: 1550, duration: RISE_MS, draw: drawFooter(content.footer, content.name) });
  return specs;
}

async function loadFonts(): Promise<void> {
  await Promise.all([
    document.fonts.load(LOBSTER(64), GLYPH_SAMPLE),
    document.fonts.load(SLAB(64), GLYPH_SAMPLE),
    document.fonts.load(NUNITO(16, 800), GLYPH_SAMPLE),
    document.fonts.load(NUNITO(16, 600), GLYPH_SAMPLE),
    document.fonts.load(NUNITO(16, 700), GLYPH_SAMPLE),
    document.fonts.load(NUNITO(21, 600, true), GLYPH_SAMPLE),
  ]);
}

/** The facet art, rasterised. Plain navy if the image cannot be drawn. */
async function loadArt(): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = ART_PX;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = artUrl;
    await img.decode();
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  } catch {
    /* the navy fill stays */
  }
  return canvas;
}

function paintBlock(spec: BlockSpec, anisotropy: number): { texture: CanvasTexture; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(spec.w * TEX_SCALE);
  canvas.height = Math.ceil(spec.h * TEX_SCALE);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(canvas.width / spec.w, canvas.height / spec.h);
  spec.draw(ctx);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return { texture, canvas };
}

/**
 * Builds the sticker: art, a plain backing seen from inside the jar, and the animated text blocks.
 * Waits for the fonts first, so no block is ever drawn in a fallback face.
 */
export async function createBackLabel(content: BackLabelContent, options: { anisotropy: number }): Promise<BackLabel> {
  const [, art] = await Promise.all([loadFonts(), loadArt()]);

  const group = new Group();
  group.rotation.y = FACET_ANGLE;
  // The facet centre at the apothem (plus the glass offset), along the facet's own direction.
  group.position.set(Math.sin(FACET_ANGLE) * BACK_LABEL.surface, BACK_LABEL.centerY, Math.cos(FACET_ANGLE) * BACK_LABEL.surface);

  const geometry = new PlaneGeometry(BACK_LABEL.width, BACK_LABEL.height);
  const artTexture = new CanvasTexture(art);
  artTexture.colorSpace = SRGBColorSpace;
  artTexture.anisotropy = options.anisotropy;
  // Mirrored, so the art continues past the sticker without a seam.
  artTexture.wrapS = artTexture.wrapT = MirroredRepeatWrapping;
  const artMaterial = new MeshBasicMaterial({ map: artTexture });
  const backing = new MeshStandardMaterial({ color: new Color(BACKING), roughness: 1, metalness: 0, side: BackSide });
  group.add(new Mesh(geometry, artMaterial), new Mesh(geometry, backing));

  const bleedGeometry = new PlaneGeometry(BACK_LABEL.width * BLEED_TILES_X, BACK_LABEL.height * BLEED_TILES_Y);
  const bleedUv = bleedGeometry.attributes.uv;
  for (let i = 0; i < bleedUv.count; i++) {
    bleedUv.setXY(
      i,
      bleedUv.getX(i) * BLEED_TILES_X - (BLEED_TILES_X - 1) / 2,
      bleedUv.getY(i) * BLEED_TILES_Y - (BLEED_TILES_Y - 1) / 2,
    );
  }
  const bleedMaterial = new MeshBasicMaterial({ map: artTexture, transparent: true, depthWrite: false });
  const bleed = new Mesh(bleedGeometry, bleedMaterial);
  bleed.position.z = BLEED_Z;
  group.add(bleed);

  const scratch = document.createElement('canvas').getContext('2d')!;
  const blocks: Block[] = blockSpecs(content, scratch).map((spec, i) => {
    const { texture } = paintBlock(spec, options.anisotropy);
    const blockGeometry = new PlaneGeometry(spec.w * K, spec.h * K);
    const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0 });
    material.color.setScalar(INK_BOOST);
    const mesh = new Mesh(blockGeometry, material);
    const baseY = (DESIGN_H / 2 - (spec.y + spec.h / 2)) * K;
    // Blocks never overlap, so a tiny lift off the art is all the z-fighting protection they need.
    mesh.position.set((spec.x + spec.w / 2 - DESIGN_W / 2) * K, baseY, 0.001 + i * 0.0002);
    mesh.renderOrder = i + 1;
    group.add(mesh);
    return { mesh, texture, baseY, motion: spec.motion, delay: spec.delay, duration: spec.duration };
  });

  const apply = (block: Block, t: number) => {
    const { mesh, motion, baseY } = block;
    const l = clamp01(t);
    if (motion === 'rise') {
      const e = easeOut(l);
      mesh.material.opacity = e;
      mesh.position.y = baseY - (1 - e) * RISE;
      mesh.scale.setScalar(1);
    } else if (motion === 'stamp') {
      mesh.material.opacity = easeOut(clamp01(l * 1.8));
      mesh.position.y = baseY;
      mesh.scale.setScalar(lerp(STAMP_FROM, 1, easePop(l)));
    } else {
      mesh.material.opacity = easeOut(l);
      mesh.position.y = baseY;
      mesh.scale.setScalar(1);
    }
  };
  const total = Math.max(...blocks.map((b) => b.delay + b.duration));

  return {
    group,
    playEntry(signal, onFrame) {
      return tween(total, linear, (p) => {
        const now = p * total;
        for (const block of blocks) apply(block, (now - block.delay) / block.duration);
        onFrame();
      }, signal);
    },
    showAll() {
      for (const block of blocks) apply(block, 1);
    },
    setBleed(opacity) {
      bleedMaterial.opacity = opacity;
      bleed.visible = opacity > 0;
    },
    dispose() {
      group.removeFromParent();
      geometry.dispose();
      bleedGeometry.dispose();
      bleedMaterial.dispose();
      artMaterial.dispose();
      artTexture.dispose();
      backing.dispose();
      for (const block of blocks) {
        block.mesh.geometry.dispose();
        block.mesh.material.dispose();
        block.texture.dispose();
      }
    },
  };
}
