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
- `src/ui/reveal.ts`: lazy-loads the jar, owns the reveal flow and the intro (`#intro`: `is-pending`, then `is-label` or `is-slip`). `src/ui/themeContent.ts` holds the intro, back label and card copy (the one place to edit it).
- `src/three/JarScene.ts` is the 3D scene. Public contract: `mount(container)`, `ready`, `reset(name)`, `open()` (resolves when the note is fully shown), `requestMotion()`, `setFrameShift(fraction, animate?)`, `noteClearanceShift(cardFraction)`, `setMusicLevel(source)` (the radio's beat, 0..1 per frame, so JarScene never imports `src/audio`), `onOpenRequest`, `setPaused()`, `dispose()`, plus the intro trio `showBackLabel(content)`, `playBackLabelEntry()` and `revealFront()`, plus the sound and credits additions `hasBoombox`, `focusBoombox()`, `focusJar()`, `onBoomboxTap`, `showCredits(content, clearance)`, `hideCredits()` and `onCreditsDismiss`. `mount` throws without WebGL; the UI then falls back to a CSS paper note. `showBackLabel` is async and rejects if the fonts or art fail (the UI then shows the DOM slip over the plain jar); a later `reset()` cancels a build in flight.
- The intro is the jar itself. `src/three/jarBackLabel.ts` builds a real 3D info sticker on the flat back facet (centred at 165 degrees; art `src/assets/images/intro-facets.svg`, 390x844) with one quad per text block. `showBackLabel` turns the jar to it and parks the camera on it (contain-fit, refitted on resize); `playBackLabelEntry` staggers the text in; the button then calls `revealFront`, which pulls the camera back while the jar spins its front to the camera. `presenting` / `presentYaw` only touch the jar's yaw in `tick`, never physics, and so does `labelTilt`, the slight lean that follows the mouse or gyro while the label is up (no iPhone gyro there: iOS needs a tap first). The `#intro` DOM text is visually hidden over the label (screen readers) and is the visible slip when the label cannot be shown. `.sr-only` is the hidden-text utility.
- Sound: `src/audio/` (`tracks.ts` pure cycle and source pick, tested; `music.ts` the player). The first pointer or key gesture creates an `AudioContext` and a gain node (iOS ignores `volume`), picks Opus/WebM or AAC/M4A by `canPlayType`, loops, fades, pauses on `visibilitychange`, and persists `secret-santa:sound` (`off` or a track index). `initMusic()` and `initSoundUi()` run from `src/main.ts`.
- Top-right `#sound` and `#credits` buttons (`.toolbar` in `index.pug`, `src/ui/soundUi.ts`, `src/styles/components/_sound.scss`) sit outside `#stage` (inert during the intro) and above the intro. With the 3D jar in reveal ready/done, `#sound` calls `focusBoombox()` (camera flight to `src/three/boombox.ts`, `body[data-sound-focus]` slides the sheet down, a gold pill names the track, beside a round `#sound-mute` button) and becomes a back button; a tap on the radio or pill cycles the tracks only (muted: unmutes on the next one), `#sound-mute` toggles silence and unmuting resumes the last track. The radio thumps with the bass (`music.level()` from an `AnalyserNode`, fed through `setMusicLevel`) and floats notes while focused; neither under reduced motion. Everywhere else `#sound` just mutes. `reveal.ts` registers the jar with `setSceneProvider`, and `isSoundBusy()` stops the jar opening meanwhile. The jar tap, spin and parallax are off while focused. `setFrameShift` is overridden by an internal hold during focus and credits.
- Credits: `#credits` shows a paper (second non-physics `Note`, `setLines`) that rises from the jar mouth to the note's front pose, with a DOM caption holding the real links; elsewhere it opens `#credits-dialog`. If the name note is already out, the papers take turns: the name folds back into the jar (`paperIn`), the credits rise (`paperOut`), and closing reverses it; `hideCredits()` resolves after the name is back. `noteSwap` stops parallax from driving the name note's rotation meanwhile. Copy is in `themeContent.ts`, full attribution in `docs/CREDITS.md` (the boombox is CC BY 4.0 and the credit must stay visible). The boombox loads in the background after `ready`; if it fails the sound button only mutes.
- Fonts are self-hosted woff2 in `src/assets/fonts/` (`src/styles/_fonts.scss`, `font-display: block`) and the three the intro needs are preloaded in `index.html`: Lobster, Alfa Slab One (`--font-label`, the giver's name) and Nunito. The label waits for them before drawing, so adding a face means adding it to `loadFonts` in `jarBackLabel.ts` too.
- `src/assets/images/backdrop-portrait.webp` is the night scene, used as the CSS body background and the WebGL `scene.background`; `backdrop-wide.webp` replaces it in the CSS on wide screens. They must contain no text. `src/three/table.ts` is the gingham cloth under the jar.
- The art is low-poly, generated from `docs/reference/favicon-source.jpeg` as the style reference. Raw sources live in `docs/reference/generated/` and are not shipped. The jar and lid are faceted at render level only (`FACET_SIDES`); the physics walls stay round.

## Product rules

- Each link opens on the jar's back label, which greets the giver by name; its button pulls the camera back and spins the jar to the front. Without WebGL it is a full-screen slip that slides away.
- The recipient must not be in the DOM (or announced) until after the reveal. Screen-reader-only text that does not name the recipient is fine.
- Only after `jar.open()` resolves do the note glide up and the cream card rise with the theme instructions. The card must never cover the note; it scrolls internally on short screens.
- Do not change the jar animation timings or sequence casually (`JarScene.open`, `stir.ts`, `tween.ts`, `physics.ts`, `note.ts`, `paper.ts`, `crumple.ts`, the geometry files).
- Mobile first: design at 390x844, must hold at 360x640. Desktop is the same centred composition (card max-width about 420px).
- UI copy is Spanish with Argentine voseo. Code, comments, identifiers and docs are English.

See `docs/STYLE_GUIDE.md` for tokens and components. `docs/reference/argentina_christmas.jpeg` is the visual inspiration only; it is not shipped.
