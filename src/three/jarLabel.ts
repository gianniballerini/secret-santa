import { BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, Mesh, MeshStandardMaterial, SRGBColorSpace } from 'three';
import { FACET_SIDES, JAR } from './jarGeometry';

// Scene units. The width stays inside the two front facets, so the sticker folds once, on the ridge facing the camera.
const LABEL_WIDTH = 0.8;
const LABEL_HEIGHT = 0.52;
const LABEL_CENTER_Y = 0.94; // above the paper pile, below the shoulder
const GLASS_OFFSET = 0.004; // keeps the sticker off the glass surface
const TEX_W = 1024;
const TEX_H = Math.round((TEX_W * LABEL_HEIGHT) / LABEL_WIDTH);
const FONT = '"Lobster", cursive';
const PAPER = '#fffaf0';
const INK = '#a81c1c';
const LINES: Array<{ text: string; size: number; y: number }> = [
  { text: 'Navidad', size: 250, y: 0.4 },
  { text: '2026', size: 190, y: 0.73 },
];

export interface JarLabel {
  mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  dispose(): void;
}

// Two quads, one per front facet. The lathe puts a ridge at angle 0, which is the +Z side facing the camera.
function createLabelGeometry(): BufferGeometry {
  const radius = JAR.radius + GLASS_OFFSET;
  const angle = (Math.PI * 2) / FACET_SIDES;
  const facetWidth = 2 * radius * Math.sin(angle / 2);
  const t = LABEL_WIDTH / 2 / facetWidth;
  const x = radius * Math.sin(angle) * t;
  const z = radius + (radius * Math.cos(angle) - radius) * t;
  const bottom = LABEL_CENTER_Y - LABEL_HEIGHT / 2;
  const top = LABEL_CENTER_Y + LABEL_HEIGHT / 2;

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-x, bottom, z, 0, bottom, radius, x, bottom, z, -x, top, z, 0, top, radius, x, top, z]), 3),
  );
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 0.5, 0, 1, 0, 0, 1, 0.5, 1, 1, 1]), 2));
  geometry.setIndex([0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]);
  geometry.computeVertexNormals();
  return geometry;
}

export function createJarLabel(): JarLabel {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;

  const draw = () => {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, TEX_W, TEX_H);
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.roundRect(0, 0, TEX_W, TEX_H, 70);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.roundRect(30, 30, TEX_W - 60, TEX_H - 60, 44);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const { text, size, y } of LINES) {
      ctx.font = `${size}px ${FONT}`;
      ctx.fillText(text, TEX_W / 2, y * TEX_H, TEX_W - 160);
    }
    texture.needsUpdate = true;
  };
  draw();
  // The display font may still be loading; redraw once it is ready.
  void document.fonts?.load(`64px ${FONT}`).then(draw);

  const material = new MeshStandardMaterial({
    map: texture,
    roughness: 1,
    metalness: 0,
    flatShading: true,
    side: DoubleSide,
    alphaTest: 0.5, // the rounded corners
  });
  // Seen through the jar from behind, a sticker shows its plain backing, not mirrored text (#fffaf0, linear).
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
if ( ! gl_FrontFacing ) diffuseColor.rgb = vec3( 1.0, 0.955, 0.871 );`,
    );
  };

  return {
    mesh: new Mesh(createLabelGeometry(), material),
    dispose: () => texture.dispose(),
  };
}
