const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');
const QRCode = require('qrcode');
const { CA_CERT_PATH, CA_CRT_PATH, getAndroidSystemCertFilename } = require('./cert-manager');
const ruleManager = require('./rule-manager');
const proxyServer = require('./proxy-server');
const systemProxyManager = require('./system-proxy-manager');

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

  start(port = 8899) {
    this.port = port;
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.static(path.resolve(__dirname, '../public')));
    this.app.use('/apks', express.static(path.resolve(__dirname, '../apks')));

    this._setupRoutes();

    this.server = http.createServer(this.app);
    this._setupWebSocket();

    this.server.listen(this.port, '0.0.0.0', () => {
      const primaryIp = this.getLanIps()[0]?.ip || '127.0.0.1';
      console.log(`[WebServer] Web 控制台已启动: http://localhost:${this.port}`);
      console.log(`[WebServer] 局域网访问地址: http://${primaryIp}:${this.port}`);
    });
  }

  _setupRoutes() {
    // 证书下载接口（使用 fs.readFileSync 读取，避免 Express sendFile 因 ~/.hqnetwork 隐藏目录拦截报 404）
    // iOS 专用：使用 inline + .cer 文件名，触发 iOS Safari 系统级“下载配置描述文件”弹窗
    const serveIosCert = (req, res) => {
      try {
        const certContent = fs.readFileSync(CA_CERT_PATH);
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
        const crtContent = fs.readFileSync(CA_CRT_PATH);
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
        const certContent = fs.readFileSync(CA_CERT_PATH);
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
        const { execSync } = require('child_process');
        if (process.platform === 'darwin') {
          execSync(`open "${CA_CERT_PATH}"`);
          res.json({ success: true, message: '已为您打开 Mac 钥匙串访问' });
        } else if (process.platform === 'win32') {
          execSync(`start "" "${CA_CRT_PATH}"`);
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
      const limit = parseInt(req.query.limit || 200, 10);
      res.json(proxyServer.getTransactions(limit));
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

    this.app.delete('/api/rules/:id', (req, res) => {
      const success = ruleManager.deleteRule(req.params.id);
      res.json({ success });
    });
  }

  _setupWebSocket() {
    this.wss = new WebSocket.Server({ server: this.server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      // 发送初始同步数据
      ws.send(JSON.stringify({
        type: 'init',
        data: {
          requests: proxyServer.getTransactions(100),
          rules: ruleManager.getRules(),
          isRecording: proxyServer.isRecording,
          proxyPort: proxyServer.port,
          webPort: this.port,
          lanIps: this.getLanIps(),
          systemProxy: systemProxyManager.getStatus()
        }
      }));
    });

    // 广播方法
    const broadcast = (type, data) => {
      if (!this.wss) return;
      const msg = JSON.stringify({ type, data });
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
