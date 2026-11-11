# Repository Guidelines

## Project Overview

锦鲤前程 (Jinli Qiancheng) is a WeChat multiplayer running/catching game with a native mini-program, a Canvas2D mini-game, a Node.js backend and a Vue administration app. Local guest play and online account play have different persistence and asset authority.

## Architecture & Data Flow

- **Mini-program:** `app.js` owns lifecycle, privacy and audio; `pages/boot/` loads consent/config/auth before navigation. Pages call `utils/` stores and clients, then render snapshots with `setData`. `utils/game-store.js` owns local `idle → room → playing → finished` state and subscriptions.
- **Online play:** clients use authenticated `/api` requests for rooms/account operations and realtime arena snapshots over Socket.IO or native `/ws/arena`. `back/src/routes/` handles authentication/input/responses; `services/` owns business logic; `models/db.js` wraps the MySQL pool. Active sessions live in memory; settlement writes durable account/game records in a transaction. Direction inputs go to the server; positions, collisions, scores and account rewards remain server-authoritative.
- **Mini-game:** `minigame/game.js` loads compiled `dist/main.js`. `src/main.ts` owns canvas/lifecycle/frame dispatch; `GameApplication.ts` selects scenes and local/online modes. `core/` contains rules, stores and clients; `scenes/`, `render/` and `platform/` separate interaction, drawing and WeChat APIs.
- **Admin:** Vue 3 + Element Plus + Pinia; Axios calls admin APIs. Vite builds an app served by Express at `/admin/`.
- **Shared rules:** most `utils/` rules have backend copies in `back/src/game-engine/` and TypeScript ports in `minigame/src/core/`. Keep affected implementations and parity behavior aligned; see generated-source exceptions below.

## Key Directories

| Path | Use |
| --- | --- |
| `pages/`, `utils/` | Native WeChat views and reusable client rules/state/networking |
| `back/src/`, `back/sql/` | API/realtime server and ordered SQL schema/migrations |
| `back/admin-web/` | Independently installed/built administration frontend |
| `minigame/src/` | Canvas2D client source; no game engine/editor dependency |
| `tests/`, `back/tests/`, `minigame/tests/` | Node-based unit, behavior and cross-implementation parity tests |
| `scripts/`, `back/scripts/`, `minigame/scripts/` | Assets/release tooling, server integration checks and code generation |
| `assets-pkg/`, `assets/` | Packaged game images and source media; other assets use the CDN |

## Development Commands

Run from the repository root unless a working directory is specified.

| Working directory | Command | Purpose |
| --- | --- | --- |
| Root | `npm test` | Mini-program tests (`node --test tests/*.test.js`) |
| `back/` | `npm ci` | Install locked server dependencies |
| `back/` | `npm run dev` / `npm start` | Nodemon development / server startup |
| `back/` | `npm test` | Server unit/behavior tests |
| `back/` | `npm run test:integration` | Isolated Docker MySQL 8.4 + real HTTP/WebSocket flows |
| `back/admin-web/` | `npm ci` | Install locked admin dependencies |
| `back/admin-web/` | `npm run dev` / `npm run build` / `npm run preview` | Vite development / production build / preview |
| `minigame/` | `npm ci` | Install locked TypeScript/rendering dependencies |
| `minigame/` | `npm test` | Codegen, then TypeScript behavior/parity tests |
| `minigame/` | `npm run typecheck` / `npm run build` | Strict TS check / codegen and compile to `dist/` |
| `minigame/` | `npm run smoke` | Build and run render/menu/rules smoke scenarios |
| Root | `npm run assets:check` / `npm run assets:check:strict` | Check CDN inventory; strict mode fails inaccessible/mismatched assets |
| Root | `npm run release:check` | Mini-program release inspection; consult release docs for options |

Open the repository root in WeChat DevTools for the mini-program; import `minigame/` separately for the mini-game after building. There is no root build/start command and no configured lint/format script. Admin has no test script.

## Code Conventions & Common Patterns

- Follow neighboring formatting: handwritten code generally uses two spaces, but semicolons vary. Mini-program/backend JavaScript uses CommonJS; mini-game TypeScript and admin use ESM. Functions/fields use `camelCase`, constants `UPPER_SNAKE_CASE`; JS modules commonly use kebab-case, TS core classes/files PascalCase.
- Pages use `Page({...})` and `.js/.wxml/.wxss/.json` companions. Before changing any page, read [page layout rules](docs/agents/page-layout.md): preserve safe areas, `global-bg-image → app-header → page-content` (boot exception), and initialize `data.nav` from `getNavLayout()` in `onLoad`.
- Stores own state; views consume snapshots/subscriptions. Dispose subscriptions, timers and sockets on hide/unload as appropriate. Preserve arena snapshot-version/page-generation guards and queued `setData` completion handling when changing asynchronous rendering.
- Keep guest storage separate from account inventory. Authenticated buy/equip uses server operations and inventory refresh; local settlement cannot credit account coins. Preserve token/revision checks that reject stale async responses.
- Backend SQL is parameterized; settlement uses one connection with commit/rollback and `finally` release. Services throw errors with `statusCode`; routes use `back/src/utils/response.js` helpers and centralized error handling. API envelopes are `{code, message, data}`: mini-program client unwraps `data`, while admin Axios callers inspect `res.data.code`/`res.data.data`.
- Use existing small injection seams (`options.random`, `OnlineGame(transport)`, scene options); no DI container. Use `async/await` with existing error/finally cleanup patterns.
- Audio goes through `utils/audio.js`; styles reuse `app.wxss` tokens. Profile capture uses `chooseAvatar` and nickname input, not deprecated `wx.getUserProfile`. Read [workflow conventions](docs/agents/workflows.md) for audio/profile/CSS changes and commits.

### Shared and Generated Code

- Edit `minigame/src/core/RunArena.ts`, then run `npm --prefix minigame run codegen` to generate `utils/run-arena.js` and `back/src/game-engine/run-arena.js`. The same generator produces `utils/arena-effects.js` and `utils/run-arena-renderer.js` from mini-game render TypeScript. Do not hand-edit generated outputs.
- `utils/shop-store.js` supplies generated `minigame/src/core/ShopCatalog.ts`; `utils/legal-config.js` supplies generated `LegalContent.ts`. Backend shop catalog changes still require separate synchronization.
- Changes to `utils/game-engine.js`, `board-layout.js`, `team-link.js`, `constants.js`, `investment.js` or `emote.js` require updating the corresponding TS port and running mini-game parity tests. Synchronize affected backend rule copies and run both JS suites too.
- Mini-game `codegen` rewrites generated shared files and copies packaged assets; `npm test` in `minigame/` only checks them (`generate-run-arena.mjs --check`) and does not overwrite them. `minigame/dist/` and admin `dist/` are generated artifacts. `assets-pkg/` is hand-maintained packaged media (no source in `assets/`), tracked in git; its effect/item images are not on the CDN, so they must stay at `/assets-pkg/`.

## Important Files

| File | Why it matters |
| --- | --- |
| `app.js`, `app.json`, `app.wxss`, `project.config.json` | Mini-program lifecycle, registered routes, shared styles and DevTools/upload settings |
| `utils/game-store.js`, `utils/shop-store.js`, `utils/api-client.js` | Local simulation, guest/account inventory boundary and authenticated requests |
| `utils/runtime-config.js`, `minigame/src/core/RuntimeConfig.ts` | Feature flags and remote configuration |
| `back/src/app.js`, `back/src/services/game-service.js` | Server composition, realtime session lifecycle and settlement |
| `back/.env.example`, `back/src/config/index.js` | Environment setup and startup validation; copy the template to `back/.env` |
| `minigame/game.js`, `minigame/src/main.ts`, `minigame/tsconfig.json` | Packaged entrypoint, canvas application and strict compile settings |
| `back/admin-web/vite.config.js` | `/admin/` base and `/api` dev proxy (`VITE_API_TARGET`) |
| `.github/workflows/ci.yml` | Automated verification commands |

Read [architecture](docs/agents/architecture.md) for module/navigation details, [testing conventions](docs/agents/testing.md) before editing tests, and [release configuration](docs/release/运营材料填写说明.md) for operator/legal materials. `PRODUCT.md` describes current product intent. The root `README.md` contains outdated local-only gameplay information; verify behavior against current source.

## Runtime/Tooling Preferences

- Use **Node.js 24** (`.nvmrc`) and **npm**. Backend, admin and mini-game have separate lockfiles/installations; this is not an npm workspace. Root tests have no dependency-install prerequisite. Do not introduce another frontend test framework.
- Backend requires MySQL configuration and application secrets; use `back/.env.example` and config validation rather than hardcoded credentials. Local Docker Compose provisions MySQL only; inspect `back/sql/` for migrations beyond its mounted initialization files.
- CDN media uses `https://xcx.ukb88.com/`; some arena/stage images are bundled in `assets-pkg/`. Preserve this distinction when changing resource paths.

## Testing & QA

- All three suites use `node:test` and `node:assert/strict`. Narrow JS example: `node --test tests/game-store.test.js` or `node --test back/tests/game-service.test.js`. Narrow TS example from `minigame/`: `npm run codegen && node --import ./tests/register-hook.mjs --test tests/engine-parity.test.ts`.
- Mock only needed `wx` APIs; use isolated `Map` storage and reset affected stores in `beforeEach`. **Never call `__resetForTests()` in production code.** Restore patched globals/dependencies and dispose timers/scenes/subscriptions after tests.
- Inject deterministic random sources; parity comparisons use independent RNGs with the same seed. Disable autonomous timers where supported and advance ticks explicitly. Preserve engine, running-arena and store parity when changing shared behavior.
- Run affected suites; for shared engine changes run root, backend and mini-game tests. For Canvas changes also run the mini-game smoke command and inspect DevTools/real-device behavior. Backend integration requires Docker and creates/tears down an isolated database.
- CI runs root/server tests, backend production dependency audit, and mini-game tests/typecheck/build. It does not currently run admin build, integration or render smoke. No numeric coverage threshold is configured; validate affected behavior and boundaries.
