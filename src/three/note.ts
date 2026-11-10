import { CanvasTexture, DoubleSide, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { neatFoldSheet, planNeatFolds } from './crumple';

export const NOTE_WIDTH = 1;
export const NOTE_HEIGHT = 1.3;
// Multiples of 8, so every halving crease lands on a vertex row.
const SEGMENTS: [number, number] = [48, 64];
const FOLD_SEED = 77;
const FOLD_COUNT = 3;
const RELAX = 0.004;
const TEX_W = 512;
const TEX_H = Math.round((TEX_W * NOTE_HEIGHT) / NOTE_WIDTH);
const FONT = '"Lobster", cursive';
const LEAD_TEXT = 'Tu amigo invisible es:';
const LEAD_SIZE = 44;
const LEAD_GAP = 16; // texture px between the lead line and the name
const LINE_SPACING = 1.15;
const BODY_FONT = '"Nunito", system-ui, sans-serif';
const BODY_SIZE = 30;
const TITLE_SIZE = 78;

export interface Note {
  mesh: Mesh<PlaneGeometry, MeshStandardMaterial>;
  setName(name: string): void;
  /** A paper with a Lobster title and wrapped body lines (the credits). Same paper look as the name. */
  setLines(title: string, lines: string[]): void;
  /** 1 = folded slip, 0 = flat. Animating this is the unfold. */
  setCrumple(amount: number): void;
  dispose(): void;
}

export function createNote(): Note {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
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
    // Lead line and name are centred on the sheet as one block.
    const lineHeight = size * LINE_SPACING;
    const leadHeight = LEAD_SIZE * LINE_SPACING;
    const top = (TEX_H - leadHeight - LEAD_GAP - lines.length * lineHeight) / 2;
    const nameTop = top + leadHeight + LEAD_GAP;
    lines.forEach((l, i) => ctx.fillText(l, TEX_W / 2, nameTop + (i + 0.5) * lineHeight));
    ctx.font = `${LEAD_SIZE}px ${FONT}`;
    ctx.fillText(LEAD_TEXT, TEX_W / 2, top + leadHeight / 2, maxWidth);
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
    setName(name) {
      current = name;
      draw();
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
