import webm1 from '../assets/music/background-1.webm?url';
import m4a1 from '../assets/music/background-1.m4a?url';
import webm2 from '../assets/music/background-2.webm?url';
import m4a2 from '../assets/music/background-2.m4a?url';
import webm3 from '../assets/music/background-3.webm?url';
import m4a3 from '../assets/music/background-3.m4a?url';

export interface Track {
  id: string;
  /** Spanish name shown next to the radio. */
  label: string;
  webm: string;
  m4a: string;
}

// Only URLs: a file is fetched when its track is first picked (see `elementFor` in music.ts).
export const TRACKS: readonly Track[] = [
  { id: 'background-1', label: 'Pista 1', webm: webm1, m4a: m4a1 },
  { id: 'background-2', label: 'Pista 2', webm: webm2, m4a: m4a2 },
  { id: 'background-3', label: 'Pista 3', webm: webm3, m4a: m4a3 },
];

/** The track index that is playing, or `null` for silence. */
export type SoundState = number | null;

/** Radio dial: track 1, 2, ..., then back to 1. Silence is the separate mute switch. */
export function nextTrack(track: number, trackCount: number): number {
  return trackCount <= 0 ? 0 : (track + 1) % trackCount;
}

/** Opus in WebM when the browser can play it, AAC otherwise (Safari). */
export function pickSource(track: Track, canPlayWebmOpus: boolean): string {
  return canPlayWebmOpus ? track.webm : track.m4a;
}
