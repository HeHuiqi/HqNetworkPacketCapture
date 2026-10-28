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
