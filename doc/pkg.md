# 桌面客户端与分发方案指南 (Desktop & CLI Packaging Guide)

本文档针对 **HQ Network Packet Capture & MapLocal Mock** 项目，详细阐述将其打包分发为 macOS / Windows 桌面 App 或 NPM 全局 CLI 工具的三大主流技术方案。

---

## 目录
- [一、方案概览与三维对比](#一方案概览与三维对比)
- [二、方案 A：Tauri 边车方案 (超轻量 15~25MB)](#二方案-atauri-边车方案-超轻量-1525mb)
  - [1. 架构原理](#1-架构原理)
  - [2. 前置环境要求](#2-前置环境要求)
  - [3. 详细实施步骤](#3-详细实施步骤)
  - [4. Rust 端进程生命周期管理](#4-rust-端进程生命周期管理)
  - [5. 编译与产物输出](#5-编译与产物输出)
- [三、方案 B：Electron 方案 (开箱即用，免装 Rust)](#三方案-belectron-方案-开箱即用免装-rust)
  - [1. 架构原理](#1-架构原理-1)
  - [2. 详细实施步骤](#2-详细实施步骤)
  - [3. 主进程代码示例](#3-主进程代码示例)
  - [4. 打包脚本与产物](#4-打包脚本与产物)
- [四、方案 C：NPM 全局 CLI / npx 分发方案 (Whistle 模式，极力推荐)](#四方案-cnpm-全局-cli--npx-分发方案-whistle-模式极力推荐)
  - [1. 方案特点与优势](#1-方案特点与优势)
  - [2. 架构设计与实现步骤](#2-架构设计与实现步骤)
  - [3. CLI 启动脚本与命令行参数设计](#3-cli-启动脚本与命令行参数设计)
  - [4. 用户全局目录与持久化存储改造](#4-用户全局目录与持久化存储改造)
  - [5. 发布与一键使用](#5-发布与一键使用)
- [五、关键注意事项与避坑指南](#五关键注意事项与避坑指南)
- [六、选型决策指南](#六选型决策指南)

---

## 一、方案概览与三维对比

本项目包含 **Vue 3 现代化两栏前端** 与 **Node.js 抓包/代理内核（基于 Mockttp）**。目前业界主流有以下三种分发途径：

| 评估维度 | **方案 A：Tauri (Sidecar 边车)** | **方案 B：Electron (原生内嵌)** | **方案 C：NPM CLI (Whistle 模式)** |
| :--- | :--- | :--- | :--- |
| **安装包/分发体积** | **15 ~ 25 MB**（极小） | 80 ~ 120 MB（内置完整 Chromium） | **仅几 MB**（纯 JS 代码与静态资源） |
| **运行时内存** | **30 ~ 60 MB**（极省） | 150 ~ 300 MB | **40 ~ 70 MB**（仅 Node 进程与系统浏览器） |
| **构建依赖** | 需要安装 **Rust & Cargo** | 需安装 Electron 依赖包 | **零编译依赖**，只要电脑有 Node.js 即可 |
| **分发与更新机制** | 下载 `.dmg` / `.msi` 安装包覆盖 | 下载 `.dmg` / `.exe` 安装包覆盖 | **`npm update -g`** 或 **`npx` 秒级无感更新** |
| **使用体验** | 独立桌面窗口、Dock 独立图标 | 独立桌面窗口、Dock 独立图标 | 命令行一键启动，自动弹开浏览器 Web 控制台 |
| **业界标杆产品** | 现代化新兴代理工具 | Postman、Charles 原型、HTTP Toolkit | **Whistle (`w2 start`)**、**AnyProxy** |
| **适用场景** | 交付给非技术/测试人员的独立软件 | 快速出桌面安装包且不想装 Rust | **研发团队内部高效自用、前端与移动端调试** |

---

## 二、方案 A：Tauri 边车方案 (已完整落地实现)

### 1. 架构原理
Tauri 本身基于 Rust 开发，渲染层使用 macOS 原生 WebKit（免带 Chromium 浏览器外壳）。
为了让已有的 Node.js 抓包内核（依赖 modern ESM/CJS 混用生态及 mockttp）在没有安装 Node.js 的用户电脑上完全独立开箱即用，我们采用 **Tauri 边车 (Sidecar) 混合架构**：

1. **宿主层 (Rust)**：作为桌面原生 App 外壳，内置 WebKit 视图窗口，管理桌面窗口生命周期与进程安全；
2. **边车服务层 (Bundled Node Engine)**：将精简独立的 Node.js 运行时及抓包服务端 (`index.js`、`src/`、`node_modules/`、`public/`) 内嵌到 App 的 `Contents/Resources/backend/` 资源目录；
3. **健康探测与加载**：Tauri Rust 在 `setup` 钩子中以子进程拉起边车引擎，以 50ms 频率轮询探测 `127.0.0.1:8899`，服务就绪后无缝加载 WebKit 窗口；
4. **双重防残留停机机制**：
   - **机制 1 (Rust 信号通知)**：窗口关闭或 App 退出事件 (`CloseRequested` / `ExitRequested`) 触发时，Rust 发送 `SIGTERM` 并等待优雅停机；
   - **机制 2 (内核管道级安全锁)**：通过 `Stdio::piped()` 绑定标准输入。一旦父进程外壳退出或被强制杀死，操作系统内核自动断开 `stdin` 管道，Node.js 监听到 `stdin` 的 `end` 事件后自动执行 `systemProxyManager.restore()` 并安全停机，彻底杜绝孤儿进程或占用端口！
5. **持久化隔离**：根证书 CA 与 Mock 规则统一持久化存储在用户目录 `~/.hqnetwork/`，即使 App 位于 `/Applications` 只读权限目录也能正常读写，升级 App 永不丢失证书和规则。

```
+-------------------------------------------------------------+
|                  Tauri 桌面应用 (.dmg / .app)                 |
|                                                             |
|  +---------------------+        +-------------------------+ |
|  |   Rust 原生宿主      |  IPC   |     原生 WebKit 窗口     | |
|  |  (hq-network-debug) | <----> |   (Vue 3 现代化两栏界面)  | |
|  +----------+----------+        +------------+------------+ |
|             | 生命周期 / 管道监控              |             |
|             v                                |             |
|  +-------------------------------------------+-----------+  |
|  |       内嵌 Node.js 边车引擎 (Contents/Resources)        |  |
|  |  - Proxy Server (端口 8888, HTTPS MITM 拦截/Mock)      |  |
|  |  - Web Server & WS (端口 8899, 数据通信与控制台)        |  |
|  |  - 自动管理系统代理 & 证书存储 (~/.hqnetwork/)          |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
```

### 2. 构建与运行命令
项目已完整配置好 Tauri v2 脚本，可通过以下命令一键构建与调试：

```bash
# 1. 准备/同步后端代码与内嵌 Node 运行时
npm run tauri:prep

# 2. 本地开发调试 (自动拉起桌面窗口)
npm run tauri:dev

# 3. 生产打包 (一键生成 .app 与 .dmg 安装镜像)
npm run tauri:build
```

### 3. 生成的发布产物
构建完成后，产物已自动输出并整理至根目录：
- **DMG 安装镜像 (拖拽式安装)**：[`dist/HQ Network Debugger_1.0.0_aarch64.dmg`](file:///Users/edy/Desktop/1hhq/1AItools/HqNetworkPacketCapture/dist/HQ%20Network%20Debugger_1.0.0_aarch64.dmg)（约 **53.6 MB**）
- **macOS App 应用程序包**：[`src-tauri/target/release/bundle/macos/HQ Network Debugger.app`](file:///Users/edy/Desktop/1hhq/1AItools/HqNetworkPacketCapture/src-tauri/target/release/bundle/macos/HQ%20Network%20Debugger.app)（约 **155 MB**，解压即可运行）
|  +------------------------+      +------------------------+ |
|  |     Tauri 宿主窗口      |      |    Node.js 边车进程     | |
|  |     (macOS WebKit)     | <--> |  (编译后的独立二进制)    | |
|  |  运行 Vue 3 前端界面   |  WS  |   Mockttp 代理 + HTTP  | |
|  +------------------------+      +------------------------+ |
+-------------------------------------------------------------+
```

### 2. 前置环境要求
1. **安装 Rust 工具链**：
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source "$HOME/.cargo/env"
   ```
2. **检查安装成功**：
   ```bash
   rustc --version
   cargo --version
   ```

### 3. 详细实施步骤

#### 步骤 3.1：安装 Tauri CLI 与 Sidecar 打包工具
```bash
npm install -D @tauri-apps/cli @yao-pkg/pkg
```

#### 步骤 3.2：将 Node.js 后端编译为 Sidecar 二进制
Tauri 要求 Sidecar 文件名遵循 `[binary-name]-[target-triple]` 命名规则：

在 `package.json` 中配置脚本：
```json
"scripts": {
  "build:sidecar": "pkg index.js --target node18-macos-arm64 --output src-tauri/binaries/proxy-server-aarch64-apple-darwin"
}
```

#### 步骤 3.3：初始化 Tauri
```bash
npx tauri init
```
配置选项：
- **App name**: `HQ Packet Capture`
- **Window title**: `HQ Network Debugger & MapLocal Mock`
- **Web assets path**: `../public`
- **Dev server URL**: `http://localhost:8899`

#### 步骤 3.4：配置 `src-tauri/tauri.conf.json`
在配置文件中开启 `bundle.externalBin`：
```json
{
  "build": {
    "beforeBuildCommand": "npm run build:sidecar",
    "devPath": "http://localhost:8899",
    "distDir": "../public"
  },
  "tauri": {
    "bundle": {
      "active": true,
      "externalBin": [
        "binaries/proxy-server"
      ],
      "identifier": "com.hq.packetcapture"
    },
    "windows": [
      {
        "title": "HQ Network Debugger & MapLocal Mock",
        "width": 1280,
        "height": 820,
        "resizable": true
      }
    ]
  }
}
```

### 4. Rust 端进程生命周期管理
在 `src-tauri/src/main.rs` 中，随窗口自动拉起边车程序，并在主进程退出时强制清理：

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::api::process::{Command, CommandChild};
use tauri::{Manager, RunEvent};
use std::sync::Mutex;

struct AppState {
    child_process: Mutex<Option<CommandChild>>,
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            child_process: Mutex::new(None),
        })
        .setup(|app| {
            let (_rx, child) = Command::new_sidecar("proxy-server")
                .expect("无法初始化 proxy-server 边车进程")
                .spawn()
                .expect("启动 proxy-server 失败");

            let state = app.state::<AppState>();
            *state.child_process.lock().unwrap() = Some(child);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tauri 应用构建失败")
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                let state = app_handle.state::<AppState>();
                if let Some(child) = state.child_process.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
            _ => {}
        });
}
```

### 5. 编译与产物输出
```bash
npm run tauri build
```
生成的产物：
- macOS DMG 安装镜像：`src-tauri/target/release/bundle/dmg/HQ Packet Capture_1.0.0_aarch64.dmg`（约 18MB）
- macOS App 应用程序：`src-tauri/target/release/bundle/macos/HQ Packet Capture.app`

---

## 三、方案 B：Electron 方案 (开箱即用，免装 Rust)

### 1. 架构原理
Electron 原生内嵌了 Node.js 运行时和 Chromium。主进程可以直接 `require('./src/proxy-server')` 和 `require('./src/web-server')`，代码无需做任何二进制编译，100% 保持现状。

### 2. 详细实施步骤

#### 步骤 2.1：安装依赖
```bash
npm install -D electron electron-builder
```

#### 步骤 2.2：创建桌面主进程文件 `electron-main.js`
```javascript
const { app, BrowserWindow } = require('electron');
const proxyServer = require('./src/proxy-server');
const webServer = require('./src/web-server');

let mainWindow;

async function createWindow() {
  await proxyServer.start(8888);
  webServer.start(8899);

  mainWindow = new BrowserWindow({
    width: 1300,
    height: 850,
    minWidth: 1000,
    minHeight: 650,
    title: 'HQ Network Debugger & MapLocal Mock'
  });

  mainWindow.loadURL('http://localhost:8899');
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
  await proxyServer.stop();
  if (process.platform !== 'darwin') app.quit();
});
```

#### 步骤 2.3：配置 `package.json`
```json
{
  "main": "electron-main.js",
  "scripts": {
    "electron:dev": "electron .",
    "build:electron": "electron-builder --mac --arm64"
  },
  "build": {
    "appId": "com.hq.packetcapture",
    "productName": "HQ Packet Capture",
    "mac": {
      "target": ["dmg", "zip"]
    },
    "directories": {
      "output": "dist-electron"
    }
  }
}
```

#### 步骤 2.4：构建命令
```bash
npm run build:electron
```
产物将输出在 `dist-electron/` 目录下（体积约 90MB）。

---

## 四、方案 C：NPM 全局 CLI / npx 分发方案 (Whistle 模式，极力推荐)

这种方案是国内腾讯、阿里、字节等大厂前端与移动端抓包工具最常采用的分发模式（**Whistle、AnyProxy 均采用此方案**）。

### 1. 方案特点与优势
- **极速分发**：发布到 npm 仓库后，任何开发人员无需下载几十上百兆的安装包，直接一行命令跑起来：
  ```bash
  # 方式 1：免安装临时体验
  npx hq-proxy

  # 方式 2：全局安装为常用命令
  npm install -g hq-proxy
  hq-proxy start
  ```
- **跨平台 100% 兼容**：macOS、Windows、Linux 通用，无需区分 arm64 与 x64 架构。
- **免签名与公证**：完全避开 macOS 烦人的 Gatekeeper “未验证开发者证书”报错。
- **自动打开浏览器**：命令行敲击回车后，自动唤起默认浏览器打开 `http://localhost:8899`，并展示当前局域网 IP 与证书二维码。

---

### 2. 架构设计与实现步骤

#### 步骤 2.1：在 `package.json` 中配置 CLI `bin` 字段
在 `package.json` 中指定全局安装后注册的可执行命令名：
```json
{
  "name": "hq-proxy",
  "version": "1.0.0",
  "description": "Charles-like Packet Capture & MapLocal Mock Tool",
  "bin": {
    "hq-proxy": "./bin/cli.js"
  },
  "files": [
    "bin",
    "src",
    "public",
    "index.js"
  ],
  "preferGlobal": true
}
```

#### 步骤 2.2：编写 CLI 入口脚本 `bin/cli.js`
安装轻量级命令行参数解析与自动打开浏览器工具：
```bash
npm install commander open
```

新建 `bin/cli.js`：
```javascript
#!/usr/bin/env node

const { program } = require('commander');
const open = require('open');
const path = require('path');
const proxyServer = require('../src/proxy-server');
const webServer = require('../src/web-server');

program
  .name('hq-proxy')
  .description('高性能 HTTP/HTTPS 抓包与 Map Local Mock 调试代理工具')
  .version('1.0.0')
  .option('-p, --port <port>', '指定代理端口 (默认: 8888)', '8888')
  .option('-w, --web-port <port>', '指定 Web 控制台端口 (默认: 8899)', '8899')
  .option('-o, --open', '启动后自动打开浏览器控制台', true)
  .action(async (options) => {
    const proxyPort = parseInt(options.port, 10);
    const webPort = parseInt(options.webPort, 10);

    console.log('\n=====================================================');
    console.log('       HQ Network Packet Capture & Mock Proxy        ');
    console.log('=====================================================');

    try {
      await proxyServer.start(proxyPort);
      webServer.start(webPort);

      const primaryIp = webServer.getLanIps()[0]?.ip || '127.0.0.1';
      const webUrl = `http://localhost:${webPort}`;

      console.log('-----------------------------------------------------');
      console.log(`[控制台地址] ${webUrl}`);
      console.log(`[手机代理设置] ${primaryIp}:${proxyPort}`);
      console.log('=====================================================\n');

      if (options.open) {
        open(webUrl).catch(() => {});
      }
    } catch (err) {
      console.error('启动失败:', err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
```

#### 步骤 2.3：将 CA 证书与规则持久化改造为全局目录
当以 npm 全局命令运行时，用户可能在系统的任意文件夹启动 `hq-proxy`。
为了让**根证书（CA）**与**Mock 规则**全局共享、不因切换目录而丢失，需将存储路径重定向到用户家目录（`~/.hq-proxy/`）：

在 `src/cert-manager.js` 与 `src/rule-manager.js` 中调整路径：
```javascript
const os = require('os');
const path = require('path');

// 存储在 ~/.hq-proxy/ 中
const USER_HOME_DIR = path.join(os.homedir(), '.hq-proxy');
const CERT_DIR = path.join(USER_HOME_DIR, 'certs');
const DATA_DIR = path.join(USER_HOME_DIR, 'data');
```
这样设计后，用户手机只需扫码信任一次证书，无论之后在哪个项目路径下启动命令行，都无需再次信任！

---

### 3. 本地调试与发布步骤

#### 本地软链测试 (无需发布直接体验全局命令)
在当前项目根目录执行：
```bash
npm link
```
测试全局命令生效：
```bash
hq-proxy --help
hq-proxy -p 8888 -w 8899
```

#### 发布到 NPM 官方仓库或私有源 (Verdaccio)
1. 登录 npm 账号：
   ```bash
   npm login
   ```
2. 执行发布：
   ```bash
   npm publish
   ```
3. 团队成员即刻使用：
   ```bash
   # 全局安装
   npm install -g hq-proxy

   # 随时随地一条命令启动
   hq-proxy
   ```

---

## 五、关键注意事项与避坑指南

### 1. 证书与持久化路径 (UserData 目录)
- **无论采用哪种打包方案**，证书与配置数据切忌存放在只读临时目录；
- 桌面端（Tauri / Electron）使用操作系统分配的应用数据目录；
- NPM CLI 工具统一存放在用户家目录 `~/.hq-proxy/`。

### 2. 端口冲突自动检测
部分开发者可能同时运行其他调试工具（默认占用 `8888` 端口）。若端口被占用，应在终端与控制台给出明确错误提示，并引导使用 `-p 8889` 换端口启动。

### 3. PWA (渐进式应用)：NPM 方案的桌面化补充
使用 **方案 C (NPM)** 启动后，在 Chrome / Edge 打开 Web 控制台时，地址栏右侧会出现 **“安装应用”图标**，点击后即可将其一键作为独立窗口固定在 Mac 的 Dock 栏或 Windows 任务栏，**兼具桌面 App 的独立窗口体验与 CLI 的极速轻便**！

---

## 六、选型决策指南

```
你希望怎么使用这个工具？
  │
  ├── 目标用户是【纯技术研发团队/前端/移动端】：
  │     └── 🌟 推荐「方案 C：NPM 全局 CLI」 (最符合开发者习惯，维护零负担，类似 Whistle)
  │
  ├── 目标用户包含【测试人员/业务/非技术人员】，需要独立安装包：
  │     │
  │     ├── 电脑配有 Rust 环境，追求极致小体积 (15MB)：
  │     │     └── 🚀 推荐「方案 A：Tauri 边车打包」
  │     │
  │     └── 没有 Rust 环境，希望 5 分钟内快速产出 DMG：
  │           └── 📦 推荐「方案 B：Electron 快速打包」
```
