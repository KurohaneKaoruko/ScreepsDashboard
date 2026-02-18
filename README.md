# Screeps Dashboard

一个专为 [Screeps](https://screeps.com/) 游戏玩家设计的桌面仪表盘应用。

## 功能特性

- **多服务器支持**: 支持 Screeps 官方服务器及私有服务器
- **用户信息**: 查看账户余额、CPU 配额、GCL 等级等资源数据
- **房间概览**: 列出所有拥有的房间，显示控制器等级和能量状态
- **数据统计**: 实时获取游戏内统计数据
- **桌面应用**: 原生桌面体验，支持窗口管理

## 技术栈

- **前端**: Next.js 15 + React 19 + TypeScript
- **样式**: TailwindCSS 4
- **状态管理**: Zustand
- **数据获取**: SWR
- **桌面框架**: Tauri 2

## 开发环境要求

- Node.js 18+
- Rust 1.70+
- Windows 10/11 (主要开发平台)

## 跨平台支持

本项目同时支持桌面端和移动端：

- **桌面端**: 原生桌面应用（Tauri），提供完整的 Windows 桌面体验
- **移动端**: 独立的移动端页面设计，针对移动设备优化

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
# 启动前端开发服务器
npm run dev

# 或使用 Tauri 开发模式 (同时启动前端和桌面应用)
npm run tauri dev
```

### 构建生产版本

```bash
npm run tauri build
```

## 项目结构

```
ScreepsDashboard/
├── src/                      # Next.js 前端源码
│   ├── app/                  # App Router 页面
│   │   ├── login/            # 登录页面
│   │   ├── user/             # 用户信息页面
│   │   ├── rooms/            # 房间列表页面
│   │   ├── logs/             # 日志页面
│   │   └── settings/         # 设置页面
│   ├── components/           # React 组件
│   ├── lib/screeps/          # Screeps API 封装
│   │   ├── endpoints.ts      # API 端点定义
│   │   ├── request.ts        # 请求封装
│   │   ├── types.ts          # 类型定义
│   │   └── dashboard.ts      # 仪表盘数据获取
│   └── stores/               # Zustand 状态管理
│       ├── auth-store.ts     # 认证状态
│       └── settings-store.ts # 设置状态
├── src-tauri/                # Tauri 后端源码
│   ├── src/                  # Rust 源码
│   ├── tauri.conf.json       # Tauri 配置
│   └── capabilities/         # 权限配置
└── package.json              # Node.js 依赖
```

## 使用说明

1. **首次启动**: 运行应用后，需要配置 Screeps 服务器信息
2. **登录**: 输入你的 Screeps API Token（可从游戏设置中获取）
3. **查看数据**: 登录后自动跳转到用户信息页面，显示你的游戏资源
4. **房间列表**: 在 rooms 页面查看所有房间的状态
5. **设置**: 可配置服务器地址和自动刷新间隔

## 获取 API Token

1. 登录 [Screeps](https://screeps.com/)
2. 进入 Settings（设置）
3. 点击 API Token 选项卡
4. 复制你的 API Token

## 配置私有服务器

在设置页面中，可以配置私有服务器的地址：

- **服务器地址**: 例如 `http://localhost:21025`
- **Token**: 私有服务器对应的 API Token

## 开发相关

- `npm run dev` - 启动 Next.js 开发服务器
- `npm run tauri dev` - 启动 Tauri 开发模式
- `npm run tauri build` - 构建生产版本
- `npm run lint` - 代码检查

## 许可证

MIT
