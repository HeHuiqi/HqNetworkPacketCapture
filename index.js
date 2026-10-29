// 智能过滤底层非致命网络断开日志（如手机滑动取消请求 aborted、后台私有长连接 ERR_SSL_WRONG_VERSION_NUMBER 等），保持控制台干净整洁
// 调试时可通过设置 DEBUG=1 环境变量开启完整输出
if (!process.env.DEBUG) {
  const IGNORED_PATTERNS = [
    'Failed to handle request: aborted',
    'Failed to handle request: socket hang up',
    "Can't calculate TLS fingerprint",
    'Unknown TLS error',
    'ERR_SSL_WRONG_VERSION_NUMBER',
    'wrong version number',
    'tls_validate_record_header'
  ];

  const shouldIgnore = (args) => {
    try {
      const fullText = args
        .map((arg) => {
          if (typeof arg === 'string') return arg;
          if (arg instanceof Error) return `${arg.name}: ${arg.message} ${arg.stack || ''} ${arg.code || ''}`;
          if (arg && typeof arg === 'object') {
            try { return JSON.stringify(arg); } catch { return String(arg); }
          }
          return String(arg);
        })
        .join(' ');

      return IGNORED_PATTERNS.some((pattern) => fullText.includes(pattern));
    } catch {
      return false;
    }
  };

  const origError = console.error;
  console.error = (...args) => {
    if (shouldIgnore(args)) return;
    origError.apply(console, args);
  };

  const origWarn = console.warn;
  console.warn = (...args) => {
    if (shouldIgnore(args)) return;
    origWarn.apply(console, args);
  };

  const origLog = console.log;
  console.log = (...args) => {
    if (shouldIgnore(args)) return;
    origLog.apply(console, args);
  };
}

const proxyServer = require('./src/proxy-server');
const webServer = require('./src/web-server');
const systemProxyManager = require('./src/system-proxy-manager');

const PROXY_PORT = parseInt(process.env.PROXY_PORT || '8888', 10);
const WEB_PORT = parseInt(process.env.WEB_PORT || '8899', 10);

async function main() {
  console.log('=====================================================');
  console.log('       HQ Network Packet Capture & Mock Proxy        ');
  console.log('=====================================================');

  try {
    // 1. 启动代理内核 (支持 HTTP / HTTPS MITM / HTTP/2)
    await proxyServer.start(PROXY_PORT);

    // 2. 启动 Web 控制台与管理服务
    webServer.start(WEB_PORT);

    const primaryIp = webServer.getLanIps()[0]?.ip || '127.0.0.1';
    console.log('-----------------------------------------------------');
    console.log(`[使用指南]`);
    console.log(` 1. 在电脑浏览器打开抓包控制台: http://localhost:${WEB_PORT}`);
    console.log(` 2. 手机连接同一局域网 Wi-Fi，配置 HTTP 代理:`);
    console.log(`    - 服务器 IP: ${primaryIp}`);
    console.log(`    - 端口号:    ${PROXY_PORT}`);
    console.log(` 3. 手机浏览器访问 http://${primaryIp}:${WEB_PORT}/ca.pem 下载并信任根证书`);
    console.log('=====================================================');
  } catch (err) {
    console.error('启动失败:', err);
    process.exit(1);
  }
}

// 优雅停机并自动恢复系统代理设置
async function shutdown() {
  console.log('\n正在停止服务...');
  systemProxyManager.restore();
  await proxyServer.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 当作为子进程/边车运行时，父进程退出会自动关闭 stdin 管道，触发安全停机
if (!process.stdin.isTTY) {
  process.stdin.resume();
  process.stdin.on('end', shutdown);
}

main();
