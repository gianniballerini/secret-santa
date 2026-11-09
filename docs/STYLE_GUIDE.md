# Secret Santa Style Guide

A night-time Argentine Christmas: navy sky, celeste and white bunting, warm string lights, a pine garland with a red bow. Inspiration: `docs/reference/argentina_christmas.jpeg`. Tokens live in `src/styles/_tokens.scss`.

## Palette

| Token | Value | Use |
| --- | --- | --- |
| `--navy-900` / `--navy` / `--dusk` | `#0a1534` / `#10214a` / `#2c3f73` | Night sky |
| `--celeste` | `#74acdf` | Accent, focus ring, bunting |
| `--celeste-deep` | `#2e6da4` | Primary buttons, card title (white text passes AA) |
| `--gold` | `#f6b40e` | Main action, bulbs, ring |
| `--green` | `#2f7a3f` | Garland, success |
| `--red` / `--red-deep` | `#c8352b` / `#a81c1c` | Bow, paper ink, closing line |
| `--cream` | `#fff6e0` | Cards and the reveal sheet |
| `--ink` / `--ink-muted` | `#1d2a4a` / `#5a6685` | Text on cream |
| `--wood` | `#7a4a2b` | Reserved for table details |

## Typography

- Display: Lobster (also used on the 3D note, so the card matches it).
- Body: Nunito 400/600/700/800.
- Scale: `--text-xs` 0.8125rem, `--text-sm` 0.9375rem, `--text-base` 1rem, `--text-lg` 1.25rem, `--text-xl` 1.75rem, `--text-2xl` 2.75rem.

## Layout

- Mobile first. Design at 390x844; it must hold at 360x640. Use `100dvh` and `env(safe-area-inset-*)`.
- Organizer and error: one centred column (max 480px) over the backdrop with cream cards.
- Reveal: a full-viewport stage (`touch-action: none`, no page scroll). The card is a bottom sheet (max-width 420px, max-height 58dvh, scrolls inside); on screens 600px and wider it floats centred instead of docking.

## Backdrop

`src/assets/backdrop-portrait.webp` has no text. Decoration sits in the top 12% so the jar area stays calm. It is the CSS body background and the WebGL `scene.background`, where wide screens mirror it sideways. In the CSS, wide screens use `backdrop-wide.webp` instead.

## Components

- **Button**: pill, 48px min height. `--primary` celeste, `--gold` for the one main action, `--secondary` outline, `--ghost`/`--danger` for low emphasis.
- **Input**: 48px, 2px border, 14px radius, label above, error below with `role="alert"`.
- **Row**: name on the left, Editar/Quitar on the right. Editing swaps the row for an input with Guardá/Cancelar.
- **Sheet**: handle, Lobster title, three labelled rows with celeste/gold/green rules, closing line.
- **Ring and hint**: a gold ripple on the jar and a gold "Tocá para ver" pill below it, the only tap invitation, hidden until the jar is ready and once opening starts.

## Motion

- Easings: `--ease-out` `cubic-bezier(0.215, 0.61, 0.355, 1)`, `--ease-pop` `cubic-bezier(0, 1.52, 0.295, 0.86)`.
- The sheet rises in 650ms. Under `prefers-reduced-motion: reduce` transitions collapse to about zero, the jar jumps to its final state and the wobble is skipped.

## Copy

Spanish with Argentine voseo ("Agregá", "Sorteá", "Copiá", "Guardá el secreto."). The sheet copy lives in `src/ui/themeContent.ts`.
