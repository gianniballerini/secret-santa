import { Mesh, MeshBasicMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace, TextureLoader } from 'three';
import type { Texture } from 'three';
import tileUrl from '../assets/tablecloth.webp?url';

// World size of the cloth. The far edge sits behind the jar so the backdrop shows above it.
export const TABLE_WIDTH = 24;
export const TABLE_DEPTH = 8;
export const TABLE_FAR_Z = -2.6;
// One tile holds 4x4 gingham checks.
const TILE_WORLD = 1;

export interface Table {
  mesh: Mesh;
  dispose(): void;
}

/** A low-poly celeste gingham tablecloth lying at y = 0, where the jar and its contact shadow sit. */
export async function createTable(): Promise<Table> {
  // Tinted down: a bright cloth would glare against the night sky. Stays plain tint if the image cannot load.
  const material = new MeshBasicMaterial({ color: 0x8496bd });
  const mesh = new Mesh(new PlaneGeometry(TABLE_WIDTH, TABLE_DEPTH), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0, TABLE_FAR_Z + TABLE_DEPTH / 2);

  let texture: Texture | null = null;
  try {
    texture = await new TextureLoader().loadAsync(tileUrl);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(TABLE_WIDTH / TILE_WORLD, TABLE_DEPTH / TILE_WORLD);
    texture.anisotropy = 8;
    material.map = texture;
    material.needsUpdate = true;
  } catch {
    /* the plain tint stays */
  }

  return {
    mesh,
    dispose() {
      texture?.dispose();
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}
