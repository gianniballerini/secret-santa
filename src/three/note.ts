import { CanvasTexture, DoubleSide, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { neatFoldSheet, planNeatFolds } from './crumple';

export const NOTE_WIDTH = 1;
export const NOTE_HEIGHT = 1.3;
// Multiples of 8, so every halving crease lands on a vertex row.
const SEGMENTS: [number, number] = [48, 64];
const FOLD_SEED = 77;
const FOLD_COUNT = 3;
const RELAX = 0.004;
// Layout is in texture px on a 512-wide sheet; the canvas is RES times that, so the open note stays sharp on 2x screens.
const TEX_W = 512;
const TEX_H = Math.round((TEX_W * NOTE_HEIGHT) / NOTE_WIDTH);
const RES = 2;
const FONT = '"Lobster", cursive';
const LEAD_TEXT = 'Tu amigo invisible es:';
const LEAD_SIZE = 44;
const LEAD_GAP = 16; // texture px between the lead line and the name
const LINE_SPACING = 1.15;
const BODY_FONT = '"Nunito", system-ui, sans-serif';
const BODY_SIZE = 30;
const TITLE_SIZE = 78;
// The recipient's picture: a white comic panel with a black ink outline and an offset shadow (texture px).
const PHOTO_SIZE = 196;
const PHOTO_MAT = 12; // white margin around the picture
const PHOTO_CARD = PHOTO_SIZE + PHOTO_MAT * 2;
const PHOTO_BOTTOM = 60;
const PHOTO_RADIUS = 18;
const PHOTO_OUTLINE = 6;
const PHOTO_INNER_LINE = 3;
const PHOTO_SHADOW = 8; // offset of the solid black shadow, down and right
const PHOTO_GAP = 28; // between the name block and the picture
const INK = '#111111';
/** Silhouette shown when the recipient has no picture or theirs fails to load (relative to the page). */
const FALLBACK_PHOTO = 'unknown-avatar.jpg';

export interface Note {
  mesh: Mesh<PlaneGeometry, MeshStandardMaterial>;
  /** `imageUrl` is loaded in the background and drawn at the bottom; with none, or if it fails, a mystery silhouette is drawn. */
  setName(name: string, imageUrl?: string): void;
  /** A paper with a Lobster title and wrapped body lines (the credits). Same paper look as the name. */
  setLines(title: string, lines: string[]): void;
  /** 1 = folded slip, 0 = flat. Animating this is the unfold. */
  setCrumple(amount: number): void;
  dispose(): void;
}

export function createNote(): Note {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W * RES;
  canvas.height = TEX_H * RES;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;

  const material = new MeshStandardMaterial({
    map: texture,
    roughness: 1,
    metalness: 0,
    side: DoubleSide,
  });
  // The name is written on the front only. Back faces would otherwise sample the same texture and
  // show the name mirrored through the paper; give them the plain paper colour (#fffaf0, linear).
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `if ( gl_FrontFacing ) {
	#include <map_fragment>
} else {
	diffuseColor.rgb *= vec3( 1.0, 0.955, 0.871 );
}`,
    );
  };

  // Non-indexed so every triangle is flat-shaded. `source` maps each corner back to its grid
  // vertex: the sheet is folded once per grid vertex, then copied out to the corners.
  const plane = new PlaneGeometry(NOTE_WIDTH, NOTE_HEIGHT, ...SEGMENTS);
  const flat = Float32Array.from(plane.attributes.position.array);
  const source = Array.from(plane.index!.array);
  const geometry = plane.toNonIndexed() as unknown as PlaneGeometry;
  plane.dispose();
  const mesh = new Mesh(geometry, material);
  // The creases depend only on the flat sheet, so plan them once and replay them as t changes.
  const plan = planNeatFolds(NOTE_WIDTH, NOTE_HEIGHT, FOLD_SEED, { grid: SEGMENTS, count: FOLD_COUNT });
  const corners = geometry.attributes.position;

  const setCrumple = (amount: number) => {
    const t = Math.min(1, Math.max(0, amount));
    const folded = neatFoldSheet(flat, plan, t, { relax: RELAX, seed: FOLD_SEED });
    for (let i = 0; i < source.length; i++) corners.setXYZ(i, folded[source[i] * 3], folded[source[i] * 3 + 1], folded[source[i] * 3 + 2]);
    corners.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  };
  setCrumple(1);

  const paintPaper = (ctx: CanvasRenderingContext2D) => {
    ctx.setTransform(RES, 0, 0, RES, 0, 0);
    ctx.fillStyle = '#fffaf0';
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    // Faint ruled lines so it reads as paper.
    ctx.strokeStyle = 'rgba(120, 140, 160, 0.18)';
    ctx.lineWidth = 2;
    for (let y = 90; y < TEX_H; y += 44) {
      ctx.beginPath();
      ctx.moveTo(24, y);
      ctx.lineTo(TEX_W - 24, y);
      ctx.stroke();
    }
  };

  let current = '';
  let photo: HTMLImageElement | null = null;
  let photoUrl = '';

  // A white panel with a thick ink outline and a hard offset shadow, the picture cover-fit inside it.
  const drawPhoto = (ctx: CanvasRenderingContext2D, img: HTMLImageElement) => {
    const cx = (TEX_W - PHOTO_CARD) / 2;
    const cy = TEX_H - PHOTO_BOTTOM - PHOTO_CARD;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(cx + PHOTO_SHADOW, cy + PHOTO_SHADOW, PHOTO_CARD, PHOTO_CARD, PHOTO_RADIUS);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(cx, cy, PHOTO_CARD, PHOTO_CARD, PHOTO_RADIUS);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = PHOTO_OUTLINE;
    ctx.lineJoin = 'round';
    ctx.stroke();

    const x = cx + PHOTO_MAT;
    const y = cy + PHOTO_MAT;
    const radius = PHOTO_RADIUS - PHOTO_MAT / 2;
    const scale = Math.max(PHOTO_SIZE / img.naturalWidth, PHOTO_SIZE / img.naturalHeight);
    const sw = PHOTO_SIZE / scale;
    const sh = PHOTO_SIZE / scale;
    const sx = (img.naturalWidth - sw) / 2;
    const sy = Math.max(0, (img.naturalHeight - sh) / 2 - (img.naturalHeight - sh) * 0.3); // favour the face
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, PHOTO_SIZE, PHOTO_SIZE, radius);
    ctx.clip();
    ctx.drawImage(img, sx, sy, sw, sh, x, y, PHOTO_SIZE, PHOTO_SIZE);
    ctx.restore();
    ctx.strokeStyle = INK;
    ctx.lineWidth = PHOTO_INNER_LINE;
    ctx.beginPath();
    ctx.roundRect(x, y, PHOTO_SIZE, PHOTO_SIZE, radius);
    ctx.stroke();
  };

  const loadPhoto = (name: string, url: string, src = url || FALLBACK_PHOTO) => {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    // decode() keeps the decode off the main thread; a 404 or bad file rejects, so try the silhouette once.
    img
      .decode()
      .then(() => {
        if (current !== name || photoUrl !== url) return;
        photo = img;
        draw();
      })
      .catch(() => {
        if (src !== FALLBACK_PHOTO && current === name && photoUrl === url) loadPhoto(name, url, FALLBACK_PHOTO);
      });
  };

  const draw = () => {
    const ctx = canvas.getContext('2d')!;
    paintPaper(ctx);
    ctx.fillStyle = '#a81c1c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const maxWidth = TEX_W - 80;
    // Shrink to fit on one line; below 52px wrap by words instead.
    let size = 110;
    const fits = (text: string) => ctx.measureText(text).width <= maxWidth;
    ctx.font = `${size}px ${FONT}`;
    while (size > 52 && !fits(current)) {
      size -= 4;
      ctx.font = `${size}px ${FONT}`;
    }
    const lines: string[] = [];
    if (fits(current)) {
      lines.push(current);
    } else {
      let line = '';
      for (const word of current.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (line && !fits(next)) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      if (line) lines.push(line);
    }
    // Lead line and name are centred as one block: on the sheet, or above the picture when there is one.
    const lineHeight = size * LINE_SPACING;
    const leadHeight = LEAD_SIZE * LINE_SPACING;
    const textArea = photo ? TEX_H - PHOTO_BOTTOM - PHOTO_CARD - PHOTO_GAP : TEX_H;
    const top = (textArea - leadHeight - LEAD_GAP - lines.length * lineHeight) / 2 + (photo ? PHOTO_GAP : 0);
    const nameTop = top + leadHeight + LEAD_GAP;
    lines.forEach((l, i) => ctx.fillText(l, TEX_W / 2, nameTop + (i + 0.5) * lineHeight));
    ctx.font = `${LEAD_SIZE}px ${FONT}`;
    ctx.fillText(LEAD_TEXT, TEX_W / 2, top + leadHeight / 2, maxWidth);
    if (photo) drawPhoto(ctx, photo);
    texture.needsUpdate = true;
  };

  const wrap = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
    const out: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
    return out;
  };

  const drawLines = (title: string, body: string[]) => {
    const ctx = canvas.getContext('2d')!;
    paintPaper(ctx);
    ctx.fillStyle = '#a81c1c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const maxWidth = TEX_W - 80;
    ctx.font = `700 ${BODY_SIZE}px ${BODY_FONT}`;
    const wrapped = body.map((text) => wrap(ctx, text, maxWidth));
    const bodyHeight = wrapped.reduce((sum, lines) => sum + lines.length * BODY_SIZE * LINE_SPACING, 0) + (wrapped.length - 1) * LEAD_GAP;
    const titleHeight = TITLE_SIZE * LINE_SPACING;
    let y = (TEX_H - titleHeight - LEAD_GAP * 2 - bodyHeight) / 2;
    ctx.font = `${TITLE_SIZE}px ${FONT}`;
    ctx.fillText(title, TEX_W / 2, y + titleHeight / 2, maxWidth);
    y += titleHeight + LEAD_GAP * 2;
    ctx.fillStyle = '#1d2a4a';
    ctx.font = `700 ${BODY_SIZE}px ${BODY_FONT}`;
    for (const lines of wrapped) {
      for (const l of lines) {
        ctx.fillText(l, TEX_W / 2, y + (BODY_SIZE * LINE_SPACING) / 2);
        y += BODY_SIZE * LINE_SPACING;
      }
      y += LEAD_GAP;
    }
    texture.needsUpdate = true;
  };

  return {
    mesh,
    setLines(title, body) {
      drawLines(title, body);
      // Both faces may still be loading; redraw once they are ready.
      void Promise.all([document.fonts?.load(`${TITLE_SIZE}px ${FONT}`), document.fonts?.load(`700 ${BODY_SIZE}px ${BODY_FONT}`)]).then(() => drawLines(title, body));
    },
    setName(name, imageUrl = '') {
      if (imageUrl !== photoUrl || name !== current) photo = null;
      current = name;
      photoUrl = imageUrl;
      draw();
      if (!photo) loadPhoto(name, imageUrl);
      // The display font may still be loading; redraw once it is ready.
      void document.fonts?.load(`64px ${FONT}`).then(() => current === name && draw());
    },
    setCrumple,
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
