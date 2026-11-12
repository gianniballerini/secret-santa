import { effectsContext, music } from './music';

/** Short effects in `public/sounds/`: Ogg Vorbis where it decodes, AAC otherwise (Safari). */
const EFFECTS = {
  click1: 'click-1',
  click2: 'click-2',
  paper1: 'open-paper-1',
  paper2: 'open-paper-2',
} as const;

export type Effect = keyof typeof EFFECTS;

const PAPERS: readonly Effect[] = ['paper1', 'paper2'];
const LEVEL = 0.6;

const buffers = new Map<Effect, Promise<AudioBuffer | null>>();
let extension: string | null = null;

function fileExtension(): string {
  if (extension) return extension;
  const probe = new Audio().canPlayType('audio/ogg; codecs="vorbis"');
  extension = probe === 'probably' || probe === 'maybe' ? 'ogg' : 'm4a';
  return extension;
}

function load(context: AudioContext, effect: Effect): Promise<AudioBuffer | null> {
  let buffer = buffers.get(effect);
  if (!buffer) {
    buffer = fetch(`sounds/${EFFECTS[effect]}.${fileExtension()}`)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(response.statusText))))
      .then((data) => context.decodeAudioData(data))
      .catch(() => null);
    buffers.set(effect, buffer);
  }
  return buffer;
}

/** Plays an effect if sound is on; silent before the first gesture and while muted. The first play of each also loads it. */
export function playEffect(effect: Effect): void {
  const context = effectsContext();
  if (!context) return;
  void load(context, effect).then((buffer) => {
    if (!buffer || effectsContext() !== context) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = LEVEL;
    source.buffer = buffer;
    source.connect(gain).connect(context.destination);
    source.start();
  });
}

/** One of the paper sounds, at random: the name note and the credits paper both use it when they unfold. */
export function playPaper(): void {
  playEffect(PAPERS[Math.floor(Math.random() * PAPERS.length)]);
}

/** Loads every effect once the context exists, so the first click is not silent while it downloads. */
function preloadEffects(): void {
  const context = effectsContext();
  if (context) (Object.keys(EFFECTS) as Effect[]).forEach((effect) => void load(context, effect));
}

// Every clickable makes a sound; the jar itself is left out (opening it plays the paper instead).
const CLICKABLE = 'button, a[href], [role="button"]:not(#stage)';
// Main actions take the first click, everything else (icons, close, secondary, links) the second.
const PRIMARY = '.btn--primary, .btn--gold, [type="submit"]';

/** The click sound of an element: its `data-sfx` if set (`click1` or `click2`), else by its role. */
function clickFor(element: Element): Effect {
  const chosen = (element as HTMLElement).dataset.sfx;
  if (chosen === 'click1' || chosen === 'click2') return chosen;
  return element.matches(PRIMARY) ? 'click1' : 'click2';
}

/** Plays a click on every real tap of a clickable, and loads the effects as soon as sound is available. */
export function initEffects(): void {
  music.onChange(preloadEffects);
  document.addEventListener(
    'click',
    (e) => {
      if (!e.isTrusted || !(e.target instanceof Element)) return;
      const clickable = e.target.closest(CLICKABLE);
      if (clickable) playEffect(clickFor(clickable));
    },
    true,
  );
}
