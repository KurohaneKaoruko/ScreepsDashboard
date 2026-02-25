# Screeps Dashboard

[中文](README.md) [English](README.en.md)

Screeps Dashboard 是一个基于 `Tauri 2 + Next.js 15` 的跨平台客户端，用于查看 Screeps 账号数据与公开世界数据。项目桌面端优先，同时提供移动端版本。

## 功能概览

- 登录方式：支持账号密码登录（自动换取 token）、Token 登录、游客模式登录。
- 服务端兼容：自动探测可用 API 端点，提升官方服与私服兼容性。
- 用户页：显示 GCL/GPL、联盟、房间缩略图等。
- 公开用户查看：支持查看其他玩家公开数据；公开查看时会隐藏账户资源与 CPU/MEM 区块，并使用红色建筑缩略图。
- 资源页：按 shard 展示房间库存资源，支持 shard 折叠；当 shard 数大于 1 时提供“全部汇总”。
- 房间详情：查看指定房间地图与对象详情。
- 排行榜：支持维度切换、分页与筛选。
- 市场：查看资源订单与下单辅助。
- 消息与控制台：游客模式不可用，仅 Token 会话可用。
- 地图页：当前为占位页面（开发中）。
- 侧栏公开搜索：在已登录会话（含游客）下，可直接搜索用户名并跳转到用户页/资源页。
- 请求链路：优先使用 Tauri Rust 命令 `screeps_request`，失败后回退浏览器 `fetch`。
- 控制台执行链路：优先使用 Tauri Rust 命令 `screeps_console_execute`，失败后回退浏览器请求。

## 技术栈

- 前端：Next.js 15、React 19、TypeScript、SWR、Zustand
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
npm run tauri:android:build:all

# 多架构快捷打包
npm run package:all
npm run package:windows:all
npm run package:linux:all
npm run package:macos:universal
npm run package:android:all
```

## 构建说明

### Web 静态导出

```bash
npm run build
```

`src-next/next.config.ts` 使用 `output: "export"`，构建产物输出到 `src-next/out`，并由 Tauri 读取。

### 桌面发布包

```bash
npm run tauri:desktop:build
```

### Android 打包

```bash
npm run tauri:android:init
npm run tauri:android:build:apk
npm run tauri:android:build:all
```

若初始化时报 `Android NDK not found`，请确认环境变量（Windows PowerShell）：

```powershell
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME="$env:ANDROID_HOME\ndk\<version>"
```

## 数据与安全说明

- 登录会话、服务器配置、账号配置、语言与界面设置通过 Zustand `persist` 写入 `localStorage`。
- 已保存账号会按模式保存凭据：Token 模式保存 token；密码模式会保存用户名与密码。
- 登录页临时输入的密码不会自动持久化；只有在设置里添加为“密码模式账号”时才会保存。
- 多人共用设备时，建议不要保存账号，或在使用后手动退出并清理本地数据。

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

2. 交互式发版：

```bash
npm run release
```

推送 `v*` tag 后会触发 `.github/workflows/release.yml`，自动构建 Windows/macOS/Linux 桌面安装包、Android APK/AAB，并尝试构建 iOS 包（best effort），然后上传到 GitHub Release。

## License

MIT
