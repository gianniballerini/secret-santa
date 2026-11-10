# Secret Santa

A tiny static site for family gift exchanges. The organizer enters the participants and draws, and each person gets a private link that reveals only who they give to, by pulling a note out of a 3D jar.

## Quick start

Requires Node 20.19+ and Yarn.

```sh
yarn            # install
yarn start      # dev server on http://localhost:1234
yarn test       # unit tests (vitest)
yarn typecheck  # TypeScript only
yarn build      # typecheck + static build in dist/
yarn preview    # serve the build
```

## Intention

The goal is to make a family draw feel like a small event, without asking anyone to sign up or anyone to host anything.

| Principle | What it means in practice |
|-----------|---------------------------|
| No accounts, no backend | The whole exchange lives in the links. It deploys as static files. |
| Everyone can run the draw and still play | The organizer never has to see the result, as long as they send the links without opening them. |
| The reveal is the product | Before the name is out, the only visible text is the "Tocá para ver" hint. No greeting, no button. |
| The name stays hidden until the moment | The recipient is not in the DOM, or announced to screen readers, until after the reveal. |
| Made for phones and for this family | Designed mobile first, with Spanish UI copy in Argentine voseo and Argentine Christmas ideas. |

## How it works

1. The organizer adds at least 3 participants. The list is saved in that browser's localStorage.
2. The draw assigns each person someone else to give to.
3. The organizer copies each private link, or downloads them all as a Markdown backup.
4. A participant opens their link and taps the jar. The note comes out with the name, then a card rises with the gift theme.

## Technical specification

### Stack

| Area | Choice |
|------|--------|
| Build | Vite 8, with a small Pug include plugin in `vite.config.ts` |
| Markup and styles | Pug, SCSS |
| Language | TypeScript |
| 3D | three.js, three-mesh-bvh, a small built-in paper solver (`src/three/physics.ts`) |
| Tests | Vitest (`src/**/*.test.ts`) |

### Structure

| Path | Responsibility |
|------|----------------|
| `src/main.ts` | Picks the view from `location.hash` |
| `src/domain/` | Pure logic with tests: draw, token, participants, links file |
| `src/ui/` | Organizer and reveal flows. Card copy lives in `themeContent.ts` |
| `src/three/` | The jar scene (`JarScene.ts`), physics, note and geometry |
| `src/views/index.pug` | Markup rendered into `index.html` |
| `src/styles/` | Tokens, base styles and components |
| `src/assets/backdrop.svg` | Night scene, used as both the CSS and the WebGL background |

### Views

| URL hash | View |
|----------|------|
| Empty | Organizer |
| Valid token | Reveal |
| Invalid token | Error |

### Draw

The participant list is shuffled with Fisher-Yates and reshuffled until nobody is assigned to themselves, which produces a derangement in about *e* attempts on average. Fewer than 3 participants is rejected.

### Link format

```text
<page-url>#<token>
```

The token is base64url-encoded UTF-8 JSON:

| Field | Type | Meaning |
|-------|------|---------|
| `g` | non-empty string | Giver name |
| `r` | non-empty string | Recipient name |
| `a` | string | Legacy avatar file name, kept so old links still decode |

The token lives in the URL fragment, which browsers do not send to the server.

### Data storage

| Data | Where |
|------|-------|
| Participants | localStorage, key `secret-santa:participants` |
| Assignments | Only inside the generated links |

### Rendering

- The jar is lazy-loaded when the reveal view opens.
- Without WebGL, the reveal falls back to a CSS paper note.
- Layout targets 390x844 and must hold at 360x640. Desktop keeps the same centred composition.

### Deployment

`yarn build` writes a static site to `dist/` with a relative base, so it works from any host or subpath, including GitHub Pages project sites.

## Limitations

- **Links are obfuscated, not encrypted.** Anyone technical can decode the base64. Fine for family fun, not for secrets.
- **The draw uses `Math.random`.** It is not cryptographically secure, and does not need to be for this use.
- **Links cannot be revoked.** A re-draw creates new links, and older links keep showing the old result, so send the new ones to everyone.
- **The organizer can spoil their own surprise** by opening a link other than their own.

## Contributing

- Tokens and components: [`docs/STYLE_GUIDE.md`](docs/STYLE_GUIDE.md)
- Project rules and the `JarScene` contract: [`CLAUDE.md`](CLAUDE.md)
- Visual inspiration, not shipped: [`docs/reference/argentina_christmas.jpeg`](docs/reference/argentina_christmas.jpeg)
