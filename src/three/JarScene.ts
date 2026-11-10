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
  MirroredRepeatWrapping,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
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
import { createBoombox } from './boombox';
import type { Boombox } from './boombox';
import { createBackLabel, BACK_LABEL } from './jarBackLabel';
import type { BackLabel, BackLabelContent } from './jarBackLabel';
import { createJarLabel } from './jarLabel';
import { createLid, LID_SEAT_Y } from './lidGeometry';
import { createNote, NOTE_HEIGHT, NOTE_WIDTH } from './note';
import type { Note } from './note';
import { createPaperMaterial, createPaperPile } from './paper';
import { createJarControls, requestMotionPermission } from './jarControls';
import type { JarControls } from './jarControls';
import { createStudioEnvironment } from './studioEnv';
import { createTable } from './table';
import backdropUrl from '../assets/images/backdrop-portrait.webp?url';
import { createJarPhysics, initPhysics, poseAt } from './physics';
import type { JarPhysics, Snapshot } from './physics';
import { stirNote } from './stir';
import type { Pose } from './stir';
import { clamp01, easeInCubic, easeInOutCubic, easeOut, easePop, lerp, linear, tween } from './tween';

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
// The lid leaves through the top of the frame. The rise clears the view even on the tallest phones, where the
// field of view is widest, and the flight stays shorter than the stir that runs alongside it.
const LID_EXIT_MS = 650;
const LID_EXIT_RISE = 4;
const UNFOLD_MS = 1800;
const DOF_MS = 500;
const DOF_APERTURE = 0.005; // blur per unit of depth away from the note
const DOF_MAX_BLUR = 0.005; // cap, as a fraction of the frame

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
// Radians the jar leans at full input (mouse or gyro) while the back label is up. The jar turns on its own axis, so
// the label slides as it leans: more than this clips the text at the screen edges and pushes the barcode into the button.
const LABEL_TILT_YAW = 0.02;
const LABEL_TILT_PITCH = 0.015;

// Night navy, used when the backdrop image cannot be rasterised.
const FALLBACK_BACKGROUND = 0x10214a;
// Below this aspect the field of view widens so the jar keeps its horizontal framing.
const MIN_FRAMING_ASPECT = 0.8;
const BASE_FOV = 30;
const BACKDROP_ASPECT = 390 / 844;
const BACKDROP_PX: [number, number] = [780, 1688];
const SHIFT_MS = 700;
// The pull-back from the back label to the front of the jar. The spin starts a little after the camera.
const REVEAL_FRONT_MS = 1800;
const REVEAL_SPIN_DELAY = 0.1; // fraction of the reveal
const REVEAL_BLEED_FADE = 0.3; // fraction of the reveal over which the art past the sticker fades out
// Idle invitation: a small wobble every few seconds until the first interaction.
const NUDGE_FIRST_MS = 3200;
const NUDGE_EVERY_MS = 5200;
const NUDGE_STRENGTH = 0.35;
// Camera flights to the boombox and back.
const FOCUS_MS = 1100;
// The credits paper: it rises out of the jar mouth, then unfolds and glides to the front like the note. An opened name note
// takes turns with it: it folds back into the jar first, and returns when the credits go.
const CREDITS_START = new Vector3(0, 1.75, 0.1);
const CREDITS_LID_MS = 240;
const CREDITS_RISE_MS = 450;
const CREDITS_GLIDE_MS = 1400;
const CREDITS_LEAVE_MS = 600;
const CREDITS_DROP_MS = 350;
const LID_TIP = { x: 0.85, y: 0.3, roll: -0.5 }; // pushed aside, clear of the mouth
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
  // Back label (the intro): a sticker on the far side of the jar, framed close up until revealFront.
  private backLabel: BackLabel | null = null;
  private labelToken = 0; // bumped by every build, reset and dispose, so a stale async build is dropped
  private presenting = false;
  private presentYaw = 0; // added to the jar's yaw only; physics never sees it
  private labelTiltActive = false; // the jar leans with the mouse or gyro; physics never sees it
  private labelTilt = { x: 0, y: 0 };
  private atClosePose = false; // the camera is parked on the label, so resize() must refit it
  private closeTarget = new Vector3();
  // Boombox: the sound control. The camera flies to it and taps on it change the music.
  private boombox: Boombox | null = null;
  private disposed = false;
  private soundFocus = false; // the camera is at (or flying to or from) the boombox: no parallax, no jar taps
  private lookNow = CAMERA_LOOK.clone(); // where the camera looks while a flight owns it
  private flightAbort = new AbortController();
  private raycaster = new Raycaster();
  // Credits paper: a second, non-physics note.
  private creditsNote: Note | null = null;
  private creditsOpen = false; // showing or on its way in
  private leanEuler = new Euler();
  private focusPoint = new Vector3();
  private noteSwap = false; // the name note is out of its open pose for the credits: parallax leaves its rotation alone
  private musicLevel: (() => number) | null = null;
  private creditsSettled = false; // at the front pose, so parallax applies
  private creditsAbort = new AbortController();
  private lidTip = 0; // 0 = seated, 1 = pushed aside for the credits paper
  private flying = false;
  private dofBefore = 0;

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
  private shiftWanted = 0; // what the UI last asked for
  private shiftHold: number | null = null;
  // Idle invitation state.
  private interacted = false;
  private nextNudge = 0;
  /** Called when the visitor asks to open the jar (tap or keyboard). The caller owns any double-fire guard. */
  onOpenRequest: (() => void) | null = null;
  /** Where the radio gets the beat (0..1) each frame; this file knows nothing about audio. `null` stops it. */
  setMusicLevel(source: (() => number) | null): void {
    this.musicLevel = source;
  }

  /** Called when the boombox is tapped while the camera is on it. */
  onBoomboxTap: (() => void) | null = null;
  /** Called when a tap lands while the credits paper is up, so the UI can close it. */
  onCreditsDismiss: (() => void) | null = null;
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
        if (this.opened || this.presenting || this.soundFocus || this.creditsOpen) return;
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
      onTap: (x, y) => {
        if (this.creditsOpen) {
          this.onCreditsDismiss?.();
          return;
        }
        if (this.soundFocus) {
          if (this.boombox && this.pickBoombox(x, y)) {
            this.boombox.press(() => !this.frame && this.renderOnce());
            this.onBoomboxTap?.();
          }
          return;
        }
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

  /** Draws the backdrop image into the scene background. Keeps the navy colour if it cannot load. */
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
      texture.wrapS = MirroredRepeatWrapping; // wide screens repeat the image sideways; mirroring hides the seam
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
    const label = createJarLabel();
    this.extras.push(label);
    this.jar.add(...this.slipMeshes, glass, label.mesh, this.lid, this.note.mesh);

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
    const table = await createTable();
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

    // The radio loads in the background: the jar is ready without it. If it fails, the sound button only mutes.
    void createBoombox().then((boombox) => {
      if (this.disposed) {
        boombox.dispose();
        return;
      }
      this.boombox = boombox;
      this.scene.add(boombox.group);
      this.extras.push(boombox);
      if (!this.frame) this.renderOnce();
    }).catch(() => {});
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
    // After the projection is current: the label fit depends on the fov and aspect.
    if (this.atClosePose) this.applyClosePose();
    if (this.soundFocus && !this.flying) this.applyFocusPose();
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
    this.shiftWanted = fraction;
    if (this.shiftHold === null) this.tweenShift(fraction, animate);
  }

  /** Overrides the frame shift (the boombox and the credits take over the framing); `null` gives it back to the caller's value. */
  private holdShift(value: number | null): void {
    this.shiftHold = value;
    this.tweenShift(value ?? this.shiftWanted, true);
  }

  private tweenShift(fraction: number, animate: boolean): void {
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
    this.clearBackLabel();
    this.cancelSoundAndCredits();
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
    this.shiftWanted = 0;
    this.shiftHold = null;
    this.applyFrameShift();
    this.atClosePose = false;
    this.camera.position.copy(CAMERA_POS);
    this.camera.lookAt(CAMERA_LOOK);
    this.lookNow.copy(CAMERA_LOOK);
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

  // Back label ---------------------------------------------------------------------------------

  /** Removes the label and drops any build still in flight. */
  private clearBackLabel(): void {
    this.labelToken++;
    this.backLabel?.dispose();
    this.backLabel = null;
    this.presenting = false;
    this.presentYaw = 0;
    this.labelTiltActive = false;
    this.labelTilt.x = this.labelTilt.y = 0;
    this.atClosePose = false;
  }

  /** Camera pose that fits the whole label (contain): phones fill the screen, wide screens show the facets beside it. */
  private applyClosePose(): void {
    const t = Math.tan((this.camera.fov * Math.PI) / 360);
    const distance = Math.max(BACK_LABEL.height / 2 / t, BACK_LABEL.width / 2 / (t * this.camera.aspect));
    this.camera.position.set(0, BACK_LABEL.centerY, BACK_LABEL.surface + distance);
    this.closeTarget.set(0, BACK_LABEL.centerY, BACK_LABEL.apothem);
    this.camera.lookAt(this.closeTarget);
  }

  private applyJarYaw(): void {
    // Presenting freezes the idle sway at zero, so this is the whole yaw.
    this.jar.rotation.y = this.spin + this.presentYaw + this.labelTilt.x * LABEL_TILT_YAW;
  }

  /**
   * The intro: builds the label for this giver (replacing any previous one), turns the jar so it faces the camera
   * and parks the camera close in front of it. Text blocks start hidden; see `playBackLabelEntry`. Rejects if the
   * fonts or art fail, leaving the plain jar. Call `reset()` first; a later `reset()` cancels a build in flight.
   */
  async showBackLabel(content: BackLabelContent): Promise<void> {
    const token = ++this.labelToken;
    this.backLabel?.dispose();
    this.backLabel = null;
    const label = await createBackLabel(content, { anisotropy: this.renderer.capabilities.getMaxAnisotropy() });
    if (token !== this.labelToken) {
      label.dispose();
      return;
    }
    this.backLabel = label;
    this.jar.add(label.group);
    this.presenting = true;
    this.labelTiltActive = !this.reduced;
    this.controls?.resetTiltBaseline(); // however the phone is held now counts as neutral
    this.sway = 0;
    this.nextNudge = 0;
    this.presentYaw = -BACK_LABEL.facetAngle;
    this.applyJarYaw();
    // Text is the whole point here, so draw it at full resolution until the pull-back.
    this.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.atClosePose = true;
    this.applyClosePose();
    this.resize();
    if (!this.frame) this.renderOnce();
  }

  /** Staggered entry of the label's text. Resolves when it is all in. Under reduced motion it shows at once. */
  async playBackLabelEntry(): Promise<void> {
    const label = this.backLabel;
    if (!label) return;
    if (this.reduced) {
      label.showAll();
      if (!this.frame) this.renderOnce();
      return;
    }
    await label.playEntry(this.abort.signal, () => {
      if (!this.frame) this.renderOnce();
    });
  }

  /** Pulls the camera back to the usual framing while the jar spins its front to the camera. Under reduced motion it jumps. */
  async revealFront(): Promise<void> {
    if (!this.presenting) return;
    const signal = this.abort.signal;
    this.labelTiltActive = false; // eases out during the pull-back
    this.setPixelRatio(this.idlePixelRatio());
    const finish = () => {
      this.presenting = false;
      this.presentYaw = 0;
      this.labelTilt.x = this.labelTilt.y = 0;
      this.atClosePose = false;
      this.backLabel?.setBleed(0);
      this.jar.rotation.x = 0;
      this.applyJarYaw();
      this.camera.position.copy(CAMERA_POS);
      this.camera.lookAt(CAMERA_LOOK);
      if (!this.frame) this.renderOnce();
    };
    if (this.reduced) {
      finish();
      return;
    }
    // From here the tween owns the camera, so a resize no longer refits it.
    this.atClosePose = false;
    const fromPos = this.camera.position.clone();
    const fromLook = this.closeTarget.clone();
    const fromYaw = this.presentYaw;
    const look = new Vector3();
    const done = await tween(REVEAL_FRONT_MS, linear, (p) => {
      const e = easeInOutCubic(p);
      this.camera.position.lerpVectors(fromPos, CAMERA_POS, e);
      this.camera.lookAt(look.lerpVectors(fromLook, CAMERA_LOOK, e));
      this.presentYaw = fromYaw * (1 - easeInOutCubic(clamp01((p - REVEAL_SPIN_DELAY) / (1 - REVEAL_SPIN_DELAY))));
      this.backLabel?.setBleed(1 - clamp01(p / REVEAL_BLEED_FADE));
      this.applyJarYaw();
      if (!this.frame) this.renderOnce();
    }, signal);
    if (done) finish();
  }

  // Boombox and credits ------------------------------------------------------------------------

  /** False until the radio model has loaded, or if it failed to. */
  get hasBoombox(): boolean {
    return this.boombox !== null;
  }

  private redraw = (): void => {
    if (!this.frame) this.renderOnce();
  };

  private pickBoombox(clientX: number, clientY: number): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height || !this.boombox) return false;
    this.camera.updateMatrixWorld();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.boombox.hit(this.raycaster);
  }

  private applyFocusPose(): void {
    if (!this.boombox) return;
    const pose = this.boombox.focusPose(this.camera.fov, this.camera.aspect);
    this.camera.position.copy(pose.position);
    this.lookNow.copy(pose.target);
    this.camera.lookAt(this.lookNow);
  }

  /** Camera flight from wherever it is. `to` is read every frame, so a resize mid-flight lands on the right pose. */
  private async fly(to: () => { position: Vector3; target: Vector3 }): Promise<boolean> {
    this.flightAbort.abort();
    this.flightAbort = new AbortController();
    const signal = this.flightAbort.signal;
    const fromPos = this.camera.position.clone();
    const fromLook = this.lookNow.clone();
    const look = new Vector3();
    const apply = (e: number) => {
      const goal = to();
      this.camera.position.lerpVectors(fromPos, goal.position, e);
      this.camera.lookAt(this.lookNow.copy(look.lerpVectors(fromLook, goal.target, e)));
      this.redraw();
    };
    if (this.reduced) {
      apply(1);
      return true;
    }
    this.flying = true;
    const done = await tween(FOCUS_MS, easeInOutCubic, apply, signal);
    if (done) this.flying = false;
    return done;
  }

  private fadeAperture(to: number): void {
    const from = this.bokehUniforms.aperture.value;
    if (this.reduced) return this.setAperture(to);
    void tween(DOF_MS, easeOut, (v) => this.setAperture(lerp(from, to, v)), this.flightAbort.signal);
  }

  /** Flies the camera to the boombox. Resolves when it is there. Under reduced motion it jumps. */
  async focusBoombox(): Promise<void> {
    const boombox = this.boombox;
    if (!boombox || this.presenting || this.creditsOpen || this.soundFocus) return;
    this.soundFocus = true;
    this.cancelShake();
    this.dragging = false;
    this.spinVelocity = 0;
    this.holdShift(0);
    this.dofBefore = this.bokehUniforms.aperture.value; // an opened note has the jar blurred; the radio should be sharp
    const flight = this.fly(() => boombox.focusPose(this.camera.fov, this.camera.aspect));
    this.fadeAperture(0);
    await flight;
  }

  /** Flies back to the usual framing (and the current frame shift). Resolves when it is there. */
  async focusJar(): Promise<void> {
    if (!this.soundFocus) return;
    this.holdShift(null);
    const flight = this.fly(() => ({ position: this.homePosition(), target: CAMERA_LOOK }));
    this.fadeAperture(this.dofBefore);
    if (await flight) this.soundFocus = false;
  }

  /** Where the camera rests: the home pose, plus the parallax drift once the note is open. */
  private homePosition(): Vector3 {
    if (!this.parallax) return CAMERA_POS;
    return new Vector3(CAMERA_POS.x + this.tilt.x * PARALLAX_CAMERA[0], CAMERA_POS.y - this.tilt.y * PARALLAX_CAMERA[1], CAMERA_POS.z);
  }

  private tipLid(amount: number, signal: AbortSignal): Promise<boolean> {
    const from = this.lidTip;
    return tween(CREDITS_LID_MS, easeInOutCubic, (v) => {
      const t = lerp(from, amount, v);
      this.lidTip = t;
      this.lid.position.set(LID_TIP.x * t, LID_SEAT_Y + LID_TIP.y * t, 0);
      this.lid.rotation.z = LID_TIP.roll * t;
      this.redraw();
    }, signal);
  }

  /** The note's rotation at its open pose: the parallax lean, or flat when parallax is off. */
  private restRotation(out: Euler): Euler {
    return this.parallax ? out.set(this.tilt.y * PARALLAX_NOTE[1], this.tilt.x * PARALLAX_NOTE[0], 0) : out.set(0, 0, 0);
  }

  /** Puts the name note back at its open pose, visible. */
  private restoreNameNote(): void {
    const nm = this.note.mesh;
    this.note.setCrumple(0);
    nm.position.copy(NOTE_FINAL);
    nm.scale.setScalar(this.noteFinalScale);
    this.restRotation(nm.rotation);
    nm.visible = true;
    this.noteSwap = false;
  }

  /**
   * A paper rises out of the jar mouth (the lid is pushed aside first if `lidOn`), then unfolds and glides to `final`.
   * Works in the paper's own parent space, which is the same as the world once the jar has settled. False if aborted.
   */
  private async paperOut(note: Note, final: Vector3, signal: AbortSignal, lidOn: boolean): Promise<boolean> {
    const mesh = note.mesh;
    const finalScale = this.noteFinalScale;
    const rest = new Euler();
    note.setCrumple(1);
    mesh.position.copy(CREDITS_START);
    mesh.scale.setScalar(1);
    mesh.rotation.copy(NOTE_PICK_EULER);
    if (lidOn && !(await this.tipLid(1, signal))) return false;
    mesh.visible = true;
    // 1. Rise out of the mouth.
    if (!(await tween(CREDITS_RISE_MS, easeOut, (v) => {
      mesh.position.lerpVectors(CREDITS_START, NOTE_TOP, v);
      this.redraw();
    }, signal))) return false;
    // 2. Unfold and come to the camera, like the note does. The lid settles back meanwhile.
    const lidBack = lidOn ? this.tipLid(0, signal) : Promise.resolve(true);
    const glided = await tween(CREDITS_GLIDE_MS, linear, (p) => {
      note.setCrumple(1 - easeInOutCubic(p));
      const v = easePop(Math.min(p / 0.45, 1));
      this.restRotation(rest);
      mesh.position.lerpVectors(NOTE_TOP, final, v);
      mesh.scale.setScalar(lerp(1, finalScale, v));
      mesh.rotation.set(lerp(0.4, rest.x, v), lerp(-0.8, rest.y, v), lerp(0.3, rest.z, v));
      this.redraw();
    }, signal);
    return glided && (await lidBack);
  }

  /** A paper folds up, lifts to the mouth and drops into the jar, hidden. False if aborted. */
  private async paperIn(note: Note, signal: AbortSignal, lidOn: boolean): Promise<boolean> {
    const mesh = note.mesh;
    const fromPos = mesh.position.clone();
    const fromScale = mesh.scale.x;
    const fromRot = mesh.rotation.clone();
    // 1. Fold up and lift to the mouth: the glide, backwards.
    if (!(await tween(CREDITS_LEAVE_MS, easeInOutCubic, (v) => {
      note.setCrumple(v);
      mesh.position.lerpVectors(fromPos, NOTE_TOP, v);
      mesh.scale.setScalar(lerp(fromScale, 1, v));
      mesh.rotation.set(lerp(fromRot.x, 0.4, v), lerp(fromRot.y, -0.8, v), lerp(fromRot.z, 0.3, v));
      this.redraw();
    }, signal))) return false;
    if (lidOn && !(await this.tipLid(1, signal))) return false;
    // 2. Drop in.
    if (!(await tween(CREDITS_DROP_MS, easeInCubic, (v) => {
      mesh.position.lerpVectors(NOTE_TOP, CREDITS_START, v);
      this.redraw();
    }, signal))) return false;
    mesh.visible = false;
    if (lidOn) await this.tipLid(0, signal);
    this.redraw();
    return true;
  }

  /**
   * Shows the credits as a paper: it rises out of the jar mouth (the lid is pushed aside first if it is on), then
   * unfolds and glides to the front pose of the note. If the name note is already out, it folds back into the jar
   * first and the credits take its place. `clearance` is the fraction of the viewport the DOM caption covers from the
   * bottom; the picture moves up to clear it. Under reduced motion it jumps.
   */
  async showCredits(content: { title: string; lines: string[] }, clearance: number): Promise<void> {
    if (this.creditsOpen || this.presenting || this.soundFocus) return;
    this.creditsOpen = true;
    this.creditsSettled = false;
    this.creditsAbort.abort();
    this.creditsAbort = new AbortController();
    const signal = this.creditsAbort.signal;
    this.cancelShake();
    this.dragging = false;
    this.spinVelocity = 0;

    if (!this.creditsNote) {
      this.creditsNote = createNote();
      this.creditsNote.setLines(content.title, content.lines);
      this.creditsNote.mesh.visible = false;
      this.scene.add(this.creditsNote.mesh);
      this.extras.push(this.creditsNote);
    }
    const note = this.creditsNote;
    const mesh = note.mesh;
    this.holdShift(this.noteClearanceShift(clearance));

    if (this.opened) this.noteSwap = true;
    if (this.reduced) {
      note.setCrumple(0);
      mesh.position.copy(NOTE_FINAL);
      mesh.scale.setScalar(this.noteFinalScale);
      mesh.rotation.set(0, 0, 0);
      mesh.visible = true;
      if (this.opened) this.note.mesh.visible = false;
      this.creditsSettled = true;
      this.redraw();
      return;
    }

    if (this.opened && !(await this.paperIn(this.note, signal, false))) return;
    const lidOn = !this.opened && this.lid.visible;
    if (!(await this.paperOut(note, NOTE_FINAL, signal, lidOn))) return;
    this.creditsSettled = true;
  }

  /**
   * Folds the credits paper and drops it back into the jar; an opened name note then rises out again to its open pose.
   * Resolves when both are done. Under reduced motion they just switch.
   */
  async hideCredits(): Promise<void> {
    if (!this.creditsOpen) return;
    this.creditsOpen = false;
    this.creditsSettled = false;
    this.creditsAbort.abort();
    this.creditsAbort = new AbortController();
    const signal = this.creditsAbort.signal;
    this.holdShift(null);
    const note = this.creditsNote;
    if (!note) return;
    const mesh = note.mesh;
    const hide = () => {
      mesh.visible = false;
      this.lidTip = 0;
      this.lid.position.set(0, LID_SEAT_Y, 0);
      this.lid.rotation.z = 0;
      if (this.opened) this.restoreNameNote();
      this.redraw();
    };
    if (this.reduced) return hide();
    const lidOn = !this.opened && this.lid.visible;
    if (mesh.visible && !(await this.paperIn(note, signal, lidOn))) return;
    if (!this.opened) return;
    if (!(await this.paperOut(this.note, NOTE_FINAL, signal, false))) return;
    this.noteSwap = false;
    this.redraw();
  }

  /** Drops any boombox flight and credits paper in flight, for reset. The lid is re-seated by the caller. */
  private cancelSoundAndCredits(): void {
    this.flightAbort.abort();
    this.flying = false;
    this.soundFocus = false;
    this.creditsAbort.abort();
    this.creditsOpen = false;
    this.creditsSettled = false;
    this.lidTip = 0;
    if (this.creditsNote) this.creditsNote.mesh.visible = false;
    // The name note may be mid-swap: put it back at its open pose (reset then rests it for the next name).
    this.noteSwap = false;
    this.note.mesh.visible = true;
    if (this.opened) this.restoreNameNote();
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
    const lidFly = tween(LID_EXIT_MS, easeInCubic, (v) => {
      lid.position.set(0.8 * v, LID_SEAT_Y + 0.05 + LID_EXIT_RISE * v, 0);
      lid.rotation.z = -0.7 * v;
    }, signal).then((done) => {
      if (done) lid.visible = false;
    });
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
    if (this.opened || this.presenting || this.soundFocus || this.creditsOpen || this.shaking || this.reduced || !this.physics) return;
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
    if (!this.interacted && !this.opened && !this.presenting && !this.reduced && this.physics) {
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
    const idle = !(this.reduced || this.opened || this.presenting || this.dragging || this.shaking || this.spinVelocity);
    this.sway += ((idle ? 1 : 0) - this.sway) * (1 - 0.95 ** frames);
    const labelEase = 1 - 0.92 ** frames;
    this.labelTilt.x += ((this.labelTiltActive ? this.tiltTarget.x : 0) - this.labelTilt.x) * labelEase;
    this.labelTilt.y += ((this.labelTiltActive ? this.tiltTarget.y : 0) - this.labelTilt.y) * labelEase;
    this.jar.rotation.y = this.spin + this.presentYaw + this.labelTilt.x * LABEL_TILT_YAW + this.sway * Math.sin(t * 0.6) * 0.3;
    this.jar.rotation.x = this.labelTilt.y * LABEL_TILT_PITCH;
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

    this.boombox?.update(dt, this.reduced ? 0 : (this.musicLevel?.() ?? 0), this.soundFocus && !this.reduced);
    this.updateParallax(frames);
    this.composer.render();
  };

  private updateParallax(frames: number): void {
    const k = this.parallax ? 1 : 0;
    const ease = 1 - 0.92 ** frames;
    this.tilt.x += (this.tiltTarget.x * k - this.tilt.x) * ease;
    this.tilt.y += (this.tiltTarget.y * k - this.tilt.y) * ease;
    if (!this.parallax || this.soundFocus) return;
    const { x, y } = this.tilt;
    this.camera.position.set(CAMERA_POS.x + x * PARALLAX_CAMERA[0], CAMERA_POS.y - y * PARALLAX_CAMERA[1], CAMERA_POS.z);
    this.camera.lookAt(CAMERA_LOOK);
    const nm = this.note.mesh;
    const lean = this.restRotation(this.leanEuler);
    if (!this.noteSwap) nm.rotation.copy(lean);
    if (this.creditsSettled && this.creditsNote) this.creditsNote.mesh.rotation.copy(lean);
    // Keep the note in focus as the camera moves. The focus point is the open pose, whichever paper is there.
    this.jar.updateWorldMatrix(true, false);
    const focusAt = this.jar.localToWorld(this.focusPoint.copy(NOTE_FINAL));
    this.bokehUniforms.focus.value = focusAt.sub(this.camera.position).dot(this.camera.getWorldDirection(new Vector3()));
  }

  private renderOnce(): void {
    this.composer?.render();
  }

  dispose(): void {
    this.disposed = true;
    this.flightAbort.abort();
    this.creditsAbort.abort();
    this.abort.abort();
    this.shakeAbort.abort();
    this.shiftAbort.abort();
    this.controlsAbort.abort();
    this.clearBackLabel();
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
