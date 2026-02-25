# Screeps Dashboard

[中文](README.md) [English](README.en.md)

Screeps Dashboard is a cross-platform client built with `Tauri 2 + Next.js 15` for viewing Screeps account data and public world data. The project is desktop-first and also includes Android build scripts.

## Features

- Authentication: password sign-in (exchange to token), direct token sign-in, and guest mode.
- Endpoint compatibility probing for better support across official and private Screeps servers.
- User page (`/user`): GCL/GPL, alliance info, room thumbnails, and profile overview.
- Public user view: use `?target=<username>` to inspect other players' public data; in this mode, account resources and CPU/MEM blocks are hidden, and room-building thumbnails are rendered in red.
- Resources page (`/resources`): shard-grouped room inventory, per-shard collapse, and an aggregate "all shards" section when multiple shards exist.
- Room detail (`/rooms?name=<room>&shard=<shard>`): inspect map/object details for a specific room.
- Rankings (`/rankings`): dimensions, filtering, pagination.
- Market (`/market`): resource order browsing and order-assist flow.
- Messages (`/messages`) and Console (`/console`): unavailable in guest mode; token session required.
- Map (`/map`): currently a placeholder page (under development).
- Sidebar public search: available in any active session (including guest) to jump to public user/resources pages.
- Request pipeline: Tauri Rust command `screeps_request` first, browser `fetch` fallback.
- Console execution pipeline: Tauri Rust command `screeps_console_execute` first, browser request fallback on failure.

## Tech Stack

- Frontend: Next.js 15, React 19, TypeScript, SWR, Zustand
- Shell: Tauri 2
- Rust HTTP bridge: `reqwest` (`rustls-tls`)

## Project Structure

```text
ScreepsDashboard/
|-- src-next/                       # Next.js frontend
|   |-- app/                        # Routes/pages
|   |-- components/                 # UI components
|   |-- lib/screeps/                # Screeps API adapters and data logic
|   `-- stores/                     # Zustand stores
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
- npm 9+
- Rust stable (required for desktop build and `npm run check`)
- Additional requirements for Android:
  - Android Studio (Android SDK / NDK)
  - Java 17
  - Rust targets: `aarch64-linux-android`, `armv7-linux-androideabi`

## Quick Start

### 1) Install dependencies

```bash
npm install
```

### 2) Web dev mode

```bash
npm run dev
```

This starts the Next.js dev server from `src-next/`.

### 3) Desktop dev mode (Tauri)

```bash
npm run tauri:desktop:dev
```

## Common Commands

```bash
# Web
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

### Web static export

```bash
npm run build
```

`src-next/next.config.ts` uses `output: "export"`, so web artifacts are generated in `src-next/out` and consumed by Tauri.

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

## CI

CI is defined in `.github/workflows/ci.yml` and runs:

- `npm run lint`
- `npm run typecheck:web`
- `npm run rust:fmt:check`
- `npm run rust:clippy`
- `npm run build`

## Release

1. Sync version interactively:

```bash
npm run version
```

2. Interactive release:

```bash
npm run release
```

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds desktop installers for Windows/macOS/Linux, Android APK/AAB, and best-effort iOS artifacts, then uploads them to GitHub Releases.

## License

MIT
