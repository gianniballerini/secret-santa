import {
  AmbientLight,
  CanvasTexture,
  Color,
  Euler,
  Group,
  HalfFloatType,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import type { Texture } from 'three';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { createJarGeometry, createGlassMaterial } from './jarGeometry';
import { createLid, LID_SEAT_Y } from './lidGeometry';
import { createNote, NOTE_HEIGHT, NOTE_WIDTH } from './note';
import type { Note } from './note';
import { createPaperMaterial, createPaperPile } from './paper';
import { createJarControls, requestMotionPermission } from './jarControls';
import type { JarControls } from './jarControls';
import { createStudioEnvironment } from './studioEnv';
import { createTable } from './table';
import backdropUrl from '../assets/backdrop.svg?url';
import { createJarPhysics, initPhysics, poseAt } from './physics';
import type { JarPhysics, Snapshot } from './physics';
import { stirNote } from './stir';
import type { Pose } from './stir';
import { easeInCubic, easeInOutCubic, easeOut, easePop, lerp, linear, tween } from './tween';

// Note poses in jar space (jar sits on y = 0, centred on the origin).
const NOTE_TOP = new Vector3(0, 2.75, 0.3);
const NOTE_FINAL = new Vector3(0, 2.2, 1.2);
const NOTE_FINAL_SCALE = 0.85;
// Tall phones have room above the card, so the name gets to be bigger.
const NOTE_FINAL_SCALE_TALL = 1.2;
const TALL_ASPECT = 0.5;
// The studio environment alone leaves the paper grey. Ambient only adds diffuse light, so glass and metal keep their look.
const PAPER_AMBIENT_COLOR = '#fff1dc';
const PAPER_AMBIENT_INTENSITY = 1.5;
const MAX_PIXEL_RATIO = 2;
const COARSE_POINTER_PIXEL_RATIO = 1.5; // the full-viewport transmission pass is costly on phones
// Where the note is dropped onto the pile (x, z) and how its folded stack is laid (flat, with a slight
// tilt and yaw). It settles on the pile by physics.
const NOTE_REST_XZ: [number, number] = [0.12, 0.16];
const NOTE_REST_EULER = new Euler(-Math.PI / 2 + 0.14, 0.1, 0.9);
const NOTE_DROP = 0.02; // height above the pile top it starts from
// The orientation the unfold starts from.
const NOTE_PICK_EULER = new Euler(0.4, -0.8, 0.3);

const STIR_MS = 1400;
const UNFOLD_MS = 1800;
const DOF_MS = 500;
const DOF_APERTURE = 0.012; // blur per unit of depth away from the note
const DOF_MAX_BLUR = 0.012; // cap, as a fraction of the frame

const TAU = Math.PI * 2;
const CAMERA_POS = new Vector3(0, 2.1, 6.2);
const CAMERA_LOOK = new Vector3(0, 1.35, 0);
const SPIN_FRICTION = 0.92; // velocity kept per 60 fps frame after a fling
const SHAKE_MS = 1100;
const SHAKE_KICK = 0.6; // slip jolt at each wobble peak, relative to PHYSICS.kick
const SWIRL_SHARE = 0.4; // fraction of the stir the invisible hand pushes the pile
const SETTLE_STEPS = 120; // physics steps that let the note sink into the pile before the rest pose is taken
// Parallax on the opened note: camera offset and note counter-tilt at full input.
const PARALLAX_CAMERA: [number, number] = [0.25, 0.15];
// Radians of pivot. The camera drifts the same way, which cancels part of it, so these must clearly exceed it.
const PARALLAX_NOTE: [number, number] = [0.45, 0.3];

// Night navy, used when the backdrop image cannot be rasterised.
const FALLBACK_BACKGROUND = 0x10214a;
// Below this aspect the field of view widens so the jar keeps its horizontal framing.
const MIN_FRAMING_ASPECT = 0.8;
const BASE_FOV = 30;
const BACKDROP_ASPECT = 390 / 844;
const BACKDROP_PX: [number, number] = [780, 1688];
const SHIFT_MS = 700;
// Idle invitation: a small wobble every few seconds until the first interaction.
const NUDGE_FIRST_MS = 3200;
const NUDGE_EVERY_MS = 5200;
const NUDGE_STRENGTH = 0.35;
// Screen margins (NDC units, 2 = full height) kept around the note when it makes room for the card.
const NOTE_TOP_MARGIN = 0.1;
const NOTE_CARD_MARGIN = 0.08;

export class JarScene {
  private renderer!: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(30, 0.8, 0.1, 50);
  private jar = new Group();
  // The jar pose physics follows: the jar without its idle sway and wiggle.
  private handPose = new Matrix4();
  private handPos = new Vector3();
  private handQuat = new Quaternion();
  private handEuler = new Euler();
  private handScale = new Vector3(1, 1, 1);
  private lid = createLid();
  private note: Note = createNote();
  private slipMeshes: Mesh[] = [];
  private physics: JarPhysics | null = null;
  // Slips first, then the note: the same order as the physics bodies.
  private bodyMeshes: Mesh[] = [];
  private noteBody = -1;
  private restSnapshot: Snapshot = new Float32Array();
  private swirl = 0; // 0..1 push of the invisible hand while the lid is off
  private noteRest: Pose = { position: new Vector3(), quaternion: new Quaternion() };
  private notePick: Pose = { position: NOTE_TOP.clone(), quaternion: new Quaternion().setFromEuler(NOTE_PICK_EULER) };
  private composer!: EffectComposer;
  private bokeh!: BokehPass;
  private backdrop: CanvasTexture | null = null;

  private get bokehUniforms(): Record<string, { value: number }> {
    return this.bokeh.uniforms as Record<string, { value: number }>;
  }
  private env: Texture | null = null;
  private container: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private frame = 0;
  private visible = false;
  private paused = false;
  private opened = false;
  private abort = new AbortController();
  private controls: JarControls | null = null;
  private controlsAbort = new AbortController();
  private lastNow = 0;
  // Spin from dragging, on top of the idle sway, which fades out while the user is in control.
  private spin = 0;
  private spinVelocity = 0;
  private dragging = false;
  private sway = 0;
  // Shake: an in-flight tap or phone shake writes the wobble here; tick adds it to the pose.
  private shakeAbort = new AbortController();
  private shaking = false;
  private shakeZ = 0;
  private shakeX = 0;
  // Parallax once the note is open.
  private parallax = false;
  private tilt = { x: 0, y: 0 };
  private tiltTarget = { x: 0, y: 0 };
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Frame shift: how far (fraction of the view height) the picture is moved up to make room for the card.
  private frameShift = 0;
  private shiftAbort = new AbortController();
  // Idle invitation state.
  private interacted = false;
  private nextNudge = 0;
  /** Called when the visitor asks to open the jar (tap or keyboard). The caller owns any double-fire guard. */
  onOpenRequest: (() => void) | null = null;
  private extras: Array<{ dispose(): void }> = [];
  /** Resolves once physics and the paper pile are built. */
  ready: Promise<void> = Promise.resolve();

  /** Throws when WebGL is unavailable so the caller can fall back to the CSS gift. */
  mount(container: HTMLElement): void {
    this.container = container;
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(this.idlePixelRatio());
    this.renderer.transmissionResolutionScale = 1; // full-res refraction: the papers stay crisp through the glass
    // Neutral keeps whites white and page colours true; ACES greys and shifts them.
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setSize(1, 1);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(this.renderer.domElement);

    // Everything renders through the composer; OutputPass is the only place that tone-maps and converts to sRGB.
    // RenderPass draws into a render target, where the renderer's own tone mapping is skipped, so it is applied once.
    // The backdrop is a texture, so the glass refracts it and the depth-of-field blurs it. It is dark, so the
    // tone mapping in OutputPass barely changes it.
    this.scene.background = new Color(FALLBACK_BACKGROUND);
    this.env = createStudioEnvironment(this.renderer);
    this.scene.environment = this.env;
    // The canvas equirect is LDR (max 1), so boost it to studio levels here.
    this.scene.environmentIntensity = 2.2;
    this.scene.add(new AmbientLight(PAPER_AMBIENT_COLOR, PAPER_AMBIENT_INTENSITY));

    this.camera.position.copy(CAMERA_POS);
    this.camera.lookAt(CAMERA_LOOK);

    this.scene.add(this.jar);
    this.ready = Promise.all([this.build(), this.loadBackdrop()]).then(() => undefined);

    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.bokeh = new BokehPass(this.scene, this.camera, { focus: 1, aperture: 0, maxblur: DOF_MAX_BLUR });
    this.bokeh.enabled = false; // aperture 0: skip the depth pass entirely
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(this.bokeh);
    this.composer.addPass(new OutputPass());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    // Also covers `hidden` and off-screen: no rendering while nobody can see the canvas.
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.syncLoop();
    });
    this.intersectionObserver.observe(container);
    document.addEventListener('visibilitychange', this.syncLoop);
    this.controls = createJarControls(container, {
      onSpinStart: () => {
        if (this.opened) return;
        this.interacted = true;
        this.dragging = true;
        this.spinVelocity = 0;
      },
      onSpin: (delta) => {
        if (this.dragging) this.spin += delta;
      },
      onSpinEnd: (velocity) => {
        if (!this.dragging) return;
        this.dragging = false;
        this.spinVelocity = this.reduced ? 0 : velocity;
      },
      onTap: () => {
        this.interacted = true;
        this.onOpenRequest?.();
      },
      onShake: () => {
        this.interacted = true;
        this.shake(1.6);
      },
      onTilt: (x, y) => {
        this.tiltTarget.x = x;
        this.tiltTarget.y = y;
      },
    }, this.controlsAbort.signal);
    this.resize();
  }

  /** Asks for device motion access (iOS). Call from a user gesture. */
  requestMotion(): void {
    requestMotionPermission();
  }

  /** Rasterises the SVG backdrop into the scene background. Keeps the navy colour if it cannot load. */
  private async loadBackdrop(): Promise<void> {
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = backdropUrl;
      await img.decode();
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = BACKDROP_PX;
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.wrapS = RepeatWrapping; // wide screens tile the image sideways; its edges match
      texture.anisotropy = 4;
      this.backdrop = texture;
      this.scene.background = texture;
      this.updateBackdropFit();
    } catch {
      /* the navy background stays */
    }
  }

  /** Cover-fit, anchored to the top (where the decoration lives). Wide screens fit the height and tile sideways. */
  private updateBackdropFit(): void {
    const texture = this.backdrop;
    if (!texture) return;
    const aspect = this.camera.aspect;
    if (aspect >= BACKDROP_ASPECT) {
      // Fit the width, show the top part of the image.
      const wide = aspect > MIN_FRAMING_ASPECT;
      if (wide) {
        texture.repeat.set(aspect / BACKDROP_ASPECT, 1);
        texture.offset.set((1 - texture.repeat.x) / 2, 0);
      } else {
        const visible = BACKDROP_ASPECT / aspect;
        texture.repeat.set(1, visible);
        texture.offset.set(0, 1 - visible);
      }
    } else {
      // Taller than the image: fit the height, crop the sides evenly.
      const visible = aspect / BACKDROP_ASPECT;
      texture.repeat.set(visible, 1);
      texture.offset.set((1 - visible) / 2, 0);
    }
  }

  private async build(): Promise<void> {
    const glassGeo = createJarGeometry();
    const glass = new Mesh(glassGeo, createGlassMaterial());
    await initPhysics();
    const pile = await createPaperPile();
    const paperMaterial = createPaperMaterial();
    this.slipMeshes = pile.slips.map((slip) => {
      const mesh = new Mesh(slip.geometry, paperMaterial);
      mesh.position.copy(slip.position);
      return mesh;
    });
    this.lid.position.y = LID_SEAT_Y;
    this.jar.add(...this.slipMeshes, glass, this.lid, this.note.mesh);

    // The folded note lies in the top layer like any other slip, sunk slightly into it.
    const geo = this.note.mesh.geometry;
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const [nx, nz] = NOTE_REST_XZ;
    const reach = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) / 2;
    const top = pile.topY(nx, nz, reach * 0.8);
    this.noteRest.position.set(nx, top + NOTE_DROP + (box.max.z - box.min.z) / 2, nz);
    this.noteRest.quaternion.setFromEuler(NOTE_REST_EULER);
    this.applyNoteRest();

    // Slips and note are dynamic bodies. Let the note come to rest on the pile, then that is the rest pose.
    this.bodyMeshes = [...this.slipMeshes, this.note.mesh];
    this.noteBody = this.slipMeshes.length;
    const physics = createJarPhysics([
      ...pile.slips.map(({ geometry, position }) => ({ geometry, position })),
      { geometry: geo, position: this.noteRest.position, quaternion: this.noteRest.quaternion },
    ]);
    physics.settle(SETTLE_STEPS);
    this.restSnapshot = physics.snapshot();
    this.physics = physics;
    const rest = poseAt(this.restSnapshot, this.noteBody);
    this.noteRest.position.copy(rest.position);
    this.noteRest.quaternion.copy(rest.quaternion);
    physics.restore(this.restSnapshot);
    physics.sync(this.bodyMeshes);

    // Tablecloth under the jar. It is drawn below the contact shadow (y = 0 against 0.002).
    const table = createTable();
    this.scene.add(table.mesh);
    this.extras.push(table);

    // Soft contact shadow so the jar sits on the table.
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const shadowTex = new CanvasTexture(c);
    const shadow = new Mesh(
      new PlaneGeometry(3, 3),
      new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.002;
    this.scene.add(shadow);
    this.extras.push(shadowTex);
  }

  // Slips, note and lid back on their rest poses, whatever the physics did.
  private restoreRest(): void {
    const { physics } = this;
    if (!physics) return;
    this.swirl = 0;
    physics.setActive(this.noteBody, true);
    // Spin and shake are zero here, so the hand pose is the identity.
    physics.restore(this.restSnapshot, this.handPose.identity());
    physics.setLid(true);
    physics.sync(this.bodyMeshes);
    this.note.mesh.scale.setScalar(1);
  }

  private applyNoteRest(): void {
    this.note.mesh.position.copy(this.noteRest.position);
    this.note.mesh.quaternion.copy(this.noteRest.quaternion);
    this.note.mesh.scale.setScalar(1);
  }

  private resize(): void {
    if (!this.container) return;
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Tall screens would crop the jar sideways; widen the vertical field of view to keep its horizontal framing.
    this.camera.fov = aspect < MIN_FRAMING_ASPECT
      ? (2 * Math.atan((Math.tan((BASE_FOV / 2) * (Math.PI / 180)) * MIN_FRAMING_ASPECT) / aspect) * 180) / Math.PI
      : BASE_FOV;
    this.applyFrameShift();
    this.updateBackdropFit();
    if (!this.frame) this.renderOnce();
  }

  private idlePixelRatio(): number {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    return Math.min(window.devicePixelRatio, coarse ? COARSE_POINTER_PIXEL_RATIO : MAX_PIXEL_RATIO);
  }

  private setPixelRatio(ratio: number): void {
    if (this.renderer.getPixelRatio() === ratio) return;
    this.renderer.setPixelRatio(ratio);
    this.resize();
    this.renderOnce(); // resizing clears the canvas; never present an empty frame
  }

  private get noteFinalScale(): number {
    return this.camera.aspect < TALL_ASPECT ? NOTE_FINAL_SCALE_TALL : NOTE_FINAL_SCALE;
  }

  private applyFrameShift(): void {
    const { container } = this;
    if (!container) return;
    if (this.frameShift === 0) {
      this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
      return;
    }
    const { clientWidth: w, clientHeight: h } = container;
    // Moving the view window down moves the picture up.
    this.camera.setViewOffset(w, h, 0, this.frameShift * h, w, h);
  }

  /**
   * How far to move the picture up, as a fraction of the view height, so the opened note clears a card that
   * covers `cardFraction` of the viewport from the bottom. Measured from where the note ends up on screen.
   */
  noteClearanceShift(cardFraction: number): number {
    const cam = this.camera.clone();
    cam.clearViewOffset();
    cam.position.copy(CAMERA_POS);
    cam.lookAt(CAMERA_LOOK);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    const halfW = (NOTE_WIDTH / 2) * this.noteFinalScale;
    const halfH = (NOTE_HEIGHT / 2) * this.noteFinalScale;
    const edgeY = (dy: number) => {
      let best = dy < 0 ? Infinity : -Infinity;
      for (const dx of [-halfW, halfW]) {
        const y = new Vector3(NOTE_FINAL.x + dx, NOTE_FINAL.y + dy, NOTE_FINAL.z).project(cam).y;
        best = dy < 0 ? Math.min(best, y) : Math.max(best, y);
      }
      return best;
    };
    const bottom = edgeY(-halfH);
    const top = edgeY(halfH);
    const needed = (-1 + 2 * cardFraction + NOTE_CARD_MARGIN - bottom) / 2;
    const room = (1 - NOTE_TOP_MARGIN - top) / 2;
    return Math.max(0, Math.min(needed, room));
  }

  /** Moves the picture up by `fraction` of the view height without changing perspective. Tweened. */
  setFrameShift(fraction: number, animate = true): void {
    this.shiftAbort.abort();
    this.shiftAbort = new AbortController();
    const from = this.frameShift;
    const apply = (value: number) => {
      this.frameShift = value;
      this.applyFrameShift();
      // The loop may be idle (paused, hidden, reduced motion): draw the new framing ourselves.
      if (!this.frame) this.renderOnce();
    };
    if (!animate || this.reduced || from === fraction) {
      apply(fraction);
      return;
    }
    void tween(SHIFT_MS, easeInOutCubic, (v) => apply(lerp(from, fraction, v)), this.shiftAbort.signal);
  }

  /** Return to the closed jar, showing a new name. Safe to call repeatedly. */
  reset(name: string): void {
    this.abort.abort();
    this.abort = new AbortController();
    this.cancelShake();
    this.opened = false;
    this.spin = 0;
    this.spinVelocity = 0;
    this.dragging = false;
    this.sway = 0;
    this.parallax = false;
    this.tilt.x = this.tilt.y = 0;
    this.interacted = false;
    this.nextNudge = 0;
    this.shiftAbort.abort();
    this.frameShift = 0;
    this.applyFrameShift();
    this.camera.position.copy(CAMERA_POS);
    this.camera.lookAt(CAMERA_LOOK);
    this.lid.visible = true;
    this.lid.position.set(0, LID_SEAT_Y, 0);
    this.lid.rotation.set(0, 0, 0);
    this.setPixelRatio(this.idlePixelRatio());
    this.note.setName(name);
    this.note.setCrumple(1);
    this.applyNoteRest();
    this.setAperture(0);
    this.jar.rotation.set(0, 0, 0);
    this.jar.position.x = 0;
    this.restoreRest();
    this.renderOnce();
  }

  /** Plays unscrew, pull, unfold. Under reduced motion it jumps to the final state. */
  async open(): Promise<void> {
    const signal = this.abort.signal;
    this.cancelShake();
    this.opened = true;
    this.dragging = false;
    this.spinVelocity = 0;
    const { lid, note } = this;
    const nm = note.mesh;
    // The note leaves the physics world from wherever the pile carried it.
    this.physics?.setActive(this.noteBody, false);
    const from: Pose = { position: nm.position.clone(), quaternion: nm.quaternion.clone() };

    if (this.reduced) {
      this.spin = 0;
      this.jar.rotation.set(0, 0, 0);
      lid.visible = false;
      note.setCrumple(0);
      nm.position.copy(NOTE_FINAL);
      nm.scale.setScalar(this.noteFinalScale);
      nm.rotation.set(0, 0, 0);
      this.setAperture(DOF_APERTURE);
      this.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
      this.renderOnce();
      return;
    }

    // 1. Unscrew: 1.5 turns while lifting slightly.
    await tween(600, easeInOutCubic, (v) => {
      lid.rotation.y = -v * Math.PI * 3;
      lid.position.y = LID_SEAT_Y + 0.05 * v;
    }, signal);
    if (signal.aborted) return;

    // 2. Lid lifts away while an invisible hand swirls the slips and picks the note.
    this.physics?.setLid(false);
    const lidFly = tween(450, easeInCubic, (v) => {
      lid.position.set(0.8 * v, LID_SEAT_Y + 0.05 + 2.2 * v, 0);
      lid.rotation.z = -0.7 * v;
    }, signal);
    const stir = tween(STIR_MS, easeInOutCubic, (v) => {
      this.swirl = v < SWIRL_SHARE ? Math.sin((Math.PI * v) / SWIRL_SHARE) : 0;
      stirNote(nm, v, from, this.notePick);
    }, signal);
    await Promise.all([lidFly, stir]);
    this.swirl = 0;
    if (signal.aborted) return;

    // 3. Come to the camera while unfolding slowly, one fold at a time.
    const finalScale = this.noteFinalScale;
    await tween(UNFOLD_MS, linear, (p) => {
      note.setCrumple(1 - easeInOutCubic(p));
      const v = easePop(Math.min(p / 0.45, 1)); // travel finishes early so the unfold reads facing the camera
      nm.position.lerpVectors(NOTE_TOP, NOTE_FINAL, v);
      nm.scale.setScalar(lerp(1, finalScale, v));
      nm.rotation.set(lerp(0.4, 0, v), lerp(-0.8, 0, v), lerp(0.3, 0, v));
    }, signal);
    if (signal.aborted) return;
    lid.visible = false;

    // 4. Unfocus the jar; the note stays sharp. The scene is about to go still, so the name can afford full resolution.
    this.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    nm.updateWorldMatrix(true, false);
    const focus = nm.getWorldPosition(new Vector3()).sub(this.camera.position).dot(this.camera.getWorldDirection(new Vector3()));
    this.bokehUniforms.focus.value = focus;
    if (!(await tween(DOF_MS, easeOut, (v) => this.setAperture(v * DOF_APERTURE), signal))) return;

    // 5. The note follows the mouse or the phone's tilt.
    this.controls?.resetTiltBaseline();
    this.tiltTarget.x = this.tiltTarget.y = 0;
    this.parallax = true;
  }

  /** Wobbles the closed jar and jolts the slips at each peak; physics lets them tumble and settle. */
  shake(strength = 1): void {
    if (this.opened || this.shaking || this.reduced || !this.physics) return;
    this.shaking = true;
    const signal = this.shakeAbort.signal;
    let peaks = 0;
    void tween(SHAKE_MS, linear, (p) => {
      const decay = (1 - p) * strength;
      this.shakeZ = Math.sin(p * Math.PI * 8) * 0.12 * decay;
      this.shakeX = Math.sin(p * Math.PI * 6) * 0.06 * decay;
      // The wobble peaks at p = (k + 0.5) / 8.
      const reached = Math.floor(p * 8 + 0.5);
      if (reached > peaks) {
        peaks = reached;
        this.physics?.kick(SHAKE_KICK * decay);
      }
    }, signal).then((done) => {
      if (done) this.endShake();
    });
  }

  private endShake(): void {
    this.shaking = false;
    this.shakeZ = this.shakeX = 0;
  }

  private cancelShake(): void {
    if (!this.shaking) return;
    this.shakeAbort.abort();
    this.shakeAbort = new AbortController();
    this.endShake();
  }

  private setAperture(aperture: number): void {
    this.bokehUniforms.aperture.value = aperture;
    this.bokeh.enabled = aperture > 0;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.syncLoop();
  }

  private syncLoop = (): void => {
    const shouldRun = this.visible && !this.paused && !document.hidden;
    if (shouldRun && !this.frame) this.frame = requestAnimationFrame(this.tick);
    if (!shouldRun && this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  };

  private tick = (now: number): void => {
    this.frame = requestAnimationFrame(this.tick);
    const dt = this.lastNow ? Math.min(now - this.lastNow, 50) : 16;
    this.lastNow = now;
    const frames = dt / (1000 / 60);

    // Idle invitation: a small wobble every few seconds until the first interaction.
    if (!this.interacted && !this.opened && !this.reduced && this.physics) {
      if (!this.nextNudge) this.nextNudge = now + NUDGE_FIRST_MS;
      else if (now >= this.nextNudge) {
        this.nextNudge = now + NUDGE_EVERY_MS;
        this.shake(NUDGE_STRENGTH);
      }
    }

    // Fling inertia; once opened, the spin settles on the nearest whole turn so the note faces the camera.
    if (this.opened) {
      const target = Math.round(this.spin / TAU) * TAU;
      // Snap once close: an endless approach would move the physics jar a hair every frame.
      this.spin = Math.abs(target - this.spin) < 1e-4 ? target : this.spin + (target - this.spin) * (1 - 0.9 ** frames);
    } else if (!this.dragging && this.spinVelocity) {
      this.spin += this.spinVelocity * dt;
      this.spinVelocity *= SPIN_FRICTION ** frames;
      if (Math.abs(this.spinVelocity) < 1e-5) this.spinVelocity = 0;
    }

    // Gentle idle turntable plus a periodic wiggle (replaces CSS gift-wiggle). Fades out while the user
    // is in control and once opened, and fades back in from wherever the jar was left.
    const t = now / 1000;
    const wiggleT = (t % 2.5) / 2.5;
    const wiggle = wiggleT > 0.8 ? Math.sin((wiggleT - 0.8) * Math.PI * 10) * 0.05 * (1 - (wiggleT - 0.8) / 0.2) : 0;
    const idle = !(this.reduced || this.opened || this.dragging || this.shaking || this.spinVelocity);
    this.sway += ((idle ? 1 : 0) - this.sway) * (1 - 0.95 ** frames);
    this.jar.rotation.y = this.spin + this.sway * Math.sin(t * 0.6) * 0.3;
    this.jar.rotation.z = this.sway * wiggle + this.shakeZ;
    this.jar.position.x = this.shakeX;

    if (this.physics && !this.reduced) {
      // Physics sees only the hand (spin, fling, shake). The idle sway and wiggle are decorative: the
      // slips ride them rigidly, so the walls don't keep nudging them awake.
      this.handEuler.set(0, this.spin, this.shakeZ);
      this.handPose.compose(this.handPos.set(this.shakeX, 0, 0), this.handQuat.setFromEuler(this.handEuler), this.handScale);
      if (this.swirl) this.physics.swirl(this.swirl, dt / 1000);
      this.physics.step(dt / 1000, this.handPose);
      this.physics.sync(this.bodyMeshes);
    }

    this.updateParallax(frames);
    this.composer.render();
  };

  private updateParallax(frames: number): void {
    const k = this.parallax ? 1 : 0;
    const ease = 1 - 0.92 ** frames;
    this.tilt.x += (this.tiltTarget.x * k - this.tilt.x) * ease;
    this.tilt.y += (this.tiltTarget.y * k - this.tilt.y) * ease;
    if (!this.parallax) return;
    const { x, y } = this.tilt;
    this.camera.position.set(CAMERA_POS.x + x * PARALLAX_CAMERA[0], CAMERA_POS.y - y * PARALLAX_CAMERA[1], CAMERA_POS.z);
    this.camera.lookAt(CAMERA_LOOK);
    const nm = this.note.mesh;
    nm.rotation.set(y * PARALLAX_NOTE[1], x * PARALLAX_NOTE[0], 0);
    // Keep the note in focus as the camera moves.
    nm.updateWorldMatrix(true, false);
    this.bokehUniforms.focus.value = nm.getWorldPosition(new Vector3()).sub(this.camera.position).dot(this.camera.getWorldDirection(new Vector3()));
  }

  private renderOnce(): void {
    this.composer?.render();
  }

  dispose(): void {
    this.abort.abort();
    this.shakeAbort.abort();
    this.shiftAbort.abort();
    this.controlsAbort.abort();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    document.removeEventListener('visibilitychange', this.syncLoop);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.scene.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.geometry.dispose();
        const mats: Material[] = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.physics?.dispose();
    this.note.dispose();
    this.backdrop?.dispose();
    this.extras.forEach((e) => e.dispose());
    this.env?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
