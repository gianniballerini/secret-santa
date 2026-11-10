import { Box3, CanvasTexture, Group, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, SRGBColorSpace, Sprite, SpriteMaterial, Vector3 } from 'three';
import type { Raycaster } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import modelUrl from '../assets/models/boombox.glb?url';
import { clamp01, easeOut, lerp, tween } from './tween';

// "1980s Boombox" by Jen S Abbott (CC BY 4.0). See docs/CREDITS.md.
// On the table behind the jar, to its right, turned a little toward the home camera (front is +z).
export const BOOMBOX_X = 1.15;
export const BOOMBOX_Z = -1.7;
const BOOMBOX_YAW = -0.2;
const BOOMBOX_WIDTH = 0.9; // world units
// Focus camera: orbits the radio from its right (so the jar stays out of frame), looking slightly down.
const FOCUS_YAW = 0.25;
const FOCUS_PITCH = 0.3;
const FOCUS_MARGIN = 1.1; // around the bounding sphere
const FOCUS_DROP = 0.12; // the look target sits this far below the radio's centre, so it frames a little above centre
const PRESS_MS = 220;
const PRESS_SQUASH = 0.06;
// Beat thump: the whole radio squashes and stretches with the bass (the model is one mesh, the cones cannot move).
const THUMP_STRETCH = 0.03;
const THUMP_SQUEEZE = 0.015;
const THUMP_HOP = 0.012; // world units
const THUMP_ROCK = 0.0105; // radians, about 0.6 degrees
const THUMP_EASE = 14; // per second, how fast `beat` follows the music
const BEAT_PEAK = 0.45; // beat level that counts as a hit for the rock
// Floating notes: pooled sprites that rise from the speakers while the camera is at the radio.
const NOTE_POOL = 6;
const NOTE_EVERY_S = 0.6;
const NOTE_LIFE_S = 1.6;
const NOTE_RISE = 0.5;
const NOTE_SIZE = 0.16;
const NOTE_SWAY = 0.04;
const SPEAKER_X = 0.26; // fraction of the width either side of the centre
const SPEAKER_Y = 0.78; // fraction of the height
const SPEAKER_Z = 0.1; // fraction of the width in front of the centre
const NOTE_CREAM = '#fff6e0'; // --cream

export interface FocusPose {
  position: Vector3;
  target: Vector3;
}

export interface Boombox {
  group: Group;
  /** Camera pose that fits the radio for this projection (contain-fit). */
  focusPose(fov: number, aspect: number): FocusPose;
  /** True when the ray hits the radio. */
  hit(raycaster: Raycaster): boolean;
  /** A small squash, like a pressed key. `onFrame` lets an idle render loop redraw. */
  press(onFrame: () => void): void;
  /**
   * Every frame. `level` (0..1) is the beat: the radio thumps with it and rests at 0. `showNotes` lets notes drift up
   * from the speakers; the ones in flight finish when it turns off.
   */
  update(dt: number, level: number, showNotes: boolean): void;
  dispose(): void;
}

function contactShadow(width: number): { mesh: Mesh; dispose(): void } {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.4)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(c);
  const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const mesh = new Mesh(new PlaneGeometry(width * 1.5, width * 0.8), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.004; // above the cloth (0) and the jar's shadow (0.002)
  mesh.raycast = () => {};
  return {
    mesh,
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

function noteTexture(glyph: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = NOTE_CREAM;
  ctx.font = 'bold 52px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(5, 10, 30, 0.5)';
  ctx.shadowBlur = 4;
  ctx.fillText(glyph, 32, 34);
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

interface FloatingNote {
  sprite: Sprite;
  age: number; // seconds; negative or >= life means idle
  side: number; // -1 or 1: which speaker
  phase: number;
}

/** Loads the radio and stands it on the table. Rejects if the model cannot be loaded. */
export async function createBoombox(): Promise<Boombox> {
  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const model = gltf.scene;
  // The file ships a flat cardboard sheet under the radio; the cloth is the surface here.
  model.traverse((obj: Object3D) => {
    if (obj.name.toLowerCase().includes('cardboard')) obj.visible = false;
  });
  const raw = new Box3().setFromObject(model);
  const size = raw.getSize(new Vector3());
  const scale = BOOMBOX_WIDTH / Math.max(size.x, size.z);
  model.scale.setScalar(scale);
  // Stand it on y = 0 and centre it on its own origin.
  const fitted = new Box3().setFromObject(model);
  const centre = fitted.getCenter(new Vector3());
  model.position.set(-centre.x, -fitted.min.y, -centre.z);

  const group = new Group();
  group.add(model);
  const shadow = contactShadow(BOOMBOX_WIDTH);
  group.add(shadow.mesh);
  group.position.set(BOOMBOX_X, 0, BOOMBOX_Z);
  group.rotation.y = BOOMBOX_YAW;
  group.updateMatrixWorld(true);

  const bounds = new Box3().setFromObject(model);
  const middle = bounds.getCenter(new Vector3());
  const radius = (bounds.getSize(new Vector3()).length() / 2) * FOCUS_MARGIN;
  const target = middle.clone().setY(middle.y - FOCUS_DROP);

  const spawn = new Vector3(0, bounds.min.y + SPEAKER_Y * (bounds.max.y - bounds.min.y), SPEAKER_Z * BOOMBOX_WIDTH);
  const textures = [noteTexture('\u266A'), noteTexture('\u266B')];
  const notes: FloatingNote[] = [];
  for (let i = 0; i < NOTE_POOL; i++) {
    const material = new SpriteMaterial({ map: textures[i % 2], transparent: true, depthWrite: false, opacity: 0 });
    const sprite = new Sprite(material);
    sprite.scale.setScalar(NOTE_SIZE);
    sprite.visible = false;
    sprite.raycast = () => {};
    group.add(sprite);
    notes.push({ sprite, age: NOTE_LIFE_S, side: i % 2 ? 1 : -1, phase: i * 1.7 });
  }
  let pressK = 0; // 0..1 press squash, composed with the thump in update
  let beat = 0;
  let rock = 0;
  let rockSide = 1;
  let wasPeak = false;
  let spawnTimer = 0;
  let nextSide = 1;

  const applyScale = () => {
    const stretch = 1 + THUMP_STRETCH * beat;
    const squeeze = 1 - THUMP_SQUEEZE * beat;
    group.scale.set(
      squeeze * (1 + pressK * PRESS_SQUASH * 0.5),
      stretch * (1 - pressK * PRESS_SQUASH),
      squeeze * (1 + pressK * PRESS_SQUASH * 0.5),
    );
  };

  let pressAbort = new AbortController();

  return {
    group,
    focusPose(fov, aspect) {
      const t = Math.tan((fov * Math.PI) / 360);
      const distance = Math.max(radius / t, radius / (t * aspect));
      const dir = new Vector3(Math.sin(FOCUS_YAW) * Math.cos(FOCUS_PITCH), Math.sin(FOCUS_PITCH), Math.cos(FOCUS_YAW) * Math.cos(FOCUS_PITCH));
      return { position: target.clone().addScaledVector(dir, distance), target: target.clone() };
    },
    hit(raycaster) {
      return raycaster.intersectObject(model, true).length > 0;
    },
    press(onFrame) {
      pressAbort.abort();
      pressAbort = new AbortController();
      void tween(PRESS_MS, easeOut, (v) => {
        pressK = Math.sin(v * Math.PI); // down and back up
        applyScale();
        onFrame();
      }, pressAbort.signal).then((done) => {
        if (done) {
          pressK = 0;
          applyScale();
        }
      });
    },
    update(dt, level, showNotes) {
      const seconds = dt / 1000;
      // Thump: ease toward the music, with a small hop and a rock that alternates on each hit.
      beat += (clamp01(level) - beat) * (1 - Math.exp(-THUMP_EASE * seconds));
      if (beat < 0.001) beat = 0;
      const peak = beat > BEAT_PEAK;
      if (peak && !wasPeak) rockSide = -rockSide;
      wasPeak = peak;
      rock += (rockSide * beat - rock) * (1 - Math.exp(-THUMP_EASE * seconds));
      group.position.y = THUMP_HOP * beat;
      group.rotation.z = THUMP_ROCK * rock;
      applyScale();

      // Notes: spawn on a timer, rise, sway and fade.
      if (showNotes) {
        spawnTimer -= seconds;
        if (spawnTimer <= 0) {
          const idle = notes.find((n) => n.age >= NOTE_LIFE_S);
          if (idle) {
            spawnTimer = NOTE_EVERY_S;
            nextSide = -nextSide;
            idle.age = 0;
            idle.side = nextSide;
            idle.sprite.visible = true;
          }
        }
      }
      for (const n of notes) {
        if (n.age >= NOTE_LIFE_S) continue;
        n.age += seconds;
        const p = clamp01(n.age / NOTE_LIFE_S);
        if (p >= 1) {
          n.sprite.visible = false;
          continue;
        }
        n.sprite.position.set(
          spawn.x + n.side * SPEAKER_X * BOOMBOX_WIDTH + Math.sin(n.age * 3 + n.phase) * NOTE_SWAY,
          spawn.y + p * NOTE_RISE,
          spawn.z,
        );
        const material = n.sprite.material;
        material.opacity = Math.min(p / 0.15, 1) * (1 - clamp01((p - 0.6) / 0.4));
        n.sprite.scale.setScalar(NOTE_SIZE * lerp(0.7, 1, Math.min(p / 0.2, 1)));
      }
    },
    dispose() {
      pressAbort.abort();
      for (const n of notes) {
        group.remove(n.sprite);
        n.sprite.material.dispose();
      }
      textures.forEach((t) => t.dispose());
      shadow.dispose();
      model.traverse((obj: Object3D) => {
        const mesh = obj as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          (m as MeshBasicMaterial).map?.dispose();
          m.dispose();
        });
      });
    },
  };
}
