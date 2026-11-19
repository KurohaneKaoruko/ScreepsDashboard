# Screeps Dashboard

[中文](README.md) [English](README.en.md)

Screeps Dashboard 是基于 `React 19 + Vite 7 + Tauri 2` 的跨平台面板，用于监控和管理 Screeps 房间。可独立部署为 Web 应用，也可打包为桌面和移动端客户端。

## 功能概览

- 登录方式：支持账号密码登录（自动换取 token）、Token 登录、游客模式登录。
- 服务端兼容：自动探测可用 API 端点，提升官方服与私服兼容性。
- 用户页：显示 GCL/GPL、联盟、房间缩略图等。
- 公开用户查看：支持查看其他玩家公开数据；公开查看时会隐藏账户资源与 CPU/MEM 区块，并使用红色建筑缩略图。
- 资源页：按 shard 展示房间库存资源，支持 shard 折叠；当 shard 数大于 1 时提供“全部汇总”。
- 房间工作台（`/rooms`）：同时监控多个房间，按分片、名称筛选及按库存能量/异常排序；支持多选比较、关注房间、单独刷新和暂停自动刷新。
- 资源明细：选中房间库存矩阵、跨房间汇总、搜索、CSV 导出；只统计建筑库存，避免将自然资源、掉落物和 Creep 携带资源混入储备。
- 建筑与单位明细：按类型和受损状态筛选，查看对象 ID、坐标、所有者、耐久、容量、逐资源库存、冷却、效果以及 Creep 身体部件和 TTL。
- 运行提醒：非己方单位、低孵化能量、受损建筑、仓库接近满载、控制器临近降级；失败房间保留旧快照并明确标记，不影响其他房间加载。
- 房间管理：批量切换自有 Rampart 公开通行、受击通知，以及创建工地；提交前逐项核对目标，提交后逐项显示结果。
- 房间详情：官方房间地图与总览、资源、建筑、单位、管理分页；保留 `#/rooms?name=W8N3&shard=shard0` 链接。
- 排行榜：支持维度切换、分页与筛选。
- 市场：查看资源订单与下单辅助。
- 消息与控制台：游客模式不可用，仅 Token 会话可用。
- 世界地图页：浏览世界地图，按所有者着色显示房间与 RCL，支持高速公路/新手区提示、悬浮信息、房间详情侧栏、玩家与自有房间列表、缩略图导航与图层开关；游客与匿名访问同样可用。
- 侧栏公开搜索：在已登录会话（含游客）下，可直接搜索用户名并跳转到用户页/资源页。
- 请求链路：优先使用 Tauri Rust 命令 `screeps_request`，失败后回退浏览器 `fetch`。
- 控制台执行链路：优先使用 Tauri Rust 命令 `screeps_console_execute`，失败后回退浏览器请求。
- 独立 Web 服务：内置同源 API 与 WebSocket 网关，支持官方服及白名单中的私服；提供 Docker 部署和 Web manifest。

## 技术栈

- 前端：React 19、Vite 7、TypeScript、React Router 7（HashRouter）、SWR、Zustand
- 客户端壳：Tauri 2
- Rust 网络桥接：`reqwest`（`rustls-tls`）
- Web 服务：Node.js 内置 HTTP/HTTPS，无运行时第三方服务端依赖

## 目录结构

```text
ScreepsDashboard/
|-- src-web/                       # React + Vite 前端
|   |-- src/routes.tsx             # 路由定义（HashRouter）
|   |-- src/pages/                 # 页面组件
|   |-- src/components/            # UI 组件
|   |-- src/lib/screeps/           # Screeps API 适配与数据逻辑
|   `-- src/stores/                # Zustand 状态存储
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
- pnpm 10（通过项目 `packageManager` 固定版本，可用 `corepack enable` 启用）
- Rust stable（桌面构建 / `npm run check` 需要）
- Android 构建额外需要：
  - Android Studio（含 Android SDK / NDK）
  - Java 17
  - Rust targets：`aarch64-linux-android`、`armv7-linux-androideabi`

## 快速开始

### 1) 安装依赖

```bash
corepack enable
pnpm install --frozen-lockfile
```

### 2) Web 开发模式

```bash
pnpm dev:web
```

启动 Vite 开发服务（实际目录为 `src-web/`），自动提供同源网关，默认允许连接 `https://screeps.com`。私服需通过 `SCREEPS_ALLOWED_SERVERS` 配置，见下方部署说明。

### 3) 桌面开发模式（Tauri）

```bash
npm run tauri:desktop:dev
```

## 常用命令

```bash
# Web
pnpm dev:web
pnpm build:web
pnpm start:web
pnpm check:web
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e

# 原有前端 / Tauri 命令仍可使用
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

### 独立 Web 部署（推荐）

只需要 Node.js，无需 Rust、Tauri 或桌面运行环境：

从 [GitHub Releases](https://github.com/KurohaneKaoruko/ScreepsDashboard/releases) 下载 `ScreepsDashboard-*-web.tar.gz` 后，解压并在包目录运行 `node scripts/web/serve.mjs` 即可启动，无需安装依赖或重新构建。若从源码部署：

```bash
pnpm install --frozen-lockfile
pnpm build:web
pnpm start:web
```

访问 `http://127.0.0.1:8080/#/rooms`。默认监听本机；局域网或容器部署可设置 `HOST=0.0.0.0`，端口通过 `PORT` 调整。对外服务建议使用 HTTPS 反向代理，并转发 WebSocket Upgrade。

添加私服时，先在网关白名单中配置与登录页相同的服务器 URL，再在页面中登录。多个 URL 用逗号分隔，可带端口和路径前缀：

```bash
SCREEPS_ALLOWED_SERVERS="https://screeps.com,http://192.168.1.20:21025" HOST=0.0.0.0 PORT=8080 pnpm start:web
```

Windows PowerShell：

```powershell
$env:SCREEPS_ALLOWED_SERVERS="https://screeps.com,http://192.168.1.20:21025"
$env:HOST="0.0.0.0"
pnpm start:web
```

Web 服务在 `/_screeps/` 转发 API 与实时连接，浏览器不直接访问上游，解决官方服 CORS 和 HTTPS 页面连接 HTTP 私服的问题。网关只访问明确列出的服务器，不持久化或记录登录凭据，不跟随上游重定向。反向代理应保留原始 `Host`，并避免记录带实时连接 Token 的 URL。

桌面端继续优先使用 Tauri 网络桥接；内置 Web 网关不改变桌面构建方式。Web manifest 提供主屏幕入口，不提供离线游戏数据。

### Docker

```bash
docker compose up -d --build
```

访问 `http://localhost:8080`。私服可通过启动 Compose 时的 `SCREEPS_ALLOWED_SERVERS` 环境变量覆盖。容器中的 `localhost` 指向容器本身；私服在宿主机或其他容器时，请使用可达的宿主机地址或容器服务名。

### Web 静态导出

```bash
npm run build
```

`npm run build` 通过 Vite 构建（`src-web/vite.config.ts`），产物输出到 `src-web/dist`，并由 Tauri 读取。路由使用 HashRouter，无需服务端 SPA fallback。

也可将产物部署到纯静态站点根目录。此时默认直接连接 Screeps API，要求上游允许浏览器跨域请求；官方服建议使用上述内置 Web 服务。静态部署可通过 `web-config.json` 指定同源网关路径，例如 `{"gateway":"/_screeps/"}`。

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
- 关注列表按服务器和账号隔离，只保存房间名称与分片，不保存快照或额外凭据。
- 手动管理操作仅提交游戏意图，游戏在后续 tick 执行，仍受所有权、Token 权限、RCL 和游戏规则限制；Bot 逻辑可能覆盖手动设置。面板显示“已提交”不代表游戏已经执行成功。

## 测试

```bash
pnpm check:web                    # lint + TypeScript + 数据/网关测试 + Web 构建
pnpm exec playwright install chromium
pnpm test:e2e                     # 先运行 pnpm build:web
```

浏览器测试使用独立的临时浏览器上下文与本地测试服，覆盖多分片库存、建筑筛选、CSV 导出、操作确认、刷新失败、关注列表、中英文切换和手机导航，不连接真实游戏账号。

若已有 Chromium，可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm test:e2e`。截图与 trace 由 Playwright 输出到 `test-results/`，可通过 `PLAYWRIGHT_OUTPUT_DIR` 覆盖。

## CI

CI 位于 `.github/workflows/ci.yml`，主要执行：

- `npm run lint`
- `npm run typecheck:web`
- `npm run rust:fmt:check`
- `npm run rust:clippy`
- `npm run build`
- `pnpm test`（数据解析和 Web 网关）
- `pnpm test:e2e`（独立测试服上的浏览器操作）

## Release

1. 交互式修改版本号：

```bash
npm run version
```

2. 交互式发版：

```bash
npm run release
```

推送 `v*` tag 后会触发 `.github/workflows/release.yml`。GitHub Release 先上传独立 Web 部署包，再陆续上传 Windows/macOS/Linux 桌面安装包、Android APK/AAB 和尽力构建的 iOS 包。

## License

GPL-3.0

