const mockttp = require('mockttp');
const fs = require('fs');
const { EventEmitter } = require('events');
const { getOrCreateCA, getAndroidSystemCertFilename, CA_CERT_PATH, CA_CRT_PATH } = require('./cert-manager');
const ruleManager = require('./rule-manager');

class ProxyServer extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.port = 8888;
    this.transactions = new Map(); // id -> transaction
    this.history = [];             // array of transaction ids
    this.maxHistory = 1000;
    this.isRecording = true;
  }

  async start(port = 8888) {
    this.port = port;
    const ca = await getOrCreateCA();

    this.server = mockttp.getLocal({
      https: ca,
      recordTraffic: true
    });

    await this.applyRules();

    await this.server.start(this.port);
    console.log(`[ProxyServer] 代理内核已启动，监听端口: ${this.port}`);

    // 监听规则变更，实时热重载生效
    ruleManager.on('rules-changed', async () => {
      console.log('[ProxyServer] 检测到 Mock 规则变动，正在重新应用...');
      await this.applyRules();
      this.emit('rules-applied', ruleManager.getRules());
    });
  }

  _getOrCreateTransaction(id) {
    let tx = this.transactions.get(id);
    if (!tx) {
      tx = {
        id,
        method: 'GET',
        url: '',
        path: '',
        httpVersion: '1.1',
        protocol: 'http',
        clientIp: '',
        clientPort: null,
        requestHeaders: {},
        requestBody: '',
        requestTime: Date.now(),
        statusCode: null,
        statusMessage: '',
        responseHeaders: {},
        responseBody: '',
        responseTime: null,
        duration: null,
        isMocked: false,
        mockRuleId: null,
        completed: false
      };
      this.transactions.set(id, tx);
      this.history.unshift(id);
      if (this.history.length > this.maxHistory) {
        const removedId = this.history.pop();
        this.transactions.delete(removedId);
      }
    }
    return tx;
  }

  _setupEventListeners() {
    this.server.on('request', async (req) => {
      if (!this.isRecording) return;

      const tx = this._getOrCreateTransaction(req.id);
      tx.method = req.method;
      tx.url = req.url;
      tx.path = req.path;
      tx.httpVersion = req.httpVersion;
      tx.protocol = req.protocol || (req.url.startsWith('https://') ? 'https' : 'http');
      tx.clientIp = req.remoteIpAddress;
      tx.clientPort = req.remotePort;
      tx.requestHeaders = req.headers;

      try {
        const bodyText = await req.body.getText();
        tx.requestBody = bodyText || '';
      } catch (err) {
        tx.requestBody = `[无法读取请求体: ${err.message}]`;
      }

      this.emit('request-received', tx);
    });

    this.server.on('response', async (res) => {
      if (!this.isRecording) return;

      const tx = this._getOrCreateTransaction(res.id);
      tx.statusCode = res.statusCode;
      tx.statusMessage = res.statusMessage || '';
      tx.responseHeaders = res.headers;
      tx.responseTime = Date.now();
      tx.duration = tx.requestTime ? (tx.responseTime - tx.requestTime) : 0;
      tx.completed = true;

      if (res.headers['x-mocked-by']) {
        tx.isMocked = true;
        tx.mockRuleId = res.headers['x-mock-rule-id'] || null;
      }

      try {
        const bodyText = await res.body.getText();
        tx.responseBody = bodyText || '';
      } catch (err) {
        tx.responseBody = `[无法读取响应体: ${err.message}]`;
      }

      this.emit('response-received', tx);
    });
  }

  async applyRules() {
    if (!this.server) return;

    try {
      await this.server.reset();
      // mockttp.reset() 会清空所有事件监听器，因此 reset 后必须重新绑定
      this._setupEventListeners();

      const rules = ruleManager.getRules();
      const activeRules = rules.filter(r => r.enabled);

      // 内置根证书下载路由（确保手机挂上代理后无论是访问 http://<IP>:8899/ca.pem 还是 http://hq.cert/ca.pem 都能直接秒下证书）
      await this.server.forGet().matching((req) => {
        const cleanPath = (req.path || '').split('?')[0];
        return cleanPath === '/ca.pem' || cleanPath === '/ca.cer';
      }).always().thenCallback(() => {
        const certContent = fs.readFileSync(CA_CERT_PATH);
        return {
          statusCode: 200,
          headers: {
            'content-type': 'application/x-x509-ca-cert',
            'content-disposition': 'inline; filename="HQ-Network-Debug-CA.cer"'
          },
          body: certContent
        };
      });

      await this.server.forGet().matching((req) => {
        const cleanPath = (req.path || '').split('?')[0];
        return cleanPath === '/ca.crt';
      }).always().thenCallback(() => {
        const crtContent = fs.readFileSync(CA_CRT_PATH);
        return {
          statusCode: 200,
          headers: {
            'content-type': 'application/x-x509-ca-cert',
            'content-disposition': 'attachment; filename="hq-ca.crt"'
          },
          body: crtContent
        };
      });

      await this.server.forGet().matching((req) => {
        const cleanPath = (req.path || '').split('?')[0];
        return cleanPath === '/ca.0' || /^\/[0-9a-f]{8}\.0$/i.test(cleanPath);
      }).always().thenCallback(() => {
        const filename = getAndroidSystemCertFilename();
        const certContent = fs.readFileSync(CA_CERT_PATH);
        return {
          statusCode: 200,
          headers: {
            'content-type': 'application/octet-stream',
            'content-disposition': `attachment; filename="${filename}"`
          },
          body: certContent
        };
      });

      for (const rule of activeRules) {
        await this._registerSingleRule(rule);
      }

      // 默认兜底策略：使用 forUnmatchedRequest() 设置 FALLBACK 优先级透传，确保所有 Mock 规则持久稳定生效
      await this.server.forUnmatchedRequest().thenPassThrough();
      console.log(`[ProxyServer] 已生效 ${activeRules.length} 条 Mock 规则，其余请求正常透传`);
    } catch (err) {
      console.error('[ProxyServer] 应用规则时出错:', err);
    }
  }

  async _registerSingleRule(rule) {
    const method = (rule.match.method || 'ALL').toUpperCase();
    const matchType = rule.match.matchType || 'exact';
    const pattern = (rule.match.pattern || '').trim();

    if (!pattern) return;

    let matchPredicate;

    if (matchType === 'regex') {
      try {
        const regex = new RegExp(pattern);
        matchPredicate = (req) => regex.test(req.url) || regex.test(req.path);
      } catch (e) {
        console.error(`[ProxyServer] 正则语法错误: ${pattern}`, e.message);
        return;
      }
    } else if (matchType === 'contains') {
      matchPredicate = (req) => req.url.includes(pattern) || (req.path && req.path.includes(pattern));
    } else if (matchType === 'path') {
      // 仅匹配路径（忽略域名与 Query 参数）
      let targetPath = pattern;
      try {
        if (pattern.startsWith('http://') || pattern.startsWith('https://')) {
          targetPath = new URL(pattern).pathname;
        } else {
          targetPath = pattern.split('?')[0];
        }
      } catch (e) {
        targetPath = pattern.split('?')[0];
      }
      if (!targetPath.startsWith('/')) targetPath = '/' + targetPath;

      matchPredicate = (req) => {
        try {
          const reqPath = new URL(req.url).pathname;
          return reqPath === targetPath;
        } catch (e) {
          const reqPath = (req.path || '').split('?')[0];
          return reqPath === targetPath;
        }
      };
    } else {
      // 'exact' 全量精确匹配
      // 支持带任意长 Query 参数的完整 URL 或 Path 匹配，自动兼容末尾斜杠与协议头差异
      const cleanPattern = pattern.replace(/\/+$/, '');
      const patternNoProtocol = cleanPattern.replace(/^https?:\/\//, '');
      const patternHasQuery = cleanPattern.includes('?');

      matchPredicate = (req) => {
        const reqUrlClean = (req.url || '').replace(/\/+$/, '');
        if (reqUrlClean === cleanPattern) return true;
        if (req.path && req.path.replace(/\/+$/, '') === cleanPattern) return true;

        // 兼容忽略 http/https 协议头差异
        const reqNoProtocol = reqUrlClean.replace(/^https?:\/\//, '');
        if (reqNoProtocol === patternNoProtocol) return true;

        // 如果用户配置的 pattern 没有写 Query 参数，但客户端请求带了 Query 参数（如随机时间戳、签名），同样精准匹配其 Base URL
        if (!patternHasQuery) {
          const reqUrlBase = reqUrlClean.split('?')[0];
          if (reqUrlBase === cleanPattern) return true;
          if (reqUrlBase.replace(/^https?:\/\//, '') === patternNoProtocol) return true;
          if (req.path && req.path.split('?')[0].replace(/\/+$/, '') === cleanPattern) return true;
        }

        return false;
      };
    }

    const headers = {
      ...(rule.response.headers || {}),
      'x-mocked-by': 'hq-maplocal',
      'x-mock-rule-id': rule.id
    };

    let builder;
    if (method === 'ALL') {
      builder = this.server.forAnyRequest();
    } else {
      const methodName = `for${method.charAt(0) + method.slice(1).toLowerCase()}`;
      if (typeof this.server[methodName] === 'function') {
        builder = this.server[methodName]();
      } else {
        builder = this.server.forAnyRequest();
      }
    }

    // 显式声明 .always()，确保该规则持久拦截所有后续请求（Mockttp 默认对自定义规则是 once/单次拦截模式）
    builder = builder.matching(matchPredicate).always();

    if (rule.response.delay && rule.response.delay > 0) {
      builder = builder.delay(rule.response.delay);
    }

    await builder.thenReply(
      rule.response.statusCode || 200,
      rule.response.body || '',
      headers
    );
  }

  getTransactions(limit = 100) {
    return this.history.slice(0, limit).map(id => this.transactions.get(id)).filter(Boolean);
  }

  getTransaction(id) {
    return this.transactions.get(id) || null;
  }

  clearHistory() {
    this.transactions.clear();
    this.history = [];
    this.emit('history-cleared');
  }

  setRecording(recording) {
    this.isRecording = !!recording;
    this.emit('recording-toggled', this.isRecording);
    return this.isRecording;
  }

  async stop() {
    if (this.server) {
      await this.server.stop();
      console.log('[ProxyServer] 代理内核已停止');
    }
  }
}

module.exports = new ProxyServer();
