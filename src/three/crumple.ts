// Pure, deterministic helpers for crumpled paper. No three.js, so they are unit-testable.
//
// Two ways to fold a sheet. A neat slip (planNeatFolds) is folded in half two or three times,
// like a Secret Santa name slip. A crumpled sheet gets a seeded sequence of isometric folds:
// every vertex on one side of a plane is rotated about a crease line, so facets stay flat and the paper never stretches
// (only the thin strip of triangles that straddles each crease is pinched). A soft radial
// squash then pulls the folded sheet into a ball.

export type Vec3 = [number, number, number];

// Seeded RNG so every viewer sees the same jar.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 2147483647) ^ Math.imul(seed + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smooth value noise in [-1, 1].
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(fx);
  const v = s(fy);
  const w = s(fz);
  const c = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz, seed);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const n = mix(
    mix(mix(c(0, 0, 0), c(1, 0, 0), u), mix(c(0, 1, 0), c(1, 1, 0), u), v),
    mix(mix(c(0, 0, 1), c(1, 0, 1), u), mix(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
  return n * 2 - 1;
}

// One fold: the selected vertices rotate by `angle` about the line (point, axis).
export interface Fold {
  point: Vec3;
  axis: Vec3; // unit
  normal: Vec3; // unit, perpendicular to axis: the side of the crease plane that folds over
  angle: number; // radians, signed
  /** Per-vertex selection frozen at plan time. Without it, every vertex with dot(p - point, normal) > 0 rotates. */
  mask?: Uint8Array;
  /** Per-vertex distance from the crease, measured along the paper (neat folds only). */
  arc?: Float32Array;
}

const MIN_FOLDS = 8;
const MAX_FOLDS = 14;
const MIN_ANGLE = (100 * Math.PI) / 180;
const MAX_ANGLE = (170 * Math.PI) / 180;
const CANDIDATES = 6;
const MAX_TRIES = 40;
// A flap only folds if the sheet crosses the crease plane within this many flat-edge lengths of the crease line.
const HINGE_TOLERANCE = 0.3;

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

// Triangle edges of a row-major grid, matching three's PlaneGeometry (diagonal from the bottom-left to the top-right of each quad).
export function gridEdges(segX: number, segY: number): [number, number][] {
  const out: [number, number][] = [];
  for (let iy = 0; iy <= segY; iy++) {
    for (let ix = 0; ix <= segX; ix++) {
      const i = iy * (segX + 1) + ix;
      if (ix < segX) out.push([i, i + 1]);
      if (iy < segY) out.push([i, i + segX + 1]);
      if (ix < segX && iy < segY) out.push([i + 1, i + segX + 1]);
    }
  }
  return out;
}

// Rotate every selected vertex about the crease, scaled by `amount` (0 = untouched, 1 = full angle). In place.
export function applyFold(positions: Float32Array, fold: Fold, amount: number): void {
  if (amount <= 0) return;
  const { point: c, axis: a, normal: n, mask } = fold;
  const cos = Math.cos(fold.angle * amount);
  const sin = Math.sin(fold.angle * amount);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] - c[0];
    const y = positions[i + 1] - c[1];
    const z = positions[i + 2] - c[2];
    if (mask ? !mask[i / 3] : x * n[0] + y * n[1] + z * n[2] <= 0) continue;
    // Rodrigues: v cos + (a x v) sin + a (a . v)(1 - cos)
    const d = (a[0] * x + a[1] * y + a[2] * z) * (1 - cos);
    positions[i] = c[0] + x * cos + (a[1] * z - a[2] * y) * sin + a[0] * d;
    positions[i + 1] = c[1] + y * cos + (a[2] * x - a[0] * z) * sin + a[1] * d;
    positions[i + 2] = c[2] + z * cos + (a[0] * y - a[1] * x) * sin + a[2] * d;
  }
}

export interface FoldPlan {
  folds: Fold[];
  /** Centroid of the fully folded sheet: the squash centre. */
  center: Vec3;
}

export interface PlanOptions {
  /** Fold count; seeded 8-14 when omitted. */
  count?: number;
  /** Row-major grid layout of `positions` (segments, as in PlaneGeometry). Needed to fold without tearing. */
  grid?: [segX: number, segY: number];
}

// Choose the creases by folding the sheet itself, so every crease passes near the centroid of
// what is left. Deterministic for (positions, seed).
//
// A plain half-space rotation tears a stack: a layer the crease plane cuts away from the crease
// line gets its triangles dragged across the gap. With the grid known, the half-space is split
// into connected flaps and only flaps hinged on the crease line rotate; the rest stay put, so
// every edge stays intact except the ones the crease itself passes through.
export function planFolds(positions: ArrayLike<number>, seed: number, options: PlanOptions = {}): FoldPlan {
  const rand = mulberry32(seed);
  const n = Math.floor(positions.length / 3);
  const cur = Float32Array.from(positions);
  const edges = options.grid ? gridEdges(...options.grid) : [];
  let flatEdge = 0;
  for (const [a, b] of edges) {
    flatEdge = Math.max(flatEdge, Math.hypot(positions[a * 3] - positions[b * 3], positions[a * 3 + 1] - positions[b * 3 + 1], positions[a * 3 + 2] - positions[b * 3 + 2]));
  }

  const centroid = (pts: Float32Array = cur): { c: Vec3; spread: number } => {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i < pts.length; i += 3) {
      x += pts[i];
      y += pts[i + 1];
      z += pts[i + 2];
    }
    const c: Vec3 = [x / n, y / n, z / n];
    let s = 0;
    for (let i = 0; i < pts.length; i += 3) s += (pts[i] - c[0]) ** 2 + (pts[i + 1] - c[1]) ** 2 + (pts[i + 2] - c[2]) ** 2;
    return { c, spread: Math.sqrt(s / n) };
  };

  // One seeded candidate crease. With the grid known it is a line in the sheet through a random
  // vertex, cutting perpendicular to the sheet there, so the layer it starts in folds exactly
  // along the cut. Without it, a random plane near the centroid.
  const cols = options.grid ? options.grid[0] + 1 : 0;
  const rows = options.grid ? options.grid[1] + 1 : 0;
  const at = (v: number): Vec3 => [cur[v * 3], cur[v * 3 + 1], cur[v * 3 + 2]];
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const propose = (): Fold & { mask: Uint8Array; share: number } => {
    const { c, spread } = centroid();
    let normal: Vec3;
    let point: Vec3;
    let axis: Vec3;
    if (options.grid) {
      const v = Math.floor(rand() * n);
      const ix = v % cols;
      const iy = Math.floor(v / cols);
      const du = sub(at(iy * cols + Math.min(ix + 1, cols - 1)), at(iy * cols + Math.max(ix - 1, 0)));
      const dv = sub(at(Math.min(iy + 1, rows - 1) * cols + ix), at(Math.max(iy - 1, 0) * cols + ix));
      const sheetNormal = normalize(cross(du, dv));
      const tangent = normalize(du);
      const bitangent = cross(sheetNormal, tangent);
      const phi = rand() * Math.PI;
      axis = normalize([0, 1, 2].map((k) => tangent[k] * Math.cos(phi) + bitangent[k] * Math.sin(phi)) as Vec3);
      normal = normalize(cross(sheetNormal, axis));
      point = at(v);
    } else {
      const nz = rand() * 2 - 1;
      const nphi = rand() * Math.PI * 2;
      const nr = Math.sqrt(1 - nz * nz);
      normal = [nr * Math.cos(nphi), nr * Math.sin(nphi), nz];
      const off = 0.6 * spread * rand();
      const theta = rand() * Math.PI * 2;
      point = [c[0] + Math.cos(theta) * off, c[1] + Math.sin(theta) * off, c[2] + (rand() - 0.5) * off];
      axis = normalize(cross(normal, Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    }
    const angle = (MIN_ANGLE + rand() * (MAX_ANGLE - MIN_ANGLE)) * (rand() < 0.5 ? -1 : 1);

    const side = new Float32Array(n);
    for (let v = 0; v < n; v++) {
      side[v] = (cur[v * 3] - point[0]) * normal[0] + (cur[v * 3 + 1] - point[1]) * normal[1] + (cur[v * 3 + 2] - point[2]) * normal[2];
    }
    const mask = new Uint8Array(n);
    if (!edges.length) {
      for (let v = 0; v < n; v++) mask[v] = side[v] > 0 ? 1 : 0;
    } else {
      // Where the plane cuts each edge that straddles it.
      const cuts: { q: Vec3; plus: number }[] = [];
      for (const [a, b] of edges) {
        if (side[a] > 0 === side[b] > 0) continue;
        const u = side[a] / (side[a] - side[b]);
        const q: Vec3 = [cur[a * 3] + (cur[b * 3] - cur[a * 3]) * u, cur[a * 3 + 1] + (cur[b * 3 + 1] - cur[a * 3 + 1]) * u, cur[a * 3 + 2] + (cur[b * 3 + 2] - cur[a * 3 + 2]) * u];
        cuts.push({ q, plus: side[a] > 0 ? a : b });
      }
      // Connected flaps on the + side (union-find over edges with both ends there).
      const parent = new Int32Array(n);
      for (let v = 0; v < n; v++) parent[v] = v;
      const find = (v: number): number => {
        while (parent[v] !== v) v = parent[v] = parent[parent[v]];
        return v;
      };
      for (const [a, b] of edges) if (side[a] > 0 && side[b] > 0) parent[find(a)] = find(b);
      // A flap rotates only if every cut it has lies on the crease line.
      const blocked = new Set<number>();
      for (const { q, plus } of cuts) {
        const r = cross(axis, [q[0] - point[0], q[1] - point[1], q[2] - point[2]]);
        if (Math.hypot(r[0], r[1], r[2]) > HINGE_TOLERANCE * flatEdge) blocked.add(find(plus));
      }
      for (let v = 0; v < n; v++) mask[v] = side[v] > 0 && !blocked.has(find(v)) ? 1 : 0;
    }
    let count = 0;
    for (let v = 0; v < n; v++) count += mask[v];
    return { point, axis, normal, angle, mask, share: count / n };
  };

  const total = options.count ?? MIN_FOLDS + Math.floor(rand() * (MAX_FOLDS - MIN_FOLDS + 1));
  const folds: Fold[] = [];
  for (let i = 0; i < total; i++) {
    // Like real crumpling, prefer the crease that packs the sheet tightest. Creases that move
    // nothing, or the whole sheet, are useless; keep drawing until some fold is usable.
    let best: ReturnType<typeof propose> | undefined;
    let fallback = propose();
    let bestSpread = Infinity;
    for (let k = 0; k < MAX_TRIES && (k < CANDIDATES || !best); k++) {
      const cand = propose();
      fallback = cand;
      if (edges.length) {
        if (cand.share < 0.03 || cand.share > 0.9) continue;
        const folded = Float32Array.from(cur);
        applyFold(folded, cand, 1);
        const { spread } = centroid(folded);
        if (spread >= bestSpread) continue;
        bestSpread = spread;
      }
      best = cand;
    }
    best ??= fallback;
    const { share: _share, ...fold } = best;
    folds.push(fold);
    applyFold(cur, fold, 1);
  }
  return { folds, center: centroid().c };
}

// Folds open in reverse: the last fold opens first, the first fold opens last.
export function foldAmount(i: number, count: number, t: number): number {
  // Fold i is planned on top of folds 0..i-1, so it must close after them and open before them.
  return Math.min(1, Math.max(0, t * count - i));
}

export interface CrumpleOptions {
  /** Ball radius the squash converges to. */
  radius?: number;
  /** Peak seeded displacement at t = 1. */
  jitter?: number;
  /** false = folds only (pure isometry): no squash, no jitter, no recentring. */
  squash?: boolean;
  /** Fold count; seeded 8-14 when omitted. */
  count?: number;
  /** Row-major grid layout of the positions (segments), so creases can avoid tearing. */
  grid?: [segX: number, segY: number];
  /** Reuse a plan from `planFolds` instead of planning on every call (the plan depends only on the flat sheet). */
  plan?: FoldPlan;
}

// Crumple a flat sheet. t = 1 is a ball centred on the origin, t = 0 is exactly the input.
export function crumpleSheet(positions: ArrayLike<number>, seed: number, t: number, options: CrumpleOptions = {}): Float32Array {
  const { radius = 0.25, jitter = radius * 0.03, squash = true, count, grid } = options;
  const out = Float32Array.from(positions);
  if (t <= 0) return out;

  const { folds, center } = options.plan ?? planFolds(positions, seed, { count, grid });
  folds.forEach((fold, i) => applyFold(out, fold, foldAmount(i, folds.length, t)));
  if (!squash) return out;

  // Soft radial compression toward the centroid: r' = R tanh(r / R), blended in by t.
  // The centroid also slides to the origin with t, so the ball is centred on the mesh pivot.
  for (let i = 0; i < out.length; i += 3) {
    const x = out[i] - center[0];
    const y = out[i + 1] - center[1];
    const z = out[i + 2] - center[2];
    const r = Math.hypot(x, y, z);
    const k = r > 1e-9 ? 1 + t * ((radius * Math.tanh(r / radius)) / r - 1) : 1;
    // Seeded low-frequency wobble, so facets are not perfectly planar.
    const j = jitter * t;
    out[i] = center[0] * (1 - t) + x * k + j * noise3(x * 7, y * 7, z * 7, seed);
    out[i + 1] = center[1] * (1 - t) + y * k + j * noise3(x * 7, y * 7, z * 7, seed + 11);
    out[i + 2] = center[2] * (1 - t) + z * k + j * noise3(x * 7, y * 7, z * 7, seed + 23);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Neatly folded slips
// ---------------------------------------------------------------------------------------------

/** Thickness of one layer of paper; the gap a fold leaves between stacked layers. */
export const PAPER_THICKNESS = 0.004;
// A fold stops this far short of 180 degrees, so the flap springs slightly open instead of lying
// coplanar. Kept small: the lift of an earlier fold is doubled by the next one that flips it over.
const SPRING_MIN = (0.3 * Math.PI) / 180;
const SPRING_MAX = (0.8 * Math.PI) / 180;

// Fold a flat stack (lying in XY, facing +Z) by wrapping each selected vertex around a cylinder
// on the crease axis instead of rigidly rotating it. A layer at depth r below the pivot bends with
// radius r, so inner layers curl tighter than outer ones, exactly like real paper. Wrapping is
// isometric: edges at the crease never stretch, so the folded parts never pull apart. In place.
export function applyWrapFold(positions: Float32Array, fold: Fold, amount: number): void {
  if (amount <= 0) return;
  const { point: c, normal: e, mask, arc } = fold;
  const phi = Math.abs(fold.angle) * amount;
  for (let i = 0; i < positions.length; i += 3) {
    if (mask ? !mask[i / 3] : (positions[i] - c[0]) * e[0] + (positions[i + 1] - c[1]) * e[1] <= 0) continue;
    // 2D frame: d runs from the crease toward the flap, h is height relative to the pivot.
    const dx = positions[i] - c[0];
    const dy = positions[i + 1] - c[1];
    const d = dx * e[0] + dy * e[1];
    // Earlier wraps shift each layer a little, so its own crease isn't exactly under the pivot.
    // Bend from the layer's own crease (d - s) using the distance measured along the paper.
    const s = arc ? arc[i / 3] : d;
    const r = Math.max(c[2] - positions[i + 2], 1e-6);
    let pd: number;
    let ph: number;
    if (s <= r * phi) {
      // Still on the bend: arc length s around a circle of radius r.
      const b = s / r;
      pd = r * Math.sin(b);
      ph = -r * Math.cos(b);
    } else {
      // Past the bend: flat again, continuing along the tangent at the end of the arc.
      const rest = s - r * phi;
      pd = r * Math.sin(phi) + rest * Math.cos(phi);
      ph = -r * Math.cos(phi) + rest * Math.sin(phi);
    }
    positions[i] += (pd - s) * e[0];
    positions[i + 1] += (pd - s) * e[1];
    positions[i + 2] = c[2] + ph;
  }
}

export interface NeatOptions {
  /** Row-major grid layout of the sheet (segments, as in PlaneGeometry). Both must be multiples of 8 so every halving crease lands on a vertex row. */
  grid: [segX: number, segY: number];
  /** Fold count, 1-3; seeded 2-3 when omitted. */
  count?: number;
  /** Paper thickness: the offset between stacked layers. */
  thickness?: number;
}

// Plan "fold in half" creases for a width x height sheet lying in the XY plane (centred, face +Z),
// laid out like PlaneGeometry. Each fold halves the current rectangle across its longer side and
// swings one seeded half over the top of the stack, so the axes alternate.
//
// Every crease sits on a vertex row, and each fold carries a frozen per-vertex mask, so no
// triangle is ever cut: every edge keeps its length except the ones that cross a crease. The
// crease pivots just above the stack, and the flap lands one layer thickness over it, so layers
// never intersect. The plan is replayed with `neatFoldSheet`.
export function planNeatFolds(width: number, height: number, seed: number, options: NeatOptions): FoldPlan {
  const [segX, segY] = options.grid;
  if (segX % 8 || segY % 8) throw new Error('planNeatFolds: grid segments must be multiples of 8');
  const rand = mulberry32(seed);
  const drawn = 2 + Math.floor(rand() * 2);
  const count = Math.min(3, Math.max(1, options.count ?? drawn));
  const thickness = options.thickness ?? PAPER_THICKNESS;

  const cols = segX + 1;
  const n = cols * (segY + 1);
  const cur = new Float32Array(n * 3);
  // Where each vertex sits in the folded rectangle, ignoring the springy tilt: creases are
  // judged here, so layers that earlier folds flipped still split along the same row.
  const u = new Float64Array(n);
  const v = new Float64Array(n);
  for (let iy = 0; iy <= segY; iy++) {
    for (let ix = 0; ix <= segX; ix++) {
      const i = iy * cols + ix;
      u[i] = (ix / segX - 0.5) * width;
      v[i] = (0.5 - iy / segY) * height;
      cur[i * 3] = u[i];
      cur[i * 3 + 1] = v[i];
    }
  }

  const eps = 1e-6 * Math.max(width, height);
  const rect = { x0: -width / 2, x1: width / 2, y0: -height / 2, y1: height / 2 };
  const folds: Fold[] = [];
  for (let k = 0; k < count; k++) {
    const alongY = rect.y1 - rect.y0 >= rect.x1 - rect.x0; // crease across the longer side
    const dir = rand() < 0.5 ? 1 : -1;
    const mid = alongY ? (rect.y0 + rect.y1) / 2 : (rect.x0 + rect.x1) / 2;
    const coord = alongY ? v : u;
    const axis: Vec3 = alongY ? [1, 0, 0] : [0, 1, 0];
    const normal: Vec3 = alongY ? [0, dir, 0] : [dir, 0, 0];

    const mask = new Uint8Array(n);
    const arc = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      mask[i] = dir * (coord[i] - mid) > eps ? 1 : 0;
      if (mask[i]) arc[i] = dir * (coord[i] - mid);
    }

    // Pivot half a layer above the highest point, so the flap lands one layer over the stack.
    let top = -Infinity;
    for (let i = 2; i < cur.length; i += 3) top = Math.max(top, cur[i]);
    const point: Vec3 = alongY ? [0, mid, top + thickness / 2] : [mid, 0, top + thickness / 2];

    // The flap always goes over the top (+Z), whichever half it is.
    const up = cross(axis, normal)[2] > 0 ? 1 : -1;
    const angle = up * (Math.PI - (SPRING_MIN + rand() * (SPRING_MAX - SPRING_MIN)));
    const fold: Fold = { point, axis, normal, angle, mask, arc };
    folds.push(fold);
    applyWrapFold(cur, fold, 1);

    for (let i = 0; i < n; i++) if (mask[i]) coord[i] = 2 * mid - coord[i];
    if (alongY) {
      if (dir > 0) rect.y1 = mid;
      else rect.y0 = mid;
    } else if (dir > 0) rect.x1 = mid;
    else rect.x0 = mid;
  }

  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < cur.length; i += 3) {
    x += cur[i];
    y += cur[i + 1];
    z += cur[i + 2];
  }
  return { folds, center: [x / n, y / n, z / n] };
}

export interface NeatFoldOptions {
  /** Peak seeded low-frequency bend at t = 1, so a slip is never perfectly flat. */
  relax?: number;
  seed?: number;
}

// Fold a flat sheet along a `planNeatFolds` plan. t = 1 is the folded slip centred on the origin,
// t = 0 is exactly the input; the last fold opens first. Does not mutate the input.
export function neatFoldSheet(positions: ArrayLike<number>, plan: FoldPlan, t: number, options: NeatFoldOptions = {}): Float32Array {
  const { relax = 0, seed = 0 } = options;
  const out = Float32Array.from(positions);
  if (t <= 0) return out;

  const { folds, center } = plan;
  folds.forEach((fold, i) => applyWrapFold(out, fold, foldAmount(i, folds.length, t)));
  for (let i = 0; i < out.length; i += 3) {
    out[i + 2] += relax * t * noise3(out[i] * 4, out[i + 1] * 4, 0, seed);
    out[i] -= center[0] * t;
    out[i + 1] -= center[1] * t;
    out[i + 2] -= center[2] * t;
  }
  return out;
}
