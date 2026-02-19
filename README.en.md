# Screeps Dashboard

[中文](README.md) [English](README.en.md)

Screeps Dashboard is a cross-platform client built with `Tauri 2 + Next.js 15` for viewing Screeps account data and public world data. The project is desktop-first and also includes Android build scripts.

## Features

- Authentication: sign in with password (exchange for token) or direct token login.
- Endpoint compatibility probing for better support across official and private Screeps servers.
- User dashboard (`/user`): resources, GCL/GPL, CPU/MEM/Bucket, owned-room thumbnails.
- Room detail (`/user/room?name=...`): terrain, resource points, structure summary, creep table.
- Public world panel (`/rooms`): room search/filter/sort, map stats, leaderboard snapshot.
- Rankings (`/rankings`): `global/season` modes, dimensions, pagination, filtering.
- Settings (`/settings`): language switch (`zh-CN` / `en-US`), server/account management.
- Request pipeline: Tauri Rust command `screeps_request` first, browser `fetch` fallback.

## Tech Stack

- Frontend: Next.js 15, React 19, TypeScript, SWR, Zustand, Tailwind CSS 4
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
|   |-- src/lib.rs                  # screeps_request implementation
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
```

If initialization fails with `Android NDK not found`, configure environment variables (Windows PowerShell):

```powershell
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME="$env:ANDROID_HOME\ndk\<version>"
```

## Data and Security Notes

- Session, server/account settings, and locale are persisted in `localStorage` through Zustand `persist`.
- Password itself is not persisted, but token may be persisted for auto-login.
- On shared devices, avoid saving accounts, and clear local data after use.

## CI

CI is defined in `.github/workflows/ci.yml` and runs:

- `npm run lint`
- `npm run typecheck:web`
- `npm run rust:fmt:check`
- `npm run rust:clippy`
- `npm run build`

## License

MIT
