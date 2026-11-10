import { music } from '../audio/music';
import { TRACKS } from '../audio/tracks';
import type { JarScene } from '../three/JarScene';
import { byId, el } from './dom';
import { themeContent } from './themeContent';

// The top-right sound and credits buttons, the radio's pill and the credits paper.
// With the 3D scene (reveal, ready or done) the sound button flies the camera to the boombox and the credits are
// a paper out of the jar; everywhere else the sound button mutes and the credits open in a dialog.

type Mode = 'idle' | 'boombox' | 'credits-3d' | 'credits-dialog';

let sceneProvider: () => JarScene | null = () => null;
let mode: Mode = 'idle';
let busy = false; // a camera flight or paper animation is running

/** The reveal registers how to reach the jar. It returns null unless the 3D jar is on screen and can take taps. */
export function setSceneProvider(provider: () => JarScene | null): void {
  sceneProvider = provider;
}

/** True while the radio or the credits own the screen, so the jar must not open. */
export function isSoundBusy(): boolean {
  return mode !== 'idle' || busy;
}

let dismiss: () => void = () => {};

/** A tap on the canvas while the credits paper is up. */
export function dismissCredits(): void {
  dismiss();
}

export function initSoundUi(): void {
  const soundButton = byId<HTMLButtonElement>('sound');
  const creditsButton = byId<HTMLButtonElement>('credits');
  const pill = byId<HTMLButtonElement>('sound-pill');
  const pillTrack = byId('sound-pill-track');
  const muteButton = byId<HTMLButtonElement>('sound-mute');
  const caption = byId('credits-caption');
  const dialog = byId<HTMLDialogElement>('credits-dialog');
  const live = byId('reveal-live');
  const { sound, credits } = themeContent;

  byId('sound-pill-lead').textContent = sound.tapRadio;
  creditsButton.setAttribute('aria-label', credits.button);
  byId('credits-dialog-title').textContent = credits.title;
  byId('credits-dialog-items').replaceChildren(
    ...credits.items.map((item) => el('li', {}, el('strong', {}, `${item.label}: `), item.text)),
  );
  for (const list of [byId('credits-caption-links'), byId('credits-dialog-links')]) {
    list.replaceChildren(
      ...credits.links.map((link) =>
        el('li', {}, el('a', { href: link.href, target: '_blank', rel: 'noopener noreferrer' }, link.text)),
      ),
    );
  }
  for (const id of ['credits-caption-close', 'credits-dialog-close']) byId(id).textContent = credits.close;

  const soundText = () => (music.muted ? sound.silence : (TRACKS[music.track]?.label ?? sound.silence));

  const sync = () => {
    const atRadio = mode === 'boombox';
    if (atRadio) {
      soundButton.removeAttribute('aria-pressed');
      soundButton.setAttribute('aria-label', sound.back);
      document.body.dataset.soundFocus = '';
    } else {
      soundButton.setAttribute('aria-pressed', String(music.state !== null));
      soundButton.setAttribute('aria-label', sound.label);
      delete document.body.dataset.soundFocus;
    }
    const creditsOpen = mode === 'credits-3d' || mode === 'credits-dialog';
    creditsButton.setAttribute('aria-expanded', String(creditsOpen));
    if (mode === 'credits-3d') document.body.dataset.credits = '';
    else delete document.body.dataset.credits;
    muteButton.setAttribute('aria-pressed', String(music.muted));
    muteButton.setAttribute('aria-label', music.muted ? sound.unmute : sound.mute);
    pillTrack.textContent = music.loading ? sound.loading : soundText();
    pill.setAttribute('aria-busy', String(music.loading));
    soundButton.toggleAttribute('data-loading', music.loading);
  };

  const reset = () => {
    mode = 'idle';
    busy = false;
    caption.hidden = true;
    if (dialog.open) dialog.close();
    sync();
  };

  // Sound button ---------------------------------------------------------------------------------
  const backFromRadio = async () => {
    const jar = sceneProvider();
    busy = true;
    await jar?.focusJar();
    mode = 'idle';
    busy = false;
    sync();
  };

  soundButton.addEventListener('click', () => {
    if (busy) return;
    if (mode === 'boombox') {
      void backFromRadio();
      return;
    }
    const jar = sceneProvider();
    if (!jar?.hasBoombox || mode === 'credits-dialog') {
      music.toggleMute();
      return;
    }
    void (async () => {
      music.unlock();
      busy = true;
      if (mode === 'credits-3d') await closeCredits(true);
      mode = 'boombox';
      sync();
      await jar.focusBoombox();
      busy = false;
    })();
  });

  const cycle = () => music.cycle();
  pill.addEventListener('click', cycle);
  muteButton.addEventListener('click', () => music.toggleMute());

  music.onChange(() => {
    sync();
    if (mode === 'boombox' && !music.loading) {
      live.textContent = music.state === null ? sound.announceOff : `${sound.announceOn}: ${soundText()}`;
    }
  });

  // Credits --------------------------------------------------------------------------------------
  async function closeCredits(keepBusy = false): Promise<void> {
    if (mode === 'credits-dialog') {
      dialog.close();
      return;
    }
    if (mode !== 'credits-3d' || (busy && !keepBusy)) return;
    busy = true;
    const jar = sceneProvider();
    caption.hidden = true;
    mode = 'idle';
    sync();
    await jar?.hideCredits();
    if (!keepBusy) busy = false;
  }

  const openCredits = async () => {
    const jar = sceneProvider();
    if (!jar) {
      mode = 'credits-dialog';
      sync();
      dialog.showModal();
      return;
    }
    busy = true;
    if (mode === 'boombox') {
      await jar.focusJar();
    }
    mode = 'credits-3d';
    caption.hidden = false;
    sync();
    // Measured: the picture moves up just enough for the paper to clear the caption.
    const viewport = window.innerHeight;
    const gap = parseFloat(getComputedStyle(caption).bottom) || 0;
    const body = credits.items.map((item) => `${item.label}: ${item.text}`);
    await jar.showCredits({ title: credits.title, lines: body }, (caption.offsetHeight + gap) / viewport);
    busy = false;
  };

  creditsButton.addEventListener('click', () => {
    if (busy) return;
    if (mode === 'credits-3d' || mode === 'credits-dialog') void closeCredits();
    else void openCredits();
  });

  for (const id of ['credits-caption-close', 'credits-dialog-close']) {
    byId(id).addEventListener('click', () => void closeCredits());
  }
  dialog.addEventListener('close', () => {
    if (mode === 'credits-dialog') {
      mode = 'idle';
      sync();
    }
  });
  // A click on the backdrop (the dialog element itself, outside the paper) closes it.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || busy) return;
    if (mode === 'credits-3d') void closeCredits();
    else if (mode === 'boombox') void backFromRadio();
  });

  window.addEventListener('hashchange', reset);
  dismiss = () => void closeCredits();
  sync();
}
