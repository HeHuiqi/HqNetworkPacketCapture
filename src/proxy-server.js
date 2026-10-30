const mockttp = require('mockttp');
const fs = require('fs');
const { EventEmitter } = require('events');
const { getOrCreateCA, getAndroidSystemCertFilename, CA_CERT_PATH, CA_CRT_PATH } = require('./cert-manager');
const ruleManager = require('./rule-manager');
const { isBufferHeic, convertHeicToJpeg } = require('./heic-converter');

class ProxyServer extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.port = 8888;
    this.transactions = new Map(); // id -> transaction
    this.history = [];             // array of transaction ids
    this.maxHistory = 1000;
    this.bodyBuffers = new Map();  // id -> Buffer (LRU memory cache for images/videos/etc.)
    this.previewBuffers = new Map(); // id -> Buffer (LRU cache for converted preview e.g. HEIC -> JPEG)
    this.maxBufferCount = 200;
    this.isRecording = true;
  }

  setBodyBuffer(id, buffer) {
    if (!buffer) return;
    this.bodyBuffers.set(id, buffer);
    if (this.bodyBuffers.size > this.maxBufferCount) {
      const oldestKey = this.bodyBuffers.keys().next().value;
      this.bodyBuffers.delete(oldestKey);
    }
  }

  getBodyBuffer(id) {
    return this.bodyBuffers.get(id) || null;
  }

  setPreviewBuffer(id, buffer) {
    if (!buffer) return;
    this.previewBuffers.set(id, buffer);
    if (this.previewBuffers.size > this.maxBufferCount) {
      const oldestKey = this.previewBuffers.keys().next().value;
      this.previewBuffers.delete(oldestKey);
    }
  }

  getPreviewBuffer(id) {
    return this.previewBuffers.get(id) || null;
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

      const contentType = (res.headers['content-type'] || '').toLowerCase();
      const urlLower = (tx.url || '').toLowerCase();
      const isUrlHeic = contentType.includes('image/heic') || contentType.includes('image/heif') || /\.(heic|heif)(\?|$)/i.test(urlLower);
      const isVideo = contentType.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv|avi)(\?|$)/i.test(urlLower);
      const isAudio = contentType.startsWith('audio/') || /\.(mp3|wav|ogg|aac|m4a)(\?|$)/i.test(urlLower);
      const isHtml = contentType.includes('text/html');
      const isJson = contentType.includes('json');

      try {
        const buffer = await res.body.getDecodedBuffer();
        if (buffer && buffer.length > 0) {
          // 缓存 50MB 以内的二进制 Buffer，供网页端图片渲染、视频播放或原文件下载
          if (buffer.length <= 50 * 1024 * 1024) {
            this.setBodyBuffer(tx.id, buffer);
          }

          const isHeic = isUrlHeic || isBufferHeic(buffer);
          const isImage = isHeic || contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|ico|avif|bmp)(\?|$)/i.test(urlLower);

          if (isHeic) {
            tx.isHeic = true;
            tx.isImage = true;
            tx.bodyType = 'image';

            try {
              const jpegBuffer = await convertHeicToJpeg(buffer);
              this.setPreviewBuffer(tx.id, jpegBuffer);
              tx.hasHeicPreview = true;
              // 小于 1MB 的 JPEG 预览直接 Base64 秒渲染
              if (jpegBuffer.length <= 1024 * 1024) {
                tx.imageDataUrl = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
              }
              tx.responseBody = `[HEIC 高清图像: 大小 ${buffer.length} 字节 (已自动转码生成 JPEG 预览)]`;
            } catch (convErr) {
              console.warn('[ProxyServer] HEIC 转换失败:', convErr.message);
              tx.hasHeicPreview = false;
              tx.responseBody = `[HEIC 图片: 大小 ${buffer.length} 字节]`;
            }
          } else if (isImage) {
            tx.isImage = true;
            tx.bodyType = 'image';
            // 小于 512KB 直接生成 Base64 DataURL，零延迟秒渲染
            if (buffer.length <= 512 * 1024) {
              const mime = contentType.startsWith('image/') ? contentType.split(';')[0] : 'image/png';
              tx.imageDataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
            }
            tx.responseBody = `[图片内容: ${contentType || 'image'}, 大小: ${buffer.length} 字节]`;
          } else if (isVideo) {
            tx.isVideo = true;
            tx.bodyType = 'video';
            tx.responseBody = `[视频媒体: ${contentType || 'video'}, 大小: ${buffer.length} 字节]`;
          } else if (isAudio) {
            tx.isAudio = true;
            tx.bodyType = 'audio';
            tx.responseBody = `[音频内容: ${contentType || 'audio'}, 大小: ${buffer.length} 字节]`;
          } else if (isHtml) {
            tx.isHtml = true;
            tx.bodyType = 'html';
            tx.responseBody = buffer.toString('utf8');
          } else if (isJson) {
            tx.isJson = true;
            tx.bodyType = 'json';
            tx.responseBody = buffer.toString('utf8');
          } else {
            tx.responseBody = buffer.toString('utf8');
            tx.bodyType = 'text';
          }
        } else {
          tx.responseBody = '';
        }
      } catch (err) {
        tx.responseBody = `[无法读取响应体: ${err.message}]`;
      }

      this.emit('response-received', tx);
    });

    // 监听请求中断/挂起事件 (客户端取消请求或对端服务器断开 socket hang up)
    this.server.on('abort', async (req) => {
      if (!this.isRecording) return;

      const tx = this._getOrCreateTransaction(req.id);
      tx.statusCode = tx.statusCode || 502;
      tx.statusMessage = req.error?.message || 'Socket Hang Up / Aborted';
      tx.responseTime = Date.now();
      tx.duration = tx.requestTime ? (tx.responseTime - tx.requestTime) : 0;
      tx.completed = true;
      tx.responseBody = tx.responseBody || `[请求异常中断: ${req.error?.message || 'socket hang up (对端服务器或客户端断开连接)'}]`;

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

      // 默认兜底策略：使用 forUnmatchedRequest() 设置 FALLBACK 优先级透传，并忽略上游自签名证书错误，确保所有请求和 Mock 稳定工作
      await this.server.forUnmatchedRequest().thenPassThrough({
        ignoreHostHttpsErrors: true
      });
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
    this.bodyBuffers.clear();
    this.previewBuffers.clear();
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
