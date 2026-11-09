import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace } from 'three';

// World size of the cloth. The far edge sits behind the jar so the backdrop shows above it.
export const TABLE_WIDTH = 24;
export const TABLE_DEPTH = 8;
export const TABLE_FAR_Z = -2.6;
// One tile holds 2x2 gingham checks.
const TILE_WORLD = 0.5;
const TILE_PX = 128;

export interface Table {
  mesh: Mesh;
  dispose(): void;
}

/** A celeste gingham tablecloth lying at y = 0, where the jar and its contact shadow sit. */
export function createTable(): Table {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE_PX;
  const ctx = canvas.getContext('2d')!;
  const half = TILE_PX / 2;
  ctx.fillStyle = '#f4f8ff';
  ctx.fillRect(0, 0, TILE_PX, TILE_PX);
  // Gingham: translucent celeste bands in both directions; where they cross the colour deepens.
  ctx.fillStyle = 'rgba(116, 172, 223, 0.62)';
  ctx.fillRect(0, 0, half, TILE_PX);
  ctx.fillRect(0, 0, TILE_PX, half);
  ctx.fillStyle = 'rgba(90, 146, 201, 0.55)';
  ctx.fillRect(0, 0, half, half);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(TABLE_WIDTH / TILE_WORLD, TABLE_DEPTH / TILE_WORLD);
  texture.anisotropy = 8;

  // Tinted down: a bright white cloth would glare against the night sky.
  const material = new MeshBasicMaterial({ map: texture, color: 0x8496bd });
  const mesh = new Mesh(new PlaneGeometry(TABLE_WIDTH, TABLE_DEPTH), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0, TABLE_FAR_Z + TABLE_DEPTH / 2);

  return {
    mesh,
    dispose() {
      texture.dispose();
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}
