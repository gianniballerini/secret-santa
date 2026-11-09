import { LatheGeometry, MeshPhysicalMaterial, ShaderChunk, Vector2 } from 'three';

// Jar dimensions in scene units (jar sits on y = 0).
export const JAR = {
  radius: 0.82,
  wall: 0.06,
  neckRadius: 0.62,
  shoulderY: 1.35,
  neckY: 1.55,
  lipY: 1.92,
  floorY: 0.14, // thick base: top of the inner floor
};

// Sides of the faceted jar and lid. Render only: the physics walls keep their own round sweep.
export const FACET_SIDES = 12;

const smooth = (t: number) => t * t * (3 - 2 * t);

// Two screw-thread bumps along the neck.
const THREADS = [1.68, 1.82];
const bump = (y: number) => THREADS.reduce((sum, c) => sum + 0.035 * Math.exp(-(((y - c) / 0.03) ** 2)), 0);

// Shoulder curve between body and neck radius, as (r, y) points.
function shoulder(r0: number, r1: number, up: boolean): Vector2[] {
  const { shoulderY: sY, neckY: nY } = JAR;
  const steps = 8;
  const out: Vector2[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = up ? i / steps : 1 - i / steps;
    out.push(new Vector2(r0 + (r1 - r0) * smooth(t), sY - 0.1 + (nY - (sY - 0.1)) * t));
  }
  return out;
}

/** Inner glass surface from the lip down to the middle of the floor, as (r, y) points. */
export function createJarInnerProfile(): Vector2[] {
  const { radius: R, wall, neckRadius: Rn, neckY: nY, lipY, floorY } = JAR;
  return [
    new Vector2(Rn - wall, lipY),
    new Vector2(Rn - wall, nY),
    ...shoulder(R - wall, Rn - wall, false),
    new Vector2(R - wall, floorY + 0.08),
    new Vector2(R - wall - 0.08, floorY),
    new Vector2(0, floorY),
  ];
}

// Closed profile with real wall thickness: outer wall up, lip, inner wall down.
// Transmission only reads as glass when there are two surfaces to refract through.
export function createJarGeometry(): LatheGeometry {
  const { radius: R, wall, neckRadius: Rn, shoulderY: sY, neckY: nY, lipY } = JAR;
  const pts: Vector2[] = [];
  const P = (r: number, y: number) => pts.push(new Vector2(r, y));

  // Outer: bottom, rounded corner, wall, shoulder, neck with threads
  P(0, 0);
  P(R - 0.1, 0);
  for (let i = 1; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    P(R - 0.1 + 0.1 * Math.sin(a), 0.1 - 0.1 * Math.cos(a));
  }
  P(R, sY - 0.1);
  pts.push(...shoulder(R, Rn, true));
  for (let y = nY; y <= lipY - 0.03; y += 0.015) P(Rn + bump(y), y);
  // Lip
  P(Rn + 0.012, lipY);
  P(Rn - wall / 2, lipY + 0.008);
  // Inner: back down the neck (starts at the lip), shoulder, wall, floor
  pts.push(...createJarInnerProfile());

  return new LatheGeometry(pts, FACET_SIDES);
}

// How much thicker the glass gets at grazing angles (silhouette) than face-on.
const EDGE_THICKNESS_MAX = 6;
const NIGHT_REFLECTION_STRENGTH = 0.3;

export function createGlassMaterial(): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({
    color: '#ffffff',
    flatShading: true,
    transmission: 1,
    roughness: 0, // any roughness blurs the papers behind the glass
    ior: 1.5,
    thickness: 0.08, // face-on refraction offset; kept small so the papers stay crisp
    attenuationColor: '#a9c2b4', // green-grey tint, builds up at the silhouette
    attenuationDistance: 0.5,
    clearcoat: 1, // second glossy layer: sharper, brighter studio reflections
    clearcoatRoughness: 0,
    specularIntensity: 1,
  });

  // A real jar wall is seen through a much longer path at its edges. Scale the thickness by
  // 1 / facing so the rim darkens and refracts like glass while the centre stays clear.
  material.onBeforeCompile = (shader) => {
    // Reflections are additive: at full strength the studio panels read as a pale ghost against the night sky.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
	reflectedLight.indirectSpecular *= ${NIGHT_REFLECTION_STRENGTH.toFixed(2)};
	clearcoatSpecularIndirect *= ${NIGHT_REFLECTION_STRENGTH.toFixed(2)};`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <transmission_fragment>',
      ShaderChunk.transmission_fragment.replace(
        'vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );',
        `vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );
	material.thickness *= min( 1.0 / max( abs( dot( n, v ) ), 1e-3 ), ${EDGE_THICKNESS_MAX.toFixed(1)} );`,
      ),
    );
  };
  return material;
}
