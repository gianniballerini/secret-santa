import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  MeshMatcapMaterial,
  PlaneGeometry,
  Matrix4,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { neatFoldSheet, mulberry32, planNeatFolds } from './crumple';
import { JAR } from './jarGeometry';
import { createJarPhysics, initPhysics, poseAt } from './physics';

const SEED = 20241225;
const PAPER_COUNT = 22;
const SHEET_ASPECT = 1.3;
// Multiples of 8, so every halving crease lands on a vertex row.
const SHEET_SEGMENTS: [number, number] = [16, 24];
const RELAX = 0.004;
const PER_LAYER = 6; // slips per layer of the pile
const LAYER_STEP = 0.13; // height between layers
const MAX_TILT = (35 * Math.PI) / 180;
const WALL_MARGIN = 0.015;
const PILE_SHADE_HEIGHT = 0.55; // height above the jar floor where slips reach full brightness
const PILE_BOTTOM_SHADE = 0.62; // brightness at the jar floor
const SLIP_TONE_VARIATION = 0.1; // each slip is up to this much darker, so neighbours read apart
const MATCAP_SIZE = 256;

// One name slip, folded in half two or three times: planned creases, flat facets.
// Non-indexed, so each triangle keeps its own normal.
function createSheet(seed: number, width: number, count: number): BufferGeometry {
  const height = width * SHEET_ASPECT;
  const plane = new PlaneGeometry(width, height, ...SHEET_SEGMENTS);
  const pos = plane.attributes.position;
  const plan = planNeatFolds(width, height, seed, { grid: SHEET_SEGMENTS, count });
  pos.array.set(neatFoldSheet(pos.array, plan, 1, { relax: RELAX, seed }));
  const geo = plane.toNonIndexed();
  plane.dispose();
  geo.computeVertexNormals();
  return geo;
}

// Largest horizontal distance from the jar axis of the slip's vertices, if its centre sits at (x, z).
function reach(pos: ArrayLike<number>, x: number, z: number): number {
  let max = 0;
  for (let i = 0; i < pos.length; i += 3) max = Math.max(max, Math.hypot(pos[i] + x, pos[i + 2] + z));
  return max;
}

// Drop slips into the jar in loose layers, in world space.
// Each lies flat-ish (yaw anywhere, tilt up to MAX_TILT) and is pulled inward until its oriented
// extent clears the inner wall.
function scatter(rand: () => number): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  const q = new Quaternion();
  const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2); // face +Z -> up
  const tilt = new Quaternion();
  const yaw = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const axis = new Vector3();
  for (let i = 0; i < PAPER_COUNT; i++) {
    const geo = createSheet(SEED + i * 7919, 0.75 + rand() * 0.35, 2 + Math.floor(rand() * 2));
    axis.set(rand() - 0.5, 0, rand() - 0.5).normalize();
    tilt.setFromAxisAngle(axis, rand() * MAX_TILT);
    yaw.setFromAxisAngle(up, rand() * Math.PI * 2);
    q.copy(yaw).multiply(tilt).multiply(flat);
    geo.applyQuaternion(q);

    const pos = geo.attributes.position.array;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let k = 1; k < pos.length; k += 3) {
      minY = Math.min(minY, pos[k]);
      maxY = Math.max(maxY, pos[k]);
    }
    const layer = Math.floor(i / PER_LAYER);
    const y = JAR.floorY + 0.02 + layer * LAYER_STEP + rand() * 0.03 - minY;
    const limit = (y + maxY > JAR.shoulderY ? JAR.neckRadius : JAR.radius) - JAR.wall - WALL_MARGIN;

    const a = rand() * Math.PI * 2;
    let r = Math.sqrt(rand()) * limit;
    for (let k = 0; k < 24 && reach(pos, Math.cos(a) * r, Math.sin(a) * r) > limit; k++) r *= 0.9;
    if (reach(pos, Math.cos(a) * r, Math.sin(a) * r) > limit) r = 0;
    out.push(geo.translate(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  return out;
}

// Cartoon depth, stored as a `color` vertex attribute over the settled layout: slips darken toward the
// bottom of the pile, and each one gets its own tone.
function paintDepth(parts: BufferGeometry[], rand: () => number): void {
  for (const geo of parts) {
    const tone = 1 - rand() * SLIP_TONE_VARIATION;
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const height = Math.min(1, Math.max(0, (pos.getY(i) - JAR.floorY) / PILE_SHADE_HEIGHT));
      colors.fill(tone * (PILE_BOTTOM_SHADE + (1 - PILE_BOTTOM_SHADE) * height), i * 3, (i + 1) * 3);
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
  }
}

export interface PileSlip {
  /** Centred at its own origin, with the rest orientation and depth colours in place. */
  geometry: BufferGeometry;
  /** Rest position in jar space. */
  position: Vector3;
  /** 0 = bottom layer. */
  layer: number;
  /** Largest horizontal distance of any vertex from the slip's own origin. */
  extent: number;
}

export interface PaperPile {
  slips: PileSlip[];
  layers: number;
  /** Highest point of the pile within `radius` of the vertical line through (x, z). */
  topY(x: number, z: number, radius: number): number;
}

// The scatter can overlap and float; let it fall and rest in a throwaway static-jar world, then
// bake the settled poses back into the geometries.
async function settle(parts: BufferGeometry[]): Promise<void> {
  await initPhysics();
  const centres = parts.map((geo) => {
    geo.computeBoundingBox();
    const c = geo.boundingBox!.getCenter(new Vector3());
    geo.translate(-c.x, -c.y, -c.z);
    return c;
  });
  const physics = createJarPhysics(parts.map((geometry, i) => ({ geometry, position: centres[i] })));
  physics.settle();
  const snap = physics.snapshot();
  physics.dispose();
  parts.forEach((geo, i) => {
    const { position, quaternion } = poseAt(snap, i);
    geo.applyMatrix4(new Matrix4().compose(position, quaternion, new Vector3(1, 1, 1)));
    geo.computeBoundingBox();
  });
}

// Every sheet as its own centred geometry, painted once it has settled.
export async function createPaperPile(): Promise<PaperPile> {
  const rand = mulberry32(SEED);
  const parts = scatter(rand);
  await settle(parts);
  paintDepth(parts, rand);

  const points: number[] = [];
  const slips = parts.map((geo, i) => {
    const pos = geo.attributes.position.array;
    for (let k = 0; k < pos.length; k += 3) points.push(pos[k], pos[k + 1], pos[k + 2]);
    geo.computeBoundingBox();
    const position = geo.boundingBox!.getCenter(new Vector3());
    geo.translate(-position.x, -position.y, -position.z);
    let extent = 0;
    const c = geo.attributes.position.array;
    for (let k = 0; k < c.length; k += 3) extent = Math.max(extent, Math.hypot(c[k], c[k + 2]));
    return { geometry: geo, position, layer: Math.floor(i / PER_LAYER), extent };
  });

  const topY = (x: number, z: number, radius: number): number => {
    let max = JAR.floorY;
    for (let k = 0; k < points.length; k += 3) {
      if (Math.hypot(points[k] - x, points[k + 2] - z) <= radius) max = Math.max(max, points[k + 1]);
    }
    return max;
  };
  return { slips, layers: Math.ceil(PAPER_COUNT / PER_LAYER), topY };
}

// Toon lighting painted into a texture: hard cream bands, lit from the upper left.
function createToonMatcap(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = MATCAP_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#b9a58c';
  ctx.fillRect(0, 0, MATCAP_SIZE, MATCAP_SIZE);
  const bands: [string, number, number, number][] = [
    ['#e6d6bb', 0.44, 0.41, 0.5],
    ['#fff8ea', 0.375, 0.33, 0.336],
  ];
  for (const [color, x, y, radius] of bands) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x * MATCAP_SIZE, y * MATCAP_SIZE, radius * MATCAP_SIZE, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function createPaperMaterial(): MeshMatcapMaterial {
  const matcap = createToonMatcap();
  const material = new MeshMatcapMaterial({ matcap, vertexColors: true, side: DoubleSide });
  material.addEventListener('dispose', () => matcap.dispose());
  return material;
}
