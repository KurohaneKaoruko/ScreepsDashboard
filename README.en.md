# Screeps Dashboard

[中文](README.md) [English](README.en.md)

Screeps Dashboard is a cross-platform monitoring and management panel built with `React 19 + Vite 7 + Tauri 2`. It runs as a standalone Web application and can also be packaged for desktop and mobile.

## Features

- Authentication: password sign-in (exchange to token), direct token sign-in, and guest mode.
- Endpoint compatibility probing for better support across official and private Screeps servers.
- User page (`/user`): GCL/GPL, alliance info, room thumbnails, and profile overview.
- Public user view: use `?target=<username>` to inspect other players' public data; in this mode, account resources and CPU/MEM blocks are hidden, and room-building thumbnails are rendered in red.
- Resources page (`/resources`): shard-grouped room inventory, per-shard collapse, and an aggregate "all shards" section when multiple shards exist.
- Room workbench (`/rooms`): monitor multiple rooms, filter by shard/name, sort by stored energy or alerts, select rooms for comparison, watch rooms, refresh independently, and pause automatic updates.
- Resources: room-by-resource inventory matrix, aggregate totals, search, and CSV export. Building stock excludes natural resources, dropped resources, creep inventories, and remains.
- Buildings and units: filter by type and damage; inspect IDs, positions, owners, hits, capacity, individual inventories, cooldown, effects, creep body parts, and TTL.
- Alerts: units not owned by you, low spawn energy, damaged buildings, nearly full storage, and controller downgrade. Failed refreshes retain clearly marked previous snapshots without blocking other rooms.
- Room management: batch public rampart access and attack notifications, plus construction-site creation. Review targets before submitting and inspect each request's result.
- Room detail (`/rooms?name=<room>&shard=<shard>`): official room renderer with overview, resources, buildings, units, and management tabs.
- Rankings (`/rankings`): dimensions, filtering, pagination.
- Market (`/market`): resource order browsing and order-assist flow.
- Messages (`/messages`) and Console (`/console`): unavailable in guest mode; token session required.
- World map (`/map`): browse the world map with owner-coloured rooms and RCL levels, highway/novice hints, a hover tooltip, a click-to-pin room inspector, players/own-room lists, minimap navigation and layer toggles. Available to guests and anonymous visitors too.
- Sidebar public search: available in any active session (including guest) to jump to public user/resources pages.
- Request pipeline: Tauri Rust command `screeps_request` first, browser `fetch` fallback.
- Console execution pipeline: Tauri Rust command `screeps_console_execute` first, browser request fallback on failure.
- Standalone Web service: same-origin API and WebSocket gateway, an explicit server allowlist, Docker deployment, and a Web manifest.

## Tech Stack

- Frontend: React 19, Vite 7, TypeScript, React Router 7 (HashRouter), SWR, Zustand
- Shell: Tauri 2
- Rust HTTP bridge: `reqwest` (`rustls-tls`)
- Web service: Node.js built-in HTTP/HTTPS, with no third-party runtime server dependencies

## Project Structure

```text
ScreepsDashboard/
|-- src-web/                       # React + Vite frontend
|   |-- src/routes.tsx             # Route definitions (HashRouter)
|   |-- src/pages/                 # Page components
|   |-- src/components/            # UI components
|   |-- src/lib/screeps/           # Screeps API adapters and data logic
|   `-- src/stores/                # Zustand stores
|-- src-tauri/                      # Tauri + Rust
|   |-- src/lib.rs                  # screeps_request / screeps_console_execute
|   `-- tauri.conf.json             # Tauri config
|-- scripts/
|-- package.json
|-- README.md
`-- README.en.md
```

## Requirements

- Node.js 22 LTS (CI runs on Node 22)
- pnpm 10 (pinned through `packageManager`; enable with `corepack enable`)
- Rust stable (required for desktop build and `npm run check`)
- Additional requirements for Android:
  - Android Studio (Android SDK / NDK)
  - Java 17
  - Rust targets: `aarch64-linux-android`, `armv7-linux-androideabi`

## Quick Start

### 1) Install dependencies

```bash
corepack enable
pnpm install --frozen-lockfile
```

### 2) Web dev mode

```bash
pnpm dev:web
```

This starts Vite in `src-web/` with the same-origin gateway. The default allowlist contains `https://screeps.com`; configure `SCREEPS_ALLOWED_SERVERS` to connect private servers.

### 3) Desktop dev mode (Tauri)

```bash
npm run tauri:desktop:dev
```

## Common Commands

```bash
# Web
pnpm dev:web
pnpm build:web
pnpm start:web
pnpm check:web
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e

# Existing frontend / Tauri commands
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck:web

# Quality checks (frontend + Rust)
npm run check

# Desktop (Tauri)
npm run tauri:desktop:dev
npm run tauri:desktop:build

# Android (Tauri)
npm run tauri:android:init
npm run tauri:android:dev
npm run tauri:android:build:apk
npm run tauri:android:build:aab
npm run tauri:android:build:all

# Multi-arch packaging shortcuts
npm run package:all
npm run package:windows:all
npm run package:linux:all
npm run package:macos:universal
npm run package:android:all
```

## Build Notes

### Standalone Web deployment (recommended)

Node.js is sufficient; Rust and Tauri are not required:

Download `ScreepsDashboard-*-web.tar.gz` from [GitHub Releases](https://github.com/KurohaneKaoruko/ScreepsDashboard/releases), extract it, and run `node scripts/web/serve.mjs` from the extracted directory. No dependency install or rebuild is needed. To deploy from source:

```bash
pnpm install --frozen-lockfile
pnpm build:web
pnpm start:web
```

Open `http://127.0.0.1:8080/#/rooms`. The default bind address is loopback. Set `HOST=0.0.0.0` for LAN/container access and `PORT` to change the port. Use an HTTPS reverse proxy with WebSocket Upgrade support for external deployments.

Private servers must be configured in the gateway allowlist using the same URL as the login form. Separate multiple servers with commas; ports and base paths are supported:

```bash
SCREEPS_ALLOWED_SERVERS="https://screeps.com,http://192.168.1.20:21025" HOST=0.0.0.0 PORT=8080 pnpm start:web
```

PowerShell:

```powershell
$env:SCREEPS_ALLOWED_SERVERS="https://screeps.com,http://192.168.1.20:21025"
$env:HOST="0.0.0.0"
pnpm start:web
```

The `/_screeps/` gateway forwards API and realtime traffic, addressing CORS restrictions and mixed-content restrictions when an HTTPS dashboard connects to an HTTP private server. Only explicitly listed servers are reachable. Credentials are neither logged nor persisted by the gateway, and upstream redirects are rejected. Reverse proxies should preserve the original `Host` and avoid logging URLs containing realtime tokens.

Native clients continue to prefer the Tauri network bridge. The Web manifest supplies a home-screen entry; offline game data is not provided.

### Docker

```bash
docker compose up -d --build
```

Open `http://localhost:8080`. Set `SCREEPS_ALLOWED_SERVERS` when launching Compose to allow private servers. Inside Docker, `localhost` refers to the container; use a reachable host address or service name for your Screeps server.

### Web static export

```bash
npm run build
```

`npm run build` builds via Vite (`src-web/vite.config.ts`); artifacts are generated in `src-web/dist` and consumed by Tauri. Routing uses HashRouter, so no server-side SPA fallback is required.

The output can also be hosted at the root of a static site. Static deployments connect directly to upstream APIs and require those servers to permit browser CORS requests. Use the bundled Web service for the official server, or configure a same-origin gateway in `web-config.json`, for example `{"gateway":"/_screeps/"}`.

### Desktop bundle

```bash
npm run tauri:desktop:build
```

### Android build

```bash
npm run tauri:android:init
npm run tauri:android:build:apk
npm run tauri:android:build:all
```

If initialization fails with `Android NDK not found`, configure environment variables (Windows PowerShell):

```powershell
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME="$env:ANDROID_HOME\ndk\<version>"
```

## Data and Security Notes

- Session, server/account settings, and UI preferences are persisted in `localStorage` through Zustand `persist`.
- Saved accounts persist credentials by mode: token mode stores token; password mode stores username and password.
- Password entered ad hoc on the login page is not auto-persisted; it is only persisted if saved as a password-mode account in Settings.
- On shared devices, avoid saving accounts and clear local data after use.
- Watch lists are scoped by server/account and contain only room names and shards, without snapshots or extra credentials.
- Manual management submits intents for later game ticks. Ownership, token permissions, RCL, and game rules still apply, and bot logic may override manual settings. “Submitted” does not imply that the game has already executed the action.

## Tests

```bash
pnpm check:web                    # lint, TypeScript, data/gateway tests, Web build
pnpm exec playwright install chromium
pnpm test:e2e                     # run pnpm build:web first
```

Browser tests use isolated contexts and a local fixture server, covering shard-separated inventories, building filters, CSV downloads, management confirmation, refresh failures, watch lists, locale switching, and mobile navigation. They never connect to real game accounts.

Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm test:e2e` to run an installed Chromium. Playwright screenshots and traces are written to `test-results/`; override with `PLAYWRIGHT_OUTPUT_DIR`.

## CI

CI is defined in `.github/workflows/ci.yml` and runs:

- `npm run lint`
- `npm run typecheck:web`
- `npm run rust:fmt:check`
- `npm run rust:clippy`
- `npm run build`
- `pnpm test` (room data and Web gateway)
- `pnpm test:e2e` (browser workflows against an isolated fixture server)

## Release

1. Sync version interactively:

```bash
npm run version
```

2. Interactive release:

```bash
npm run release
```

Pushing a `v*` tag triggers `.github/workflows/release.yml`. GitHub Releases receives the standalone Web bundle first, followed by Windows/macOS/Linux installers, Android APK/AAB, and best-effort iOS artifacts.

## License

GPL-3.0

