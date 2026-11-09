import { CylinderGeometry, DoubleSide, Group, LatheGeometry, Mesh, MeshStandardMaterial, Vector2 } from 'three';
import { FACET_SIDES, JAR } from './jarGeometry';

const BAND_RADIUS = JAR.neckRadius + 0.08;
const BAND_HEIGHT = 0.3;

// Lid is its own group (origin at the bottom rim) so it can spin and lift on its own.
export function createLid(): Group {
  const material = new MeshStandardMaterial({
    color: '#f6b40e',
    metalness: 0.7,
    roughness: 0.4,
    flatShading: true,
    side: DoubleSide,
  });
  const group = new Group();

  const band = new CylinderGeometry(BAND_RADIUS, BAND_RADIUS, BAND_HEIGHT, FACET_SIDES, 1, true);
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
  const top = new Mesh(new LatheGeometry(profile.reverse(), FACET_SIDES), material);
  group.add(top);

  return group;
}

// Y of the lid origin when screwed on (band covers the threads, top just above the lip).
export const LID_SEAT_Y = JAR.lipY + 0.03 - BAND_HEIGHT;
