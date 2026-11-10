/** The intro slip, the jar back label and the card shown after the name is out. Edit the copy here; it is the only place it lives. */
export interface ThemeContent {
  /**
   * The giver's name goes on its own taped paper, between `hello` and `greeting`, and after `warningLead`.
   * The jar back label (3D) and the DOM slip (no-WebGL fallback, screen readers) share this copy.
   */
  intro: {
    hello: string;
    greeting: string;
    button: string;
    warningLead: string;
    warning: string;
    /** Back label only. */
    kicker: string;
    /** Ruled, nutrition-style table on the back label. */
    rows: Array<{ label: string; value: string }>;
    warningTitle: string;
    footer: string;
  };
  title: string;
  items: string[];
  /** Sound control (top-right button, the radio's pill) and the credits paper. Credits also live in docs/CREDITS.md. */
  sound: { label: string; back: string; tapRadio: string; silence: string; mute: string; unmute: string; announceOn: string; announceOff: string; loading: string };
  credits: {
    button: string;
    title: string;
    items: Array<{ label: string; text: string }>;
    links: Array<{ text: string; href: string }>;
    close: string;
  };
}

export const themeContent: ThemeContent = {
  intro: {
    hello: 'Hola',
    greeting: 'acá podés descubrir tu amigo invisible.',
    button: 'Tocá para revelar',
    warningLead: 'Si no sos',
    warning: ', este link no es para vos, cerrá la página y pedile a Gianni tu link.',
    kicker: 'INFORMACIÓN DEL PRODUCTO',
    rows: [
      { label: 'Contenido neto', value: '1 amigo invisible' },
      { label: 'Modo de uso', value: 'tocá, abrí, no cuentes' },
      { label: 'Conservar', value: 'en secreto' },
    ],
    warningTitle: 'ADVERTENCIA',
    footer: 'Lote 2026 · Industria Argentina',
  },
  title: 'Amigo invisible',
  items: [
    'El link es único por persona, no compartir.',
    'Este año volvemos a las raíces y la decoración y comida de la Navidad van a ser sobre "Argentina".',
  ],
  sound: {
    label: 'Música',
    back: 'Volver',
    tapRadio: 'Tocá la radio',
    silence: 'Silencio',
    mute: 'Silenciar',
    unmute: 'Activar sonido',
    loading: 'Cargando…',
    announceOn: 'Música',
    announceOff: 'Música apagada',
  },
  credits: {
    button: 'Créditos',
    title: 'Créditos',
    items: [
      { label: 'Música', text: 'generada con Suno.' },
      { label: 'Radio 3D', text: '«1980s Boombox» de Jen S Abbott, licencia CC BY 4.0.' },
      { label: 'Íconos', text: 'Lucide (licencia ISC).' },
    ],
    links: [
      { text: 'Suno', href: 'https://suno.com' },
      { text: 'Modelo 3D', href: 'https://sketchfab.com/3d-models/1980s-boombox-f19736661f354cada1b18c8a358f9703' },
      { text: 'Jen S Abbott', href: 'https://sketchfab.com/jsabbott' },
      { text: 'CC BY 4.0', href: 'http://creativecommons.org/licenses/by/4.0/' },
      { text: 'Lucide', href: 'https://lucide.dev' },
    ],
    close: 'Cerrar',
  },
};
