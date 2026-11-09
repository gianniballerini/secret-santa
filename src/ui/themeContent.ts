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
};
