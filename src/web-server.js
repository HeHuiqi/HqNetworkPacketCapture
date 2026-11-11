const express = require('express');
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');
const QRCode = require('qrcode');
const { CA_CERT_PATH, CA_CRT_PATH, getAndroidSystemCertFilename } = require('./cert-manager');
const ruleManager = require('./rule-manager');
const settingsManager = require('./settings-manager');
const proxyServer = require('./proxy-server');
const socksServer = require('./socks-server');
const systemProxyManager = require('./system-proxy-manager');

/**
 * 原生发起无缓存的 HTTP/HTTPS GET 请求，用于为 304 协商缓存或丢失 Body 的图片/媒体资源自动回源补全预览
 */
function fetchUrlBuffer(urlStr, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const isHttps = u.protocol === 'https:';
      const client = isHttps ? https : http;

      const reqHeaders = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
        'Accept': '*/*',
        ...extraHeaders
      };
      // 必须剔除条件缓存头，确保对端服务器强制下发完整 200 二进制报文
      delete reqHeaders['if-none-match'];
      delete reqHeaders['if-modified-since'];

      const options = {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: (u.pathname || '/') + (u.search || ''),
        method: 'GET',
        headers: reqHeaders,
        rejectUnauthorized: false
      };

      const req = client.request(options, (res) => {
        // 重定向跟随 (301 / 302 / 307)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let nextUrl = res.headers.location;
          if (nextUrl.startsWith('/')) {
            nextUrl = `${u.protocol}//${u.host}${nextUrl}`;
          }
          return fetchUrlBuffer(nextUrl, extraHeaders).then(resolve).catch(reject);
        }

        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode,
            contentType: res.headers['content-type'] || 'image/png',
            buffer: buf
          });
        });
      });

      req.on('error', reject);
      req.setTimeout(8000, () => {
        req.destroy();
        reject(new Error('Fetch timeout'));
      });
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

class WebServer {
  constructor() {
    this.app = express();
    this.server = null;
    this.wss = null;
    this.port = 8899;
  }

  getLanIps() {
    const ifaces = os.networkInterfaces();
    const ips = [];
    for (const name in ifaces) {
      for (const item of ifaces[name]) {
        // 过滤掉内部回环地址与 169.254.x.x 链路本地无效地址
        if (item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.')) {
          ips.push({ name, ip: item.address });
        }
      }
    }
    return ips;
  }

  /**
   * 校验请求来源 Origin 是否受信任（严格限定本机回环与本机明确的网卡 IP，彻底防范局域网与跨站 CSRF 提权）
   */
  _isAllowedOrigin(originStr) {
    if (!originStr) return true;
    try {
      const u = new URL(originStr);
      const host = u.hostname.toLowerCase();
      // 允许本机回环地址
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
        return true;
      }
      // 仅允许当前设备明确分配的本机局域网网卡 IP（拒绝局域网其他非本机 IP 跨站访问）
      const lanIps = this.getLanIps().map(item => item.ip);
      if (lanIps.includes(host)) {
        return true;
      }
      // 仅允许安全受控的原生内嵌容器协议 (tauri, vscode-webview)，杜绝本地恶意 file: 网页跨域调用
      if (u.protocol === 'tauri:' || u.protocol === 'vscode-webview:') {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  start(port = 8899, host = process.env.WEB_HOST || '0.0.0.0') {
    return new Promise((resolve, reject) => {
      this.app.use(express.json({ limit: '500mb' }));
      this.app.use(express.urlencoded({ limit: '500mb', extended: true }));

      // 安全中间件：对 /api 路径做 CSRF / 恶意跨站 Origin 防护 (带 Referer try-catch 容错)
      this.app.use('/api', (req, res, next) => {
        let origin = req.headers.origin || null;
        if (!origin && req.headers.referer) {
          try {
            origin = new URL(req.headers.referer).origin;
          } catch (_) {
            origin = null;
          }
        }
        if (origin && !this._isAllowedOrigin(origin)) {
          console.warn(`[WebServer] 拦截未授权的跨站 API 请求: Origin=${origin}, Method=${req.method}, Path=${req.originalUrl}`);
          return res.status(403).json({ error: 'Forbidden: Cross-Origin Request Blocked' });
        }
        next();
      });

      this.app.use(express.static(path.resolve(__dirname, '../public')));
      this.app.use('/apks', express.static(path.resolve(__dirname, '../apks')));

      this._setupRoutes();

      let currentPort = port;
      const maxPort = port + 50;

      const tryListen = () => {
        this.port = currentPort;
        this.server = http.createServer(this.app);

        this.server.once('error', (err) => {
          if (err.code === 'EADDRINUSE' || (err.message && err.message.includes('EADDRINUSE'))) {
            console.warn(`[WebServer] Web 控制台端口 ${currentPort} 已被占用，尝试切换至下一个端口 ${currentPort + 1}...`);
            currentPort++;
            if (currentPort > maxPort) {
              return reject(new Error(`无法找到可用的 Web 控制台端口（已尝试 ${port} ~ ${maxPort}）: ${err.message}`));
            }
            tryListen();
          } else {
            reject(err);
          }
        });

        this.server.listen(this.port, host, () => {
          this._setupWebSocket();
          const primaryIp = this.getLanIps()[0]?.ip || '127.0.0.1';
          if (currentPort !== port) {
            console.warn(`[WebServer] 默认 Web 端口 ${port} 已被占用，已自动递增切换至空闲端口: ${this.port}`);
          }
          console.log(`[WebServer] Web 控制台已启动: http://localhost:${this.port}`);
          if (host === '0.0.0.0') {
            console.log(`[WebServer] 局域网访问地址: http://${primaryIp}:${this.port}`);
          } else {
            console.log(`[WebServer] 监听受限于本地地址: http://${host}:${this.port} (已开启本地回环保护)`);
          }
          resolve(this.port);
        });
      };

      tryListen();
    });
  }

  _setupRoutes() {
    // 内存缓存证书二进制 Buffer，避免重复从磁盘同步读取
    let cachedPemContent = null;
    let cachedCrtContent = null;
    const getPem = () => {
      if (!cachedPemContent) {
        cachedPemContent = fs.readFileSync(CA_CERT_PATH);
      }
      return cachedPemContent;
    };
    const getCrt = () => {
      if (!cachedCrtContent) {
        cachedCrtContent = fs.readFileSync(CA_CRT_PATH);
      }
      return cachedCrtContent;
    };

    // 证书下载接口（使用内存 Buffer 响应，避免 Express sendFile 因 ~/.hqnetwork 隐藏目录拦截报 404）
    // iOS 专用：使用 inline + .cer 文件名，触发 iOS Safari 系统级“下载配置描述文件”弹窗
    const serveIosCert = (req, res) => {
      try {
        const certContent = getPem();
        res.setHeader('Content-Type', 'application/x-x509-ca-cert');
        if (req.query.download === '1') {
          res.setHeader('Content-Disposition', 'attachment; filename="hq-ca.pem"');
        } else {
          res.setHeader('Content-Disposition', 'inline; filename="HQ-Network-Debug-CA.cer"');
        }
        res.send(certContent);
      } catch (err) {
        res.status(500).send('读取根证书失败: ' + err.message);
      }
    };

    this.app.get('/ca.pem', serveIosCert);
    this.app.get('/ca.cer', serveIosCert);

    // Android 专用：触发 .crt 证书附件下载，便于 Android 系统“从存储设备安装 CA 证书”识别
    this.app.get('/ca.crt', (req, res) => {
      try {
        const crtContent = getCrt();
        res.setHeader('Content-Type', 'application/x-x509-ca-cert');
        res.setHeader('Content-Disposition', 'attachment; filename="hq-ca.crt"');
        res.send(crtContent);
      } catch (err) {
        res.status(500).send('读取根证书失败: ' + err.message);
      }
    });

    // APK 文件下载专用接口（强制设置 application/vnd.android.package-archive 与 attachment，确保安卓浏览器和安装器正常下载）
    this.app.get('/apks/:name', (req, res, next) => {
      const filename = path.basename(req.params.name);
      let filePath = path.resolve(__dirname, '../apks', filename);
      if (!fs.existsSync(filePath)) {
        filePath = path.resolve(__dirname, '../public/apks', filename);
      }
      if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.sendFile(filePath);
      }
      next();
    });

    // Android 系统级根证书 (<subject_hash_old>.0，如 406a290f.0，供 VMOS 虚拟机或 Root 设备直接放入 /system/etc/security/cacerts/)
    const serveAndroidSystemCert = (req, res) => {
      try {
        const filename = getAndroidSystemCertFilename();
        const certContent = getPem();
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(certContent);
      } catch (err) {
        res.status(500).send('读取系统根证书失败: ' + err.message);
      }
    };

    this.app.get('/ca.0', serveAndroidSystemCert);
    this.app.get('/:hash.0', (req, res, next) => {
      if (/^[0-9a-f]{8}$/i.test(req.params.hash)) {
        return serveAndroidSystemCert(req, res);
      }
      next();
    });

    // 证书路径与快捷调起
    this.app.get('/api/cert/info', (req, res) => {
      res.json({
        certPath: CA_CERT_PATH,
        crtPath: CA_CRT_PATH,
        platform: process.platform
      });
    });

    this.app.post('/api/cert/open-keychain', (req, res) => {
      try {
        const { execFileSync } = require('child_process');
        if (process.platform === 'darwin') {
          execFileSync('open', [CA_CERT_PATH]);
          res.json({ success: true, message: '已为您打开 Mac 钥匙串访问' });
        } else if (process.platform === 'win32') {
          execFileSync('cmd.exe', ['/c', 'start', '', CA_CRT_PATH]);
          res.json({ success: true, message: '已为您调起 Windows 证书导入向导' });
        } else {
          res.json({ success: false, message: '请手动下载并安装证书' });
        }
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 状态与局域网 IP
    this.app.get('/api/status', (req, res) => {
      const lanIps = this.getLanIps();
      res.json({
        proxyPort: proxyServer.port,
        socksPort: socksServer.port,
        webPort: this.port,
        lanIps,
        isRecording: proxyServer.isRecording,
        requestCount: proxyServer.transactions.size,
        rulesCount: ruleManager.getRules().length
      });
    });

    // 手机证书下载二维码生成（同时生成 iOS 与 Android 专属二维码）
    this.app.get('/api/qrcode', async (req, res) => {
      try {
        const lanIps = this.getLanIps();
        const host = req.query.ip || lanIps[0]?.ip || '127.0.0.1';
        const platform = req.query.platform === 'android' ? 'android' : 'ios';

        const iosCertUrl = `http://${host}:${this.port}/ca.pem`;
        const androidCertUrl = `http://${host}:${this.port}/ca.crt`;
        const systemCertFilename = getAndroidSystemCertFilename();

        const [iosQrDataUrl, androidQrDataUrl] = await Promise.all([
          QRCode.toDataURL(iosCertUrl, { width: 260, margin: 2 }),
          QRCode.toDataURL(androidCertUrl, { width: 260, margin: 2 })
        ]);

        res.json({
          certUrl: platform === 'android' ? androidCertUrl : iosCertUrl,
          qrDataUrl: platform === 'android' ? androidQrDataUrl : iosQrDataUrl,
          systemCertFilename,
          ios: {
            certUrl: iosCertUrl,
            qrDataUrl: iosQrDataUrl
          },
          android: {
            certUrl: androidCertUrl,
            qrDataUrl: androidQrDataUrl
          }
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // 请求列表与清除
    this.app.get('/api/requests', (req, res) => {
      const limit = parseInt(req.query.limit || 1500, 10);
      res.json(proxyServer.getTransactions(limit));
    });

    // 响应体原始数据/多媒体流接口（图片显示、视频播放、音频播放、原文件下载）
    this.app.get('/api/requests/:id/body', async (req, res) => {
      const tx = proxyServer.getTransaction(req.params.id);
      if (!tx) {
        return res.status(404).send('Not Found');
      }

      // 如果客户端请求预览图 (如 HEIC 自动生成的 JPEG 预览)
      if (req.query.preview === '1' || req.query.format === 'jpeg') {
        const previewBuf = proxyServer.getPreviewBuffer(tx.id);
        if (previewBuf) {
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Disposition', 'inline');
          res.setHeader('Content-Length', previewBuf.length);
          return res.end(previewBuf);
        }
      }

      let contentType = tx.responseHeaders?.['content-type'] || 'application/octet-stream';
      if (tx.isHeic && !contentType.includes('heic') && !contentType.includes('heif')) {
        contentType = 'image/heic';
      }

      let buffer = proxyServer.getBodyBuffer(tx.id);

      // 智能回源与历史缓存补齐：当命中 304 缓存或 Body 未捕获时，自动复用同 URL 历史 200 缓存或回源拉取
      if (!buffer && (Number(tx.statusCode) === 304 || tx.isImage || /\.(png|jpe?g|gif|webp|svg|ico|avif|bmp|heic|mp4|mov|mp3|js|mjs|css|json|txt|xml)(\?|$)/i.test(tx.url || ''))) {
        const hist = proxyServer.findHistoricalBufferByUrl(tx.url);
        if (hist) {
          buffer = hist.buffer;
          proxyServer.setBodyBuffer(tx.id, buffer);
          if (hist.contentType && (!contentType || contentType === 'application/octet-stream')) {
            contentType = hist.contentType;
          }
          if (!tx.responseBody) {
            tx.responseBody = buffer.toString('utf8');
          }
          tx.cachedFromHistory = true;
        } else if (tx.url && (tx.url.startsWith('http://') || tx.url.startsWith('https://'))) {
          try {
            const fetched = await fetchUrlBuffer(tx.url);
            if (fetched && fetched.buffer && fetched.buffer.length > 0) {
              buffer = fetched.buffer;
              proxyServer.setBodyBuffer(tx.id, buffer);
              if (fetched.contentType) {
                contentType = fetched.contentType;
              }
              if (!tx.responseBody) {
                tx.responseBody = buffer.toString('utf8');
              }
              tx.fetchedFallback = true;
            }
          } catch (e) {
            console.warn(`[WebServer] 自动回源补全 304 资源失败: ${tx.url} (${e.message})`);
          }
        }
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Disposition', 'inline');

      if (buffer) {
        // 支持 HTML 5 视频/音频拖动播放 (HTTP 206 Partial Content)
        if (req.headers.range) {
          const parts = req.headers.range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : buffer.length - 1;
          const chunksize = (end - start) + 1;
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${buffer.length}`);
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Content-Length', chunksize);
          return res.end(buffer.slice(start, end + 1));
        }

        res.setHeader('Content-Length', buffer.length);
        return res.end(buffer);
      } else if (tx.responseBody) {
        const textBuf = Buffer.from(tx.responseBody, 'utf8');
        res.setHeader('Content-Length', textBuf.length);
        return res.end(textBuf);
      } else {
        return res.status(204).end();
      }
    });

    // 专属预览图接口 (HEIC 优先返回转换后的 JPEG，兼容所有不支持 HEIC 的浏览器和环境)
    this.app.get('/api/requests/:id/preview-image', async (req, res) => {
      const tx = proxyServer.getTransaction(req.params.id);
      if (!tx) {
        return res.status(404).send('Not Found');
      }

      const previewBuf = proxyServer.getPreviewBuffer(tx.id);
      if (previewBuf) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Content-Length', previewBuf.length);
        return res.end(previewBuf);
      }

      let origBuf = proxyServer.getBodyBuffer(tx.id);
      if (!origBuf && (Number(tx.statusCode) === 304 || tx.isImage || /\.(png|jpe?g|gif|webp|svg|ico|avif|bmp|heic)(\?|$)/i.test(tx.url || ''))) {
        const hist = proxyServer.findHistoricalBufferByUrl(tx.url);
        if (hist) {
          origBuf = hist.buffer;
          proxyServer.setBodyBuffer(tx.id, origBuf);
        } else if (tx.url && (tx.url.startsWith('http://') || tx.url.startsWith('https://'))) {
          try {
            const fetched = await fetchUrlBuffer(tx.url);
            if (fetched && fetched.buffer && fetched.buffer.length > 0) {
              origBuf = fetched.buffer;
              proxyServer.setBodyBuffer(tx.id, origBuf);
            }
          } catch (_) {}
        }
      }

      if (origBuf) {
        let contentType = tx.responseHeaders?.['content-type'] || 'image/png';
        if (tx.isHeic) contentType = 'image/heic';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Content-Length', origBuf.length);
        return res.end(origBuf);
      }

      res.status(404).send('No image data');
    });

    this.app.delete('/api/requests', (req, res) => {
      proxyServer.clearHistory();
      res.json({ success: true });
    });

    // 录制开关
    this.app.post('/api/recording', (req, res) => {
      const { recording } = req.body;
      const state = proxyServer.setRecording(recording);
      res.json({ isRecording: state });
    });

    // Mock 规则管理 CRUD
    this.app.get('/api/rules', (req, res) => {
      res.json(ruleManager.getRules());
    });

    // 跨平台系统代理开关 (macOS / Windows / Linux)
    this.app.get('/api/system-proxy', (req, res) => {
      res.json(systemProxyManager.getStatus());
    });

    this.app.post('/api/system-proxy/toggle', (req, res) => {
      try {
        const enabled = systemProxyManager.toggle(proxyServer.port);
        const status = systemProxyManager.getStatus();
        if (typeof this.broadcast === 'function') {
          this.broadcast('system-proxy-changed', status);
        }
        res.json({ success: true, ...status });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    this.app.post('/api/rules', (req, res) => {
      try {
        const newRule = ruleManager.addRule(req.body);
        res.json({ success: true, rule: newRule });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });

    this.app.put('/api/rules/:id', (req, res) => {
      const updated = ruleManager.updateRule(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ error: '规则不存在' });
      }
      res.json({ success: true, rule: updated });
    });

    this.app.patch('/api/rules/:id/toggle', (req, res) => {
      const { enabled } = req.body;
      const rule = ruleManager.toggleRule(req.params.id, enabled);
      if (!rule) {
        return res.status(404).json({ error: '规则不存在' });
      }
      res.json({ success: true, rule });
    });

    this.app.delete('/api/rules', (req, res) => {
      const count = ruleManager.getRules().length;
      ruleManager.clearRules();
      res.json({ success: true, count });
    });

    this.app.delete('/api/rules/:id', (req, res) => {
      const success = ruleManager.deleteRule(req.params.id);
      res.json({ success });
    });

    // 获取上游外部代理配置 (用于解决开启 VPN / 翻墙节点时请求失败)
    this.app.get('/api/settings/upstream-proxy', (req, res) => {
      res.json({
        success: true,
        config: settingsManager.getUpstreamProxy(),
        proxyUrl: settingsManager.getUpstreamProxyUrl()
      });
    });

    // 保存并即刻生效上游外部代理配置
    this.app.post('/api/settings/upstream-proxy', async (req, res) => {
      try {
        const updated = await proxyServer.setUpstreamProxy(req.body);
        if (this.broadcast) {
          this.broadcast('upstream-proxy-updated', updated);
        }
        res.json({
          success: true,
          config: updated,
          proxyUrl: settingsManager.getUpstreamProxyUrl()
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // 测试上游代理端口连通性
    this.app.post('/api/settings/upstream-proxy/test', (req, res) => {
      const host = (req.body.host || '127.0.0.1').trim();
      const port = parseInt(req.body.port, 10);
      if (isNaN(port) || port <= 0 || port > 65535) {
        return res.status(400).json({ success: false, error: '无效的代理端口号' });
      }

      const startTime = Date.now();
      const socket = net.createConnection({ host, port, timeout: 1500 });

      socket.once('connect', () => {
        const latency = Date.now() - startTime;
        socket.destroy();
        res.json({
          success: true,
          latency,
          message: `连接成功 (耗时 ${latency}ms)`
        });
      });

      socket.once('timeout', () => {
        socket.destroy();
        res.json({
          success: false,
          error: `连接超时 (1500ms)，未检测到 ${host}:${port} 监听响应`
        });
      });

      socket.once('error', (err) => {
        socket.destroy();
        let msg = err.message;
        if (err.code === 'ECONNREFUSED') {
          msg = `连接被拒绝: 目标端口 ${port} 未运行任何代理服务`;
        }
        res.json({
          success: false,
          error: msg
        });
      });
    });
  }

  _setupWebSocket() {
    this.wss = new WebSocket.Server({
      server: this.server,
      path: '/ws',
      verifyClient: (info, callback) => {
        const origin = info.origin || info.req.headers.origin;
        if (!origin) return callback(true);
        if (this._isAllowedOrigin(origin)) {
          return callback(true);
        }
        console.warn(`[WebServer] 拦截未授权的跨站 WebSocket 连接: Origin=${origin}`);
        return callback(false, 403, 'Forbidden Origin');
      }
    });

    // 事务广播瘦身：仅剔除冗余 Base64 图片数据（图片由浏览器通过 HTTP 流式接口直接拉取），请求体与响应体保持完整数据不限制大小
    const slimTransactionForBroadcast = (tx) => {
      if (!tx || typeof tx !== 'object') return tx;
      const copy = { ...tx };
      if (copy.imageDataUrl) {
        delete copy.imageDataUrl;
      }
      return copy;
    };

    this.wss.on('connection', (ws) => {
      // 发送初始同步数据（经瘦身处理）
      ws.send(JSON.stringify({
        type: 'init',
        data: {
          requests: proxyServer.getTransactions(1500).map(slimTransactionForBroadcast),
          rules: ruleManager.getRules(),
          isRecording: proxyServer.isRecording,
          proxyPort: proxyServer.port,
          socksPort: socksServer.port,
          webPort: this.port,
          lanIps: this.getLanIps(),
          systemProxy: systemProxyManager.getStatus(),
          upstreamProxy: settingsManager.getUpstreamProxy()
        }
      }));
    });

    // 广播方法
    const broadcast = (type, data) => {
      if (!this.wss) return;
      const payloadData = (type === 'request' || type === 'response') ? slimTransactionForBroadcast(data) : data;
      const msg = JSON.stringify({ type, data: payloadData });
      this.wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg);
        }
      });
    };
    this.broadcast = broadcast;

    proxyServer.on('request-received', (tx) => {
      broadcast('request', tx);
    });

    proxyServer.on('response-received', (tx) => {
      broadcast('response', tx);
    });

    proxyServer.on('history-cleared', () => {
      broadcast('history-cleared', {});
    });

    proxyServer.on('recording-toggled', (isRecording) => {
      broadcast('recording-toggled', isRecording);
    });

    ruleManager.on('rules-changed', (rules) => {
      broadcast('rules-updated', rules);
    });
  }

  stop(callback) {
    if (this.wss) {
      try {
        this.wss.clients.forEach(client => {
          try { client.terminate(); } catch (_) {}
        });
        this.wss.close();
      } catch (_) {}
    }
    if (this.server) {
      this.server.close(callback);
    } else if (callback) {
      callback();
    }
  }
}

module.exports = new WebServer();
