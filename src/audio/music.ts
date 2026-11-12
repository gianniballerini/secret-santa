import { TRACKS, nextTrack, pickSource } from './tracks';
import type { SoundState } from './tracks';

const STORAGE_KEY = 'secret-santa:sound';
const LEVEL = 0.35; // background level; the gain node sets it because iOS ignores media element volume
const FADE_S = 0.6;
const SWITCH_FADE_S = 0.25;
const FFT_SIZE = 512; // ~86 Hz per bin at 44.1 kHz, enough to isolate the kick
const BASS_HZ: [number, number] = [40, 160];
const FALLBACK_BPM = 100; // the radio's pulse when there is no analyser

const saved = readSaved();
let track = saved.track; // the selected track; kept while muted so unmuting resumes it
// A saved mute only lasts for its visit: every load starts on, so the first gesture plays music.
let muted = TRACKS.length === 0;
let started = false; // a first gesture has created the audio graph
let context: AudioContext | null = null;
let gain: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let bins: Uint8Array<ArrayBuffer> | null = null;
let bassLo = 1;
let bassHi = 2;
let envelope = 0; // fast-attack, slow-release bass energy
let average = 0; // slow mean of the energy, so the beat is what rises above it
let playing: HTMLAudioElement | null = null;
let pauseTimer = 0;
let loading = false; // the picked track is buffering (first pick downloads it)
const elements = new Map<number, HTMLAudioElement>();
const listeners = new Set<() => void>();

function readSaved(): { track: number; muted: boolean } {
  const fallback = { track: 0, muted: TRACKS.length === 0 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return fallback;
    // "2" is track 2 playing, "off:2" is muted on track 2; the old "off" is muted on track 1.
    const off = raw === 'off' || raw.startsWith('off:');
    const index = Number(off ? raw.slice(4) || 0 : raw);
    if (Number.isInteger(index) && index >= 0 && index < TRACKS.length) return { track: index, muted: off };
    if (off) return { track: 0, muted: true };
  } catch {
    /* storage blocked: default on */
  }
  return fallback;
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, muted ? `off:${track}` : String(track));
  } catch {
    /* not persisted */
  }
}

/** The track that should be audible, or `null` for silence. */
const wanted = (): SoundState => (muted ? null : track);

const emit = () => listeners.forEach((fn) => fn());

/** What the visitor hears now: `null` until the first gesture, and while muted. */
export const music = {
  get state(): SoundState {
    return started ? wanted() : null;
  },
  /** True while silent, including before the first gesture. */
  get muted(): boolean {
    return !started || muted;
  },
  /** The selected track, kept while muted. */
  get track(): number {
    return track;
  },
  /** True while the selected track is buffering before it can play. */
  get loading(): boolean {
    return started && loading;
  },
  trackCount: TRACKS.length,
  /** Creates the audio graph inside a gesture without changing what is selected (the radio flight uses it). */
  unlock(): void {
    if (started) return;
    ensureStarted();
    apply(false);
  },
  onChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Next track (the radio); if muted, unmutes on the next track. Starts the music if no gesture has yet. */
  cycle(): void {
    const wasStarted = started;
    ensureStarted();
    if (wasStarted) track = nextTrack(track, TRACKS.length);
    muted = false;
    apply(true);
  },
  /** Mute or unmute. Unmuting resumes the last track. */
  toggleMute(): void {
    const wasStarted = started;
    ensureStarted();
    muted = wasStarted ? !muted : false;
    apply(true);
  },
  /**
   * How hard the beat hits right now, 0..1: the bass energy above its recent average, scaled by the fade so it is 0 while
   * muted or buffering. Without an analyser it is a gentle fixed-tempo pulse while playing.
   */
  level(): number {
    if (!started || muted || loading || !playing) return 0;
    if (!context || !gain || !analyser || !bins) {
      const phase = ((performance.now() / 1000) * FALLBACK_BPM) / 60;
      return 0.6 * Math.max(0, Math.sin(phase * Math.PI * 2)) ** 2;
    }
    analyser.getByteFrequencyData(bins);
    let sum = 0;
    for (let i = bassLo; i <= bassHi; i++) sum += bins[i];
    const energy = sum / ((bassHi - bassLo + 1) * 255);
    envelope = energy > envelope ? energy : envelope + (energy - envelope) * 0.15;
    average += (energy - average) * 0.01;
    const fade = Math.min(1, gain.gain.value / LEVEL);
    return Math.min(1, Math.max(0, (envelope - average) * 6)) * fade;
  },
};

function ensureStarted(): void {
  if (started) return;
  started = true;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    context = new Ctor();
    gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(context.destination);
    analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    gain.connect(analyser); // a side tap: the analyser output goes nowhere
    bins = new Uint8Array(analyser.frequencyBinCount);
    const hzPerBin = context.sampleRate / FFT_SIZE;
    bassLo = Math.max(1, Math.floor(BASS_HZ[0] / hzPerBin));
    bassHi = Math.max(bassLo, Math.ceil(BASS_HZ[1] / hzPerBin));
  } catch {
    context = gain = analyser = null;
    bins = null;
  }
}

function elementFor(index: number): HTMLAudioElement | null {
  let audio = elements.get(index);
  if (audio) return audio;
  const track = TRACKS[index];
  if (!track) return null;
  audio = new Audio();
  audio.loop = true;
  audio.preload = 'auto';
  const probe = audio.canPlayType('audio/webm; codecs="opus"');
  audio.src = pickSource(track, probe === 'probably' || probe === 'maybe');
  if (context && gain) {
    try {
      context.createMediaElementSource(audio).connect(gain);
    } catch {
      audio.volume = LEVEL; // no graph: plain volume (ignored on iOS)
    }
  } else {
    audio.volume = LEVEL;
  }
  elements.set(index, audio);
  return audio;
}

function ramp(to: number, seconds: number): void {
  if (!context || !gain) return;
  const now = context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(to, now + seconds);
}

/** Makes the audio match `desired`, fading. Call inside a gesture the first time (iOS). */
function apply(persist: boolean): void {
  if (persist) save();
  window.clearTimeout(pauseTimer);
  void context?.resume().catch(() => {});
  const index = wanted();
  const target = index === null || document.hidden ? null : elementFor(index);
  setLoading(false);
  if (!target) {
    ramp(0, FADE_S);
    const old = playing;
    playing = null;
    if (old) pauseTimer = window.setTimeout(() => old.pause(), FADE_S * 1000);
  } else if (target === playing) {
    ramp(LEVEL, FADE_S);
  } else {
    const old = playing;
    playing = target;
    const start = () => {
      old?.pause();
      if (playing !== target) return;
      // Fade in only once it actually plays, so a slow download does not eat the fade.
      const ready = () => {
        if (playing !== target) return;
        setLoading(false);
        ramp(LEVEL, FADE_S);
      };
      if (target.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        void target.play().then(ready, () => setLoading(false));
        return;
      }
      setLoading(true);
      target.addEventListener('playing', ready, { once: true });
      target.addEventListener('error', () => playing === target && setLoading(false), { once: true });
      void target.play().catch(() => playing === target && setLoading(false));
    };
    if (old) {
      ramp(0, SWITCH_FADE_S);
      pauseTimer = window.setTimeout(start, SWITCH_FADE_S * 1000);
    } else {
      start();
    }
  }
  emit();
}

function setLoading(value: boolean): void {
  if (loading === value) return;
  loading = value;
  emit();
}

/** Starts the music on the first gesture (capture phase, so every view is covered) and pauses it while the tab is hidden. */
export function initMusic(): void {
  const first = (e: Event) => {
    if (started) return cleanup();
    // The sound button starts the music itself, so its first tap does not mute it.
    if (e.target instanceof Element && e.target.closest('[data-sound-control]')) return;
    cleanup();
    ensureStarted();
    apply(false);
  };
  const cleanup = () => {
    document.removeEventListener('pointerdown', first, true);
    document.removeEventListener('keydown', first, true);
  };
  document.addEventListener('pointerdown', first, true);
  document.addEventListener('keydown', first, true);
  document.addEventListener('visibilitychange', () => {
    if (!started) return;
    if (document.hidden) {
      window.clearTimeout(pauseTimer);
      playing?.pause();
      playing = null;
      void context?.suspend().catch(() => {});
    } else {
      apply(false);
    }
  });
}
