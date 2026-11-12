import type { TokenPayload } from '../domain/token';
import type { BackLabelContent } from '../three/jarBackLabel';
import type { JarScene } from '../three/JarScene';
import { music } from '../audio/music';
import { playPaper } from '../audio/sfx';
import { avatarUrl } from './avatar';
import { byId, el } from './dom';
import { dismissCredits, isSoundBusy, setSceneProvider } from './soundUi';
import { themeContent } from './themeContent';

// The 3D jar is lazy-loaded so the organizer view never pays for three.js.
let jarPromise: Promise<JarScene | null> | null = null;
let jar: JarScene | null = null;
// Bumped on every showReveal so late async work from an older link is ignored.
let session = 0;
// Aborted when the next link is shown: removes the previous link's listeners.
let lifetime: AbortController | null = null;
// The open request of the latest link. The jar scene is shared, so it calls through this.
let requestOpen: (() => void) | null = null;

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const STAGE_LABEL = 'Frasco con papelitos. Tocá para sacar el tuyo.';
const FALLBACK_OPEN_MS = 900;
const HINT_DELAY_MS = 3000; // untouched time before the "Sacar papelito" prompt appears
const INTRO_LEAVE_MS = 650; // matches the .intro transition
const INTRO_BUTTON_MS = 1750; // when the back label's entry is far enough along for the button to slide up
const PAPER_MARGIN = 20; // px kept between the fallback note and the card

function loadJar(container: HTMLElement): Promise<JarScene | null> {
  jarPromise ??= import('../three/JarScene')
    .then(async ({ JarScene }) => {
      const scene = new JarScene();
      scene.mount(container);
      try {
        await scene.ready; // the settled pile and the backdrop
      } catch (error) {
        scene.dispose();
        throw error;
      }
      scene.onOpenRequest = () => requestOpen?.();
      scene.onBoomboxTap = () => music.cycle();
      scene.setMusicLevel(() => music.level());
      scene.onCreditsDismiss = dismissCredits;
      scene.onPaperOpen = playPaper;
      return scene;
    })
    .catch(() => null); // No WebGL or the chunk failed: use the CSS paper note.
  return jarPromise;
}


/** The copy for the jar's back label. The giver's name is the only thing that varies. */
function backLabelContent(giver: string): BackLabelContent {
  const copy = themeContent.intro;
  return {
    kicker: copy.kicker,
    hello: `${copy.hello},`,
    name: giver,
    greeting: copy.greeting,
    rows: copy.rows,
    warningTitle: copy.warningTitle,
    warning: `${copy.warningLead} ${giver}${copy.warning}`,
    footer: copy.footer,
  };
}

function renderSheet(): void {
  byId('sheet-title').textContent = themeContent.title;
  byId('sheet-list').replaceChildren(
    ...themeContent.items.map((text) => el('li', { class: 'sheet__item' }, el('span', { class: 'sheet__text' }, text))),
  );
}

export function showReveal(payload: TokenPayload): void {
  const current = ++session;
  lifetime?.abort();
  const life = (lifetime = new AbortController());

  const stage = byId('stage');
  const canvasHost = byId('stage-canvas');
  const live = byId('reveal-live');
  const paper = document.querySelector<HTMLElement>('.paper')!;
  const paperName = byId('paper-name');
  const sheet = byId('sheet');
  const intro = byId('intro');
  const introButton = byId('intro-btn');
  const introBody = intro.querySelector<HTMLElement>('.intro__body')!;

  type Phase = 'loading' | 'ready' | 'opening' | 'done';
  let phase: Phase = 'loading';
  let mode: 'webgl' | 'fallback' = 'webgl';

  const setInteractive = (on: boolean) => {
    if (on) {
      stage.setAttribute('role', 'button');
      stage.setAttribute('tabindex', '0');
      stage.setAttribute('aria-label', STAGE_LABEL);
    } else {
      stage.removeAttribute('role');
      stage.removeAttribute('tabindex');
      stage.removeAttribute('aria-label');
    }
  };

  // Reset so navigating between links starts closed, with no recipient anywhere in the DOM.
  renderSheet();
  live.textContent = '';
  paperName.textContent = '';
  paper.hidden = true;
  paper.classList.remove('is-open');
  paper.style.removeProperty('--lift');
  sheet.hidden = true;
  sheet.classList.remove('is-visible');
  stage.className = 'stage';
  stage.setAttribute('aria-busy', 'true');
  setInteractive(true);
  const photo = avatarUrl(payload.a);
  jar?.reset(payload.r, photo);

  // Every link starts on the intro, with the jar out of reach until it leaves.
  // The DOM copy always exists: it is what screen readers get, and what shows without WebGL.
  const copy = themeContent.intro;
  // The spaces only matter to screen readers: each piece is laid out on its own line.
  byId('intro-greeting').replaceChildren(
    el('span', { class: 'intro__hello' }, `${copy.hello} `),
    el('span', { class: 'intro__paper intro__name' }, payload.g),
    el('span', { class: 'intro__rest' }, ` ${copy.greeting}`),
  );
  byId('intro-warning').replaceChildren(el('strong', {}, `${copy.warningLead} ${payload.g}`), copy.warning);
  introButton.textContent = copy.button;
  intro.hidden = false;
  intro.className = 'intro is-pending'; // art and a loader until we know whether the 3D label can be shown
  introBody.classList.remove('sr-only');
  stage.inert = true;
  // 'pending' until the jar loads, then 'label' (3D, over the jar) or 'slip' (DOM).
  let introMode: 'pending' | 'label' | 'slip' = 'pending';

  const showSlip = () => {
    introMode = 'slip';
    intro.classList.replace('is-pending', 'is-slip');
  };

  // The "Sacar papelito" prompt waits until the visible jar has gone untouched for a moment.
  let hintArmed = false;
  let hintTimer = 0;
  const scheduleHint = () => {
    window.clearTimeout(hintTimer);
    if (!hintArmed) return;
    hintTimer = window.setTimeout(() => stage.classList.add('show-hint'), HINT_DELAY_MS);
  };
  const armHint = () => {
    hintArmed = true;
    scheduleHint();
  };
  life.signal.addEventListener('abort', () => window.clearTimeout(hintTimer));
  stage.addEventListener('pointerdown', () => window.clearTimeout(hintTimer), { signal: life.signal });
  window.addEventListener('pointerup', scheduleHint, { signal: life.signal });
  window.addEventListener('pointercancel', scheduleHint, { signal: life.signal });

  // Back label only: the camera pulls back while the jar spins to its front; then the jar is ready to open.
  const leaveLabel = async (scene: JarScene) => {
    intro.classList.remove('is-armed');
    await scene.revealFront();
    if (current !== session) return;
    intro.hidden = true;
    stage.inert = false;
    phase = 'ready';
    stage.classList.add('is-ready'); // the ring only now, never over the label
    stage.removeAttribute('aria-busy');
    stage.focus({ preventScroll: true });
    armHint();
  };

  introButton.addEventListener(
    'click',
    () => {
      if (introMode === 'label' && jar) {
        void leaveLabel(jar);
        return;
      }
      intro.classList.add('is-leaving');
      stage.inert = false;
      void wait(reduced() ? 0 : INTRO_LEAVE_MS).then(() => {
        if (current !== session) return;
        intro.hidden = true;
        stage.focus({ preventScroll: true });
        armHint();
      });
    },
    { signal: life.signal, once: true },
  );

  // Frame the opened note above the sheet. Measured, so it holds on any screen and when the sheet scrolls.
  const makeRoom = (animate: boolean) => {
    const viewport = stage.clientHeight || window.innerHeight;
    const gap = parseFloat(getComputedStyle(sheet).bottom) || 0;
    const occupied = sheet.offsetHeight + gap;
    if (mode === 'webgl' && jar) {
      jar.setFrameShift(jar.noteClearanceShift(occupied / viewport), animate);
      return;
    }
    const bottom = viewport / 2 + paper.offsetHeight / 2;
    const roomAbove = viewport / 2 - paper.offsetHeight / 2 - PAPER_MARGIN;
    const lift = Math.min(Math.max(0, bottom + PAPER_MARGIN - (viewport - occupied)), Math.max(0, roomAbove));
    paper.style.setProperty('--lift', `${lift}px`);
  };

  const finish = () => {
    phase = 'done';
    stage.classList.add('is-done');
    setInteractive(false);
    stage.removeAttribute('aria-busy');
    live.textContent = `Tu amigo invisible es ${payload.r}.`;
    sheet.hidden = false;
    sheet.scrollTop = 0;
    // One frame with the sheet laid out (but still below the screen), so the transition runs.
    requestAnimationFrame(() => {
      if (current !== session) return;
      sheet.classList.add('is-visible');
      makeRoom(true);
      sheet.focus({ preventScroll: true });
    });
    window.addEventListener('resize', () => makeRoom(false), { signal: life.signal });
  };

  const open = async () => {
    stage.classList.add('is-opening');
    if (mode === 'webgl' && jar) {
      jar.requestMotion(); // still inside the gesture, so iOS can show its prompt for tilt parallax
      await jar.open();
    } else {
      paperName.textContent = payload.r;
      paper.classList.add('is-open');
      playPaper();
      await wait(reduced() ? 0 : FALLBACK_OPEN_MS);
    }
    if (current !== session) return;
    finish();
  };

  // The sound and credits controls may take the jar over once it is on screen and untouched by the intro.
  setSceneProvider(() =>
    current === session && mode === 'webgl' && jar && intro.hidden && (phase === 'ready' || phase === 'done') ? jar : null,
  );

  // One entry for tap, Enter and Space. A second request while opening is ignored, and so is one while the radio or credits are up.
  const request = () => {
    if (phase !== 'ready' || isSoundBusy()) return;
    phase = 'opening';
    void open();
  };
  requestOpen = request;

  stage.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (!e.repeat) request();
    },
    { signal: life.signal },
  );
  // Without WebGL the stage itself takes the tap; with it the jar controls do.
  stage.addEventListener('click', () => mode === 'fallback' && request(), { signal: life.signal });

  const markReady = () => {
    phase = 'ready';
    stage.classList.add('is-ready');
    stage.removeAttribute('aria-busy');
  };

  void loadJar(canvasHost).then(async (scene) => {
    if (scene) jar = scene;
    // Only the latest link may touch the scene, so a stale load can't show the wrong name.
    if (current !== session) return;
    if (!scene) {
      mode = 'fallback';
      stage.classList.add('is-fallback');
      paper.hidden = false;
      showSlip();
      markReady();
      return;
    }
    mode = 'webgl';
    scene.reset(payload.r, photo);
    try {
      await scene.showBackLabel(backLabelContent(payload.g));
    } catch {
      // The label could not be built: the plain jar with the DOM slip on top still works.
      if (current !== session) return;
      showSlip();
      markReady();
      return;
    }
    if (current !== session) return;

    introMode = 'label';
    stage.classList.add('has-label');
    introBody.classList.add('sr-only'); // the label already shows this text
    intro.classList.replace('is-pending', 'is-label');
    const entry = scene.playBackLabelEntry();
    await wait(reduced() ? 0 : INTRO_BUTTON_MS);
    if (current !== session) return;
    intro.classList.add('is-armed');
    await entry;
  });
}
