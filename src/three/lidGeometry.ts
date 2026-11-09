import { CylinderGeometry, DoubleSide, Group, LatheGeometry, Mesh, MeshStandardMaterial, Vector2 } from 'three';
import { JAR } from './jarGeometry';

const BAND_RADIUS = JAR.neckRadius + 0.08;
const BAND_HEIGHT = 0.3;
const KNURL_COUNT = 90; // N in sin(theta * N)
const KNURL_DEPTH = 0.012;

// Lid is its own group (origin at the bottom rim) so it can spin and lift on its own.
export function createLid(): Group {
  const material = new MeshStandardMaterial({ color: '#c9ccd1', metalness: 1, roughness: 0.25, side: DoubleSide });
  const group = new Group();

  // Knurled band: open cylinder with a sin(theta * N) radial displacement.
  const band = new CylinderGeometry(BAND_RADIUS, BAND_RADIUS, BAND_HEIGHT, KNURL_COUNT * 4, 1, true);
  const pos = band.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const theta = Math.atan2(z, x);
    const k = 1 + (KNURL_DEPTH * Math.sin(theta * KNURL_COUNT)) / BAND_RADIUS;
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  band.computeVertexNormals();
  const bandMesh = new Mesh(band, material);
  bandMesh.position.y = BAND_HEIGHT / 2;
  group.add(bandMesh);

  // Domed top with a rolled edge.
  const r = BAND_RADIUS;
  const profile: Vector2[] = [new Vector2(0, BAND_HEIGHT + 0.05)];
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    profile.push(new Vector2((r - 0.04) * t, BAND_HEIGHT + 0.05 - 0.04 * t * t));
  }
  for (let i = 1; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    profile.push(new Vector2(r - 0.04 + 0.04 * Math.sin(a), BAND_HEIGHT + 0.01 - 0.03 * (1 - Math.cos(a))));
  }
  const top = new Mesh(new LatheGeometry(profile.reverse(), 96), material);
  group.add(top);

  return group;
}

// Y of the lid origin when screwed on (band covers the threads, top just above the lip).
export const LID_SEAT_Y = JAR.lipY + 0.03 - BAND_HEIGHT;
