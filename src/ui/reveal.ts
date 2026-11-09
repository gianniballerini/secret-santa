import type { TokenPayload } from '../domain/token';
import type { JarScene } from '../three/JarScene';
import { byId, el } from './dom';
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
const PAPER_MARGIN = 20; // px kept between the fallback note and the card

function loadJar(container: HTMLElement): Promise<JarScene | null> {
  jarPromise ??= import('../three/JarScene')
    .then(async ({ JarScene }) => {
      const scene = new JarScene();
      scene.mount(container);
      try {
        await scene.ready; // physics WASM, the settled pile and the backdrop
      } catch (error) {
        scene.dispose();
        throw error;
      }
      scene.onOpenRequest = () => requestOpen?.();
      return scene;
    })
    .catch(() => null); // No WebGL or the chunk failed: use the CSS paper note.
  return jarPromise;
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
  jar?.reset(payload.r);

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
      await wait(reduced() ? 0 : FALLBACK_OPEN_MS);
    }
    if (current !== session) return;
    finish();
  };

  // One entry for tap, Enter and Space. A second request while opening is ignored.
  const request = () => {
    if (phase !== 'ready') return;
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

  void loadJar(canvasHost).then((scene) => {
    if (scene) jar = scene;
    // Only the latest link may touch the scene, so a stale load can't show the wrong name.
    if (current !== session) return;
    if (scene) {
      mode = 'webgl';
      scene.reset(payload.r);
    } else {
      mode = 'fallback';
      stage.classList.add('is-fallback');
      paper.hidden = false;
    }
    phase = 'ready';
    stage.classList.add('is-ready');
    stage.removeAttribute('aria-busy');
  });
}
