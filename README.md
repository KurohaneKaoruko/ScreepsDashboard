# Screeps Dashboard

Desktop-first Screeps dashboard built with Tauri 2, Next.js 15, React 19, and TypeScript.

## Current Scope

- Authenticated dashboard for account metrics and owned-room summaries (`/user`).
- Public leaderboard and map exploration without sign-in (`/rooms`).
- Login with either password or API token, with endpoint probing for server compatibility.
- Language settings with runtime switch (`zh-CN`, `en-US`).
- Tauri HTTP bridge with browser fallback request path.

## Runtime Architecture

- Frontend: Next.js App Router in `src-next/`, exported as static assets (`src-next/next.config.ts` uses `output: "export"`).
- Desktop shell: Tauri 2 loads `../src-next/out` (`src-tauri/tauri.conf.json` -> `frontendDist`).
- Network path:
  - Primary: Tauri command `screeps_request` (Rust + `reqwest`).
  - Fallback: Browser `fetch` from `src-next/lib/screeps/request.ts`.

## Tech Stack

- Next.js 15
- React 19
- TypeScript 5.8
- Zustand 5
- SWR 2
- Tailwind CSS 4 (with custom CSS variables/theme)
- Tauri 2 (Rust backend)

## Project Structure

```text
ScreepsDashboard/
|-- src-next/
|   |-- app/
|   |   |-- page.tsx            # Redirect to /user or /rooms
|   |   |-- login/page.tsx      # Login route
|   |   |-- user/page.tsx       # Authenticated dashboard route
|   |   |-- rooms/page.tsx      # Public rooms route
|   |   `-- settings/page.tsx   # Authenticated settings route
|   |-- components/
|   |-- lib/
|   |   |-- i18n/
|   |   `-- screeps/
|   `-- stores/
|-- src-tauri/
|   |-- src/lib.rs              # Tauri command implementation
|   `-- tauri.conf.json
|-- dev-docs/
|   |-- INDEX.md
|   |-- PLAN.md
|   |-- DEVELOPMENT.md
|   `-- adr/
`-- README.md
```

## Local Development

### Requirements

- Node.js 18+
- npm 9+
- Rust stable toolchain (for Tauri desktop mode)
- Android Studio + Android SDK + Android NDK (for Tauri Android mode)

### Commands

```bash
npm install
npm run dev                # Next.js dev server (project root: src-next)
npm run build              # Next.js static export to src-next/out
npm run tauri:desktop:dev  # Desktop dev mode
npm run tauri:desktop:build # Desktop production bundle
npm run lint         # Lint checks
npm run check        # Lint + typecheck + rustfmt + clippy
```

## Android Build

### Android Prerequisites

- Android SDK installed (usually under `%LOCALAPPDATA%\Android\Sdk` on Windows)
- Android NDK installed via Android Studio SDK Manager
- Java 17 (Android Studio bundled JBR is acceptable)
- Rust Android targets:
  - `aarch64-linux-android`
  - `armv7-linux-androideabi`

### Android Commands

```bash
npm run tauri:android:init       # Initialize Android target files
npm run tauri:android:dev        # Run on connected device/emulator
npm run tauri:android:build:apk  # Build APK outputs
npm run tauri:android:build:aab  # Build AAB outputs
```

If `tauri:android:init` fails with `Android NDK not found`, install NDK first and set:

```powershell
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME="$env:ANDROID_HOME\ndk\<version>"
```

## Current Security Notes

- `ScreepsSession` is persisted with Zustand `persist` to `localStorage` (`src-next/stores/auth-store.ts`).
- Passwords are not persisted; token can be persisted inside the session object.
- Migration strategy and tradeoffs are documented in `dev-docs/adr/ADR-003-auth-session-storage.md`.

## Documentation

Start with `dev-docs/INDEX.md` for active docs, ADRs, and archived reports.

## License

MIT
