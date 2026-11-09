# Secret Santa

Static Vite + Pug + SCSS + TypeScript + three.js site for gift exchanges. No backend.

## Commands

- `yarn start`: dev server on port 1234
- `yarn typecheck`, `yarn test` (vitest), `yarn build` (typecheck + static build, relative base)

## Architecture

- Three views, switched by `src/main.ts` from `location.hash` by toggling `hidden` on `#organizer`, `#reveal` and `#error`. It also sets `body[data-view]`; the reveal view locks page scroll.
- An empty hash shows the organizer. Otherwise the hash is a token that `src/domain/token.ts` decodes to `{ g, r, a }` (giver, recipient, recipient avatar). A bad token shows the error view. The `a` field is kept so old links still decode, even though avatars are gone from the UI.
- `src/domain/*` is pure logic with tests (draw, participants, token). Do not change it casually.
- `vite.config.ts` renders `src/views/index.pug` into the `<!-- pug:... -->` placeholder in `index.html`.
- `src/ui/organizer.ts`: participants in localStorage (`secret-santa:participants`), 3-person minimum, draw, copy-link rows.
- `src/ui/reveal.ts`: lazy-loads the jar, owns the reveal flow. `src/ui/themeContent.ts` holds the card copy (the one place to edit it).
- `src/three/JarScene.ts` is the 3D scene. Public contract: `mount(container)`, `ready`, `reset(name)`, `open()` (resolves when the note is fully shown), `requestMotion()`, `setFrameShift(fraction, animate?)`, `noteClearanceShift(cardFraction)`, `onOpenRequest`, `setPaused()`, `dispose()`. `mount` throws without WebGL; the UI then falls back to a CSS paper note.
- `src/assets/backdrop-portrait.webp` is the night scene, used as the CSS body background and the WebGL `scene.background`; `backdrop-wide.webp` replaces it in the CSS on wide screens. They must contain no text. `src/three/table.ts` is the gingham cloth under the jar.
- The art is low-poly, generated from `docs/reference/favicon-source.jpeg` as the style reference. Raw sources live in `docs/reference/generated/` and are not shipped. The jar and lid are faceted at render level only (`FACET_SIDES`); the physics walls stay round.

## Product rules

- On the reveal view the only visible text before the name is out is the "Tocá para ver" hint below the jar, which disappears on tap. No greeting, no button. The recipient must not be in the DOM (or announced) until after the reveal. Screen-reader-only text that does not name the recipient is fine.
- Only after `jar.open()` resolves do the note glide up and the cream card rise with the theme instructions. The card must never cover the note; it scrolls internally on short screens.
- Do not change the jar animation timings or sequence casually (`JarScene.open`, `stir.ts`, `tween.ts`, `physics.ts`, `note.ts`, `paper.ts`, `crumple.ts`, the geometry files).
- Mobile first: design at 390x844, must hold at 360x640. Desktop is the same centred composition (card max-width about 420px).
- UI copy is Spanish with Argentine voseo. Code, comments, identifiers and docs are English.

See `docs/STYLE_GUIDE.md` for tokens and components. `docs/reference/argentina_christmas.jpeg` is the visual inspiration only; it is not shipped.
