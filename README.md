# Screeps Dashboard

[中文](README.md) [English](README.en.md)

Screeps Dashboard 是一个基于 `Tauri 2 + Next.js 15` 的跨平台客户端，用于查看 Screeps 账号数据与公开世界数据。项目以桌面端体验为优先，同时提供 Android 构建脚本。

## 功能概览

- 账号登录：支持密码登录（自动换取 token）或直接使用 token。
- 端点兼容：自动探测可用 API 端点，提升官方服和私服兼容性。
- 个人仪表盘（`/user`）：账号资源、GCL/GPL、CPU/MEM/Bucket、房间缩略图。
- 房间详情（`/user/room?name=...`）：地形、资源点、建筑统计、Creep 列表。
- 公共世界（`/rooms`）：公开房间检索/筛选/排序、地图统计、排行榜摘要。
- 排行榜（`/rankings`）：`global/season` 模式、维度切换、分页和过滤。
- 设置中心（`/settings`）：语言切换（`zh-CN` / `en-US`）、服务器与账号管理。
- 网络请求链路：优先走 Tauri Rust 命令 `screeps_request`，失败时回退浏览器 `fetch`。
- 控制台执行链路：桌面端优先走 Tauri Rust 命令 screeps_console_execute，仅在 Tauri 调用失败时回退浏览器请求。

## 技术栈

- 前端：Next.js 15、React 19、TypeScript、SWR、Zustand、Tailwind CSS 4
- 客户端壳：Tauri 2
- Rust 网络桥接：`reqwest`（`rustls-tls`）

## 目录结构

```text
ScreepsDashboard/
|-- src-next/                       # Next.js 前端
|   |-- app/                        # 路由页面
|   |-- components/                 # UI 组件
|   |-- lib/screeps/                # Screeps API 适配与数据逻辑
|   `-- stores/                     # Zustand 状态存储
|-- src-tauri/                      # Tauri + Rust
|   |-- src/lib.rs                  # screeps_request / screeps_console_execute 命令实现
|   `-- tauri.conf.json             # Tauri 配置
|-- scripts/
|-- package.json
|-- README.md
`-- README.en.md
```

## 环境要求

- Node.js 22 LTS（CI 使用 Node 22）
- npm 9+
- Rust stable（桌面构建 / `npm run check` 需要）
- Android 构建额外需要：
  - Android Studio（含 Android SDK / NDK）
  - Java 17
  - Rust targets：`aarch64-linux-android`、`armv7-linux-androideabi`

## 快速开始

### 1) 安装依赖

```bash
npm install
```

### 2) Web 开发模式

```bash
npm run dev
```

启动 Next.js 开发服务（实际目录为 `src-next/`）。

### 3) 桌面开发模式（Tauri）

```bash
npm run tauri:desktop:dev
```

## 常用命令

```bash
# Web
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck:web

# 质量检查（前端 + Rust）
npm run check

# 桌面端（Tauri）
npm run tauri:desktop:dev
npm run tauri:desktop:build

# Android（Tauri）
npm run tauri:android:init
npm run tauri:android:dev
npm run tauri:android:build:apk
npm run tauri:android:build:aab
```

## 构建说明

### Web 静态导出

```bash
npm run build
```

由于 `src-next/next.config.ts` 使用 `output: "export"`，构建产物会输出到 `src-next/out`，并由 Tauri 读取。

### 桌面发布包

```bash
npm run tauri:desktop:build
```

### Android 打包

```bash
npm run tauri:android:init
npm run tauri:android:build:apk
```

若初始化时报 `Android NDK not found`，请确认环境变量（Windows PowerShell）：

```powershell
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME="$env:ANDROID_HOME\ndk\<version>"
```

## 数据与安全说明

- 登录会话、服务器配置、账号配置、语言设置都通过 Zustand `persist` 写入 `localStorage`。
- 密码本身不会持久化保存；token 可能会被保存用于自动登录。
- 若是多人共用设备，建议不要勾选保存账号，或在使用后手动退出并清理浏览器/Tauri 本地数据。

## CI

CI 位于 `.github/workflows/ci.yml`，主要执行：

- `npm run lint`
- `npm run typecheck:web`
- `npm run rust:fmt:check`
- `npm run rust:clippy`
- `npm run build`

## Release

1. 交互式修改版本号：

```bash
npm run version
```

2. 交互式发版（运行后按提示输入版本号）：

```bash
npm run release
```

推送 `v*` tag 后会触发 `.github/workflows/release.yml`，自动构建 Windows/macOS/Linux 桌面安装包、Android APK/AAB，并尝试构建 iOS 包（best effort），然后上传到 GitHub Release。

## License

MIT
