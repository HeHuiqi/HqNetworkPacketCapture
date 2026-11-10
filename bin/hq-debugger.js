#!/usr/bin/env node

/**
 * HQ Network Debugger - NPM 全局 CLI 方案C 入口
 * 支持:
 *   hq-debugger (前台运行并自动打开浏览器)
 *   hq-debugger start (启动)
 *   hq-debugger stop (停止后台/已运行实例)
 *   hq-debugger status (查看当前运行状态)
 *   hq-debugger restart (重启)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, spawn } = require('child_process');

const pkg = require('../package.json');
const proxyServer = require('../src/proxy-server');
const webServer = require('../src/web-server');
const systemProxyManager = require('../src/system-proxy-manager');

// 数据与 PID 保存目录
const BASE_DIR = process.env.HQ_DATA_DIR || path.join(os.homedir(), '.hqnetwork');
const PID_FILE = path.join(BASE_DIR, 'daemon.pid');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 跨平台自动打开默认浏览器
function openBrowser(url) {
  let cmd;
  switch (process.platform) {
    case 'darwin':
      cmd = `open "${url}"`;
      break;
    case 'win32':
      cmd = `start "" "${url}"`;
      break;
    default:
      cmd = `xdg-open "${url}"`;
      break;
  }
  exec(cmd, () => {});
}

// 检查 PID 是否仍在存活运行
function isPidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    command: 'start', // 'start' | 'stop' | 'status' | 'restart' | 'help' | 'version'
    proxyPort: parseInt(process.env.PROXY_PORT || '8888', 10),
    webPort: parseInt(process.env.WEB_PORT || '8899', 10),
    open: true,
    systemProxy: false,
    daemon: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'start' || arg === 'stop' || arg === 'status' || arg === 'restart') {
      options.command = arg;
    } else if (arg === '-v' || arg === '--version') {
      options.command = 'version';
    } else if (arg === '-h' || arg === '--help') {
      options.command = 'help';
    } else if (arg === '-p' || arg === '--port' || arg === '--proxy-port') {
      const p = parseInt(args[++i], 10);
      if (!isNaN(p)) options.proxyPort = p;
    } else if (arg === '-w' || arg === '--web-port') {
      const w = parseInt(args[++i], 10);
      if (!isNaN(w)) options.webPort = w;
    } else if (arg === '-s' || arg === '--system-proxy') {
      options.systemProxy = true;
    } else if (arg === '-o' || arg === '--open') {
      options.open = true;
    } else if (arg === '--no-open') {
      options.open = false;
    } else if (arg === '-d' || arg === '--daemon') {
      options.daemon = true;
    }
  }

  return options;
}

// 打印帮助信息
function printHelp() {
  console.log(`
HQ Network Debugger & MapLocal Mock Proxy (v${pkg.version})
使用方式:
  hq-debugger [命令] [参数]
  hqd [命令] [参数]

命令:
  start              启动抓包与 Mock 服务 (默认命令)
  stop               停止当前正在运行的服务
  restart            重启服务
  status             检查当前运行状态与端口
  -v, --version      查看当前版本号
  -h, --help         查看命令帮助说明

参数选项:
  -p, --port <port>      指定代理监听端口 (默认: 8888，被占用自动 +1 探测)
  -w, --web-port <port>  指定 Web 控制台端口 (默认: 8899，被占用自动 +1 探测)
  -s, --system-proxy     自动开启本机系统全局代理 (退出时自动还原)
  -o, --open             启动后在默认浏览器自动打开控制台 (默认开启)
  --no-open              不自动弹出浏览器窗口
  -d, --daemon           在后台静默运行 (守护进程模式)

示例:
  hqd                    # 最简启动，自动打开控制台
  hqd -s                 # 启动并自动设置本机系统网络代理
  hqd -p 9000 -w 9001    # 自定义代理端口为 9000，Web 端口为 9001
  hqd stop               # 停止正在运行的服务
`);
}

// 停止服务
async function stopService() {
  ensureDir(BASE_DIR);
  if (!fs.existsSync(PID_FILE)) {
    console.log('[ℹ] 未检测到正在运行的 HQ Network Debugger 实例 (PID 文件不存在)');
    return;
  }

  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
  if (isNaN(pid) || !isPidRunning(pid)) {
    console.log(`[ℹ] 实例进程 (PID: ${pid}) 已不在运行，清理失效的 PID 文件。`);
    try { fs.unlinkSync(PID_FILE); } catch (e) {}
    return;
  }

  console.log(`正在停止 HQ Network Debugger (PID: ${pid})...`);
  try {
    process.kill(pid, 'SIGTERM');
    // 等待进程退出
    let attempts = 0;
    while (isPidRunning(pid) && attempts < 15) {
      await new Promise(r => setTimeout(r, 200));
      attempts++;
    }
    if (isPidRunning(pid)) {
      process.kill(pid, 'SIGKILL');
    }
    try { fs.unlinkSync(PID_FILE); } catch (e) {}
    // 还原系统代理
    systemProxyManager.restore();
    console.log('[✔] HQ Network Debugger 已成功停止。');
  } catch (err) {
    console.error('[✕] 停止失败:', err.message);
  }
}

// 查询状态
function checkStatus() {
  ensureDir(BASE_DIR);
  if (!fs.existsSync(PID_FILE)) {
    console.log('[●] 状态: 未运行');
    return;
  }

  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
  if (isNaN(pid) || !isPidRunning(pid)) {
    console.log('[●] 状态: 未运行 (残留的旧进程已退出)');
    try { fs.unlinkSync(PID_FILE); } catch (e) {}
    return;
  }

  console.log(`[✔] 状态: 正常运行中 (PID: ${pid})`);
  console.log(`    运行数据目录: ${BASE_DIR}`);
}

// 启动主逻辑
async function startService(opts) {
  ensureDir(BASE_DIR);

  // 检查是否已有运行中的实例
  if (fs.existsSync(PID_FILE)) {
    const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (!isNaN(oldPid) && isPidRunning(oldPid)) {
      console.log(`[!] 检测到已有正在运行的实例 (PID: ${oldPid})`);
      console.log('    如需重启，请先运行: hqd stop 或 hqd restart');
      process.exit(1);
    }
  }

  // 记录当前 PID
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf-8');

  console.log('');
  console.log('\x1b[35m=====================================================\x1b[0m');
  console.log('\x1b[1m\x1b[36m       HQ Network Debugger & MapLocal Mock (CLI)     \x1b[0m');
  console.log('\x1b[35m=====================================================\x1b[0m');

  try {
    // 1. 启动代理内核 (支持被占用自动 +1 探测)
    const actualProxyPort = await proxyServer.start(opts.proxyPort);

    // 2. 启动 Web 控制台与 API 服务 (支持被占用自动 +1 探测)
    const actualWebPort = await webServer.start(opts.webPort);

    // 3. 是否开启本机系统代理
    if (opts.systemProxy) {
      console.log(`[系统代理] 正在设置本机系统代理指向 127.0.0.1:${actualProxyPort}...`);
      systemProxyManager.enable(actualProxyPort);
      console.log('\x1b[32m[✔] 本机系统代理已自动启用\x1b[0m');
    }

    const lanIps = webServer.getLanIps();
    const primaryIp = lanIps[0]?.ip || '127.0.0.1';
    const webUrl = `http://localhost:${actualWebPort}`;

    console.log('-----------------------------------------------------');
    console.log(`\x1b[32m[✔] 抓包代理端口 (Proxy) :\x1b[0m http://127.0.0.1:${actualProxyPort}`);
    console.log(`\x1b[32m[✔] Web 管理控制台 (Web)  :\x1b[0m \x1b[4m${webUrl}\x1b[0m`);
    console.log(`\x1b[32m[✔] 局域网接入地址 (LAN)  :\x1b[0m http://${primaryIp}:${actualProxyPort}`);
    console.log(`\x1b[32m[✔] 根证书快速下载 (CA)   :\x1b[0m http://${primaryIp}:${actualWebPort}/ca.pem`);
    console.log('-----------------------------------------------------');
    console.log(`[移动设备联调指引]`);
    console.log(` 1. 手机连接同一 Wi-Fi，配置 HTTP 代理为 ${primaryIp}:${actualProxyPort}`);
    console.log(` 2. 用手机浏览器打开 http://${primaryIp}:${actualWebPort}/ca.pem 下载并安装根证书`);
    console.log('-----------------------------------------------------');

    // 自动在默认浏览器打开控制台
    if (opts.open) {
      console.log(`[⚡] 正在浏览器打开控制台: ${webUrl}`);
      openBrowser(webUrl);
    }

    console.log('\x1b[90m(按 Ctrl+C 可停止运行并自动恢复网络设置)\x1b[0m');
    console.log('\x1b[35m=====================================================\x1b[0m\n');

    // 退出处理
    const cleanup = async () => {
      console.log('\n正在停止服务并还原系统设置...');
      try {
        if (opts.systemProxy) {
          systemProxyManager.restore();
          console.log('[✔] 本机系统代理已安全恢复');
        }
        try { fs.unlinkSync(PID_FILE); } catch (e) {}
        await proxyServer.stop();
        await webServer.stop();
      } catch (e) {}
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

  } catch (err) {
    console.error('\x1b[31m[✕] 服务启动失败:\x1b[0m', err);
    try { fs.unlinkSync(PID_FILE); } catch (e) {}
    process.exit(1);
  }
}

// 主入口分发
async function main() {
  const opts = parseArgs();

  switch (opts.command) {
    case 'version':
      console.log(`v${pkg.version}`);
      process.exit(0);
      break;

    case 'help':
      printHelp();
      process.exit(0);
      break;

    case 'stop':
      await stopService();
      break;

    case 'status':
      checkStatus();
      break;

    case 'restart':
      await stopService();
      await new Promise(r => setTimeout(r, 600));
      await startService(opts);
      break;

    case 'start':
    default:
      await startService(opts);
      break;
  }
}

main();
