const tls = require('tls');
const mockttp = require('mockttp');
const fs = require('fs');
const zlib = require('zlib');
const { EventEmitter } = require('events');
const { getOrCreateCA, getAndroidSystemCertFilename, CA_CERT_PATH, CA_CRT_PATH } = require('./cert-manager');
const ruleManager = require('./rule-manager');
const settingsManager = require('./settings-manager');
const { isBufferHeic, convertHeicToJpeg } = require('./heic-converter');
const { isProtobufContentType, decodeProtobuf } = require('./protobuf-parser');

// Electron 内置 BoringSSL 不支持 OpenSSL 的 @SECLEVEL=0 及 ffdhe* 曲线；
// 当 mockttp 开启 ignoreHostHttpsErrors: true 时会注入 @SECLEVEL=0，导致 BoringSSL 报 OPENSSL_internal:INVALID_COMMAND (500)。
if (process.versions.electron && !tls.__hqBoringSslPatched) {
  tls.__hqBoringSslPatched = true;
  const sanitizeBoringSslTlsOptions = (options) => {
    if (!options || typeof options !== 'object') return options;
    let patched = options;
    if (typeof options.ciphers === 'string' && options.ciphers.includes('@SECLEVEL=')) {
      const cleaned = options.ciphers.replace(/(^|:)@SECLEVEL=\d+/g, '').replace(/^:/, '');
      patched = { ...patched, ciphers: cleaned || undefined };
    }
    if (typeof options.ecdhCurve === 'string' && /ffdhe\d+/i.test(options.ecdhCurve)) {
      const cleanedCurve = options.ecdhCurve.split(':').filter(c => !/^ffdhe\d+$/i.test(c)).join(':');
      patched = { ...patched, ecdhCurve: cleanedCurve || undefined };
    }
    return patched;
  };
  const origCreateSecureContext = tls.createSecureContext;
  tls.createSecureContext = function (options, ...rest) {
    return origCreateSecureContext.call(this, sanitizeBoringSslTlsOptions(options), ...rest);
  };
  const origTlsConnect = tls.connect;
  tls.connect = function (...args) {
    if (args[0] && typeof args[0] === 'object') {
      args[0] = sanitizeBoringSslTlsOptions(args[0]);
    } else if (args[1] && typeof args[1] === 'object') {
      args[1] = sanitizeBoringSslTlsOptions(args[1]);
    }
    return origTlsConnect.apply(this, args);
  };
}

/**
 * 检验字符串是否为人类可读的合法纯文本（排除加密密文与乱码二进制）
 */
function isPrintableText(text) {
  if (!text || typeof text !== 'string') return false;
  if (text.length === 0) return true;
  const sample = text.slice(0, 2000);
  let printableCount = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    // 允许常见空白与控制符: \t(9), \n(10), \r(13)
    if (code === 9 || code === 10 || code === 13) {
      printableCount++;
    } else if (code >= 32 && code !== 65533) {
      // 65533 是 UTF-8 替换符 \uFFFD (乱码特征)
      printableCount++;
    }
  }
  return (printableCount / sample.length) >= 0.95;
}

/**
 * 检测请求或响应是否属于应用层二次加密协议（如小川在线 XiaoChuan XCP、AES 等）
 */
function isAppLayerEncryptedPayload(headers = {}, buffer, isProtobufType = false) {
  const h = headers || {};
  const hasXcProto = !!(h['x-xc-proto-req'] || h['X-Xc-Proto-Req'] || h['x-xc-proto-res'] || h['X-Xc-Proto-Res']);
  const ct = (h['content-type'] || h['Content-Type'] || '').toLowerCase();
  const isXcp = ct.includes('application/xcp') || ct.includes('/xcp');

  if (hasXcProto || isXcp) {
    return {
      encrypted: true,
      protocol: 'XiaoChuan XCP (AES)',
      reason: hasXcProto ? '检测到 x-xc-proto 动态密钥协商请求头' : 'Content-Type 声明为 application/xcp 私有加密协议'
    };
  }

  // 若 buffer 长度大于 0 且为 16 字节对齐，且具有高熵特征/非可打印字符
  if (buffer && buffer.length >= 16 && buffer.length % 16 === 0 && isProtobufType) {
    return {
      encrypted: true,
      protocol: 'AES-128/256 分组密文',
      reason: `数据长度为 ${buffer.length} 字节 (16 字节块对齐)，符合 AES 分组加密特征`
    };
  }

  return { encrypted: false };
}

/**
 * 智能解压缩二进制数据 (支持 gzip, deflate, br)
 * 支持通过 Content-Encoding 头识别与 Magic Bytes 魔数主动探测
 */
function decompressBufferIfNeeded(buffer, headers = {}) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return buffer;
  }

  const encoding = (headers['content-encoding'] || headers['Content-Encoding'] || '').toLowerCase().trim();

  // 1. 若根据头部显式声明了压缩编码
  if (encoding.includes('gzip')) {
    try {
      return zlib.gunzipSync(buffer);
    } catch (_) {}
  } else if (encoding.includes('br')) {
    try {
      return zlib.brotliDecompressSync(buffer);
    } catch (_) {}
  } else if (encoding.includes('deflate')) {
    try {
      return zlib.inflateSync(buffer);
    } catch (_) {
      try {
        return zlib.inflateRawSync(buffer);
      } catch (_) {}
    }
  }

  // 2. 头部缺失或不规范时，通过二进制魔数自动识别与兜底解压
  // Gzip 魔数: 0x1f 0x8b
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    try {
      return zlib.gunzipSync(buffer);
    } catch (_) {}
  }

  // Zlib Deflate 常见特征头: 0x78 0x01 / 0x78 0x9c / 0x78 0xda
  if (buffer.length >= 2 && buffer[0] === 0x78 && (buffer[1] === 0x01 || buffer[1] === 0x9c || buffer[1] === 0xda)) {
    try {
      return zlib.inflateSync(buffer);
    } catch (_) {}
  }

  return buffer;
}

/**
 * 提取并还原客户端请求的原始完整 URL
 * 当 App 或网络层（如 HttpDNS、网关调度、VPN Fake-IP 或直连代理）将请求目标重写为 IP 或代理端口时，
 * 借助 Host / :authority 请求头还原真实的原始域名和路径，确保抓包展示和 Mock 规则匹配完全保真。
 */
function getCanonicalUrl(req) {
  const headers = req.headers || {};
  const hostHeader = (headers['host'] || headers[':authority'] || '').trim();
  let protocol = req.protocol || (req.url && req.url.startsWith('https://') ? 'https' : 'http');
  if (headers[':scheme']) {
    protocol = headers[':scheme'];
  }

  const rawUrl = req.url || '';
  const rawPath = req.path || (rawUrl.startsWith('/') ? rawUrl : '');

  // 若无 Host 头，则退回原始 URL
  if (!hostHeader) {
    return rawUrl || rawPath || '/';
  }

  try {
    const parsed = new URL(rawUrl);
    const hostInUrl = parsed.host;
    // 判断 URL 中的 host 是否为 IP 地址或代理服务自身地址
    const isHostIp = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(hostInUrl) || /^\[.*\](:\d+)?$/.test(hostInUrl);
    const isProxyHost = hostInUrl.includes('127.0.0.1') || hostInUrl.includes('localhost') || /:(88\d{2}|89\d{2})/.test(hostInUrl);
    const isHeaderDomain = !/^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(hostHeader);

    // 如果 URL 中是 IP/内部代理地址，而 Header 中是真实业务域名，还原为真实域名 URL
    if ((isHostIp || isProxyHost) && isHeaderDomain) {
      return `${protocol}://${hostHeader}${parsed.pathname}${parsed.search}`;
    }

    return rawUrl;
  } catch (e) {
    // rawUrl 为相对路径（例如 /api/v1?query=1）
    const cleanPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    return `${protocol}://${hostHeader}${cleanPath}`;
  }
}

class ProxyServer extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.port = 8888;
    this.transactions = new Map(); // id -> transaction
    this.history = [];             // array of transaction ids
    this.maxHistory = 1500;
    this.bodyBuffers = new Map();  // id -> Buffer (LRU memory cache for images/videos/etc.)
    this.previewBuffers = new Map(); // id -> Buffer (LRU cache for converted preview e.g. HEIC -> JPEG)
    this.maxBufferCount = 200;
    this.isRecording = true;
    this._isApplyingRules = false;
    this._pendingApplyRules = false;
  }

  setBodyBuffer(id, buffer) {
    if (!buffer) return;
    if (this.bodyBuffers.has(id)) {
      this.bodyBuffers.delete(id);
    }
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
    if (this.previewBuffers.has(id)) {
      this.previewBuffers.delete(id);
    }
    this.previewBuffers.set(id, buffer);
    if (this.previewBuffers.size > this.maxBufferCount) {
      const oldestKey = this.previewBuffers.keys().next().value;
      this.previewBuffers.delete(oldestKey);
    }
  }

  getPreviewBuffer(id) {
    return this.previewBuffers.get(id) || null;
  }

  /**
   * 按目标 URL 在抓包历史事务中倒序查找最近一次返回 200 OK 的二进制 Buffer 缓存（供 304 协商缓存等场景自动复用）
   */
  findHistoricalBufferByUrl(url) {
    if (!url) return null;
    for (const [id, tx] of this.transactions.entries()) {
      if (tx.url === url && Number(tx.statusCode) === 200) {
        const buf = this.getBodyBuffer(id);
        if (buf && buf.length > 0) {
          return { buffer: buf, contentType: tx.responseHeaders?.['content-type'] };
        }
      }
    }
    return null;
  }

  async start(port = 8888) {
    this.port = port;
    const ca = await getOrCreateCA();

    this.server = mockttp.getLocal({
      https: ca,
      recordTraffic: true
    });

    await this.applyRules();

    let currentPort = port;
    const maxPort = port + 50;

    while (currentPort <= maxPort) {
      try {
        await this.server.start(currentPort);
        this.port = currentPort;
        if (currentPort !== port) {
          console.warn(`[ProxyServer] 默认代理端口 ${port} 已被占用，已自动递增切换至空闲端口: ${this.port}`);
        } else {
          console.log(`[ProxyServer] 代理内核已启动，监听端口: ${this.port}`);
        }
        break;
      } catch (err) {
        if (err.code === 'EADDRINUSE' || (err.message && err.message.includes('EADDRINUSE'))) {
          console.warn(`[ProxyServer] 代理端口 ${currentPort} 已被占用，尝试探测下一个端口 ${currentPort + 1}...`);
          currentPort++;
          if (currentPort > maxPort) {
            throw new Error(`无法找到可用的代理端口（已尝试 ${port} ~ ${maxPort}）: ${err.message}`);
          }
        } else {
          throw err;
        }
      }
    }

    // 监听规则变更，实时热重载生效
    ruleManager.on('rules-changed', async () => {
      console.log('[ProxyServer] 检测到 Mock 规则变动，正在重新应用...');
      await this.applyRules();
      this.emit('rules-applied', ruleManager.getRules());
    });

    return this.port;
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
        this.bodyBuffers.delete(removedId);
        this.previewBuffers.delete(removedId);
      }
    }
    return tx;
  }

  _setupEventListeners() {
    this.server.on('request', async (req) => {
      if (!this.isRecording) return;

      const tx = this._getOrCreateTransaction(req.id);
      const canonicalUrl = getCanonicalUrl(req);

      tx.method = req.method;
      tx.rawUrl = req.url;
      tx.url = canonicalUrl;
      try {
        const u = new URL(canonicalUrl);
        tx.path = (u.pathname || '/') + (u.search || '');
      } catch (e) {
        tx.path = req.path || req.url;
      }
      tx.httpVersion = req.httpVersion;
      tx.protocol = req.protocol || (canonicalUrl.startsWith('https://') ? 'https' : 'http');
      tx.clientIp = req.remoteIpAddress;
      tx.clientPort = req.remotePort;
      tx.requestHeaders = req.headers;

      const reqContentType = (req.headers['content-type'] || '').toLowerCase();
      const isReqProtobuf = isProtobufContentType(reqContentType);

      try {
        let reqBuffer = null;
        try {
          reqBuffer = await req.body.getDecodedBuffer();
        } catch (_) {}
        if (!reqBuffer || reqBuffer.length === 0) {
          try {
            reqBuffer = await req.body.asBuffer();
          } catch (_) {}
        }

        if (reqBuffer && reqBuffer.length > 0) {
          // 1. 优先智能解压缩请求体 (自动识别 gzip / deflate / br 及其魔数)
          const decompressedReq = decompressBufferIfNeeded(reqBuffer, req.headers);

          // 2. 核心：解压后优先探测是否为合法 JSON 或人类可读文本，是就直接展示！
          const text = decompressedReq.toString('utf8');
          let isJsonSuccess = false;
          let parsedJson = null;

          try {
            const trimmed = text.trim();
            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
              parsedJson = JSON.parse(trimmed);
              isJsonSuccess = true;
            }
          } catch (_) {}

          if (isJsonSuccess) {
            // 是合法的明文 JSON，直接格式化展示为 JSON
            tx.requestBody = JSON.stringify(parsedJson, null, 2);
            tx.requestIsJson = true;
            tx.isJson = true;
            tx.requestIsProtobuf = false;
            tx.isProtobuf = false;
            tx.requestIsAppEncrypted = false;
            tx.isAppEncrypted = false;
          } else if (isPrintableText(text)) {
            // 是可读字符串，直接展示为文本
            tx.requestBody = text;
            tx.requestIsProtobuf = false;
            tx.isProtobuf = false;
            tx.requestIsAppEncrypted = false;
            tx.isAppEncrypted = false;
          } else {
            // 3. 只有当解压后仍然是不可读的二进制时，才尝试 Protobuf 反编译或 AES 密文识别
            const pbResult = decodeProtobuf(decompressedReq);
            if (pbResult.success && Object.keys(pbResult.data || {}).length > 0) {
              tx.requestBody = pbResult.json;
              tx.requestIsProtobuf = true;
              tx.requestIsJson = true;
              tx.isProtobuf = true;
              if (pbResult.isGrpc) {
                tx.requestIsGrpc = true;
                tx.isGrpc = true;
              }
            } else {
              const cryptoInfo = isAppLayerEncryptedPayload(req.headers, decompressedReq, isReqProtobuf);
              tx.requestIsBinary = true;
              tx.requestBinarySize = decompressedReq.length;
              tx.requestBinaryHex = decompressedReq.toString('hex');
              tx.requestBody = ''; // 保持清空，不往正文区平铺大段 0x... 乱码十六进制

              if (cryptoInfo.encrypted) {
                tx.requestIsAppEncrypted = true;
                tx.isAppEncrypted = true;
                tx.requestBinaryType = 'aes';
                tx.requestBinaryProtocol = cryptoInfo.protocol;
                tx.requestBinaryReason = cryptoInfo.reason;
              } else if (isReqProtobuf) {
                tx.requestIsProtobuf = true;
                tx.requestBinaryType = 'protobuf';
                tx.requestBinaryError = pbResult.error;
              } else {
                tx.requestBinaryType = 'raw';
              }
            }
          }
        } else {
          tx.requestBody = '';
        }
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
      const isProtobuf = isProtobufContentType(contentType);
      const isUrlHeic = contentType.includes('image/heic') || contentType.includes('image/heif') || /\.(heic|heif)(\?|$)/i.test(urlLower);
      const isVideo = contentType.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv|avi)(\?|$)/i.test(urlLower);
      const isAudio = contentType.startsWith('audio/') || /\.(mp3|wav|ogg|aac|m4a)(\?|$)/i.test(urlLower);
      const isHtml = contentType.includes('text/html');
      const isJson = contentType.includes('json');

      try {
        let buffer = null;
        try {
          buffer = await res.body.getDecodedBuffer();
        } catch (_) {}
        if (!buffer || buffer.length === 0) {
          try {
            buffer = await res.body.asBuffer();
          } catch (_) {}
        }

        if (buffer && buffer.length > 0) {
          // 完整缓存原始二进制 Buffer
          this.setBodyBuffer(tx.id, buffer);

          // 1. 核心！优先进行智能解压缩（防范 Gzip / Brotli / Deflate 导致的乱码）
          const decompressedBuf = decompressBufferIfNeeded(buffer, res.headers);
          if (decompressedBuf !== buffer) {
            this.setBodyBuffer(tx.id, decompressedBuf);
          }

          // 2. 核心：解压后优先探测是否为合法 JSON 或人类可读文本，是就直接展示！
          const text = decompressedBuf.toString('utf8');
          let isJsonSuccess = false;
          let parsedJson = null;

          try {
            const trimmed = text.trim();
            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
              parsedJson = JSON.parse(trimmed);
              isJsonSuccess = true;
            }
          } catch (_) {}

          if (isJsonSuccess) {
            // 是合法的明文 JSON，直接格式化展示！
            tx.responseBody = JSON.stringify(parsedJson, null, 2);
            tx.isJson = true;
            tx.bodyType = 'json';
            tx.isProtobuf = false;
            tx.responseIsAppEncrypted = false;
            tx.isAppEncrypted = false;
          } else if (isPrintableText(text) && !isUrlHeic && !contentType.startsWith('image/') && !contentType.startsWith('video/') && !contentType.startsWith('audio/')) {
            // 是人类可读的纯文本 (HTML/JS/纯文本等)，直接展示！
            tx.responseBody = text;
            tx.bodyType = isHtml ? 'html' : (isJson ? 'json' : 'text');
            if (isHtml) tx.isHtml = true;
            tx.isProtobuf = false;
            tx.responseIsAppEncrypted = false;
            tx.isAppEncrypted = false;
          } else {
            // 3. 只有非可读文本（是纯二进制）时，才按多媒体 / Protobuf / AES 密文分支走
            const isHeic = isUrlHeic || isBufferHeic(decompressedBuf);
            const isImage = isHeic || contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|ico|avif|bmp)(\?|$)/i.test(urlLower);

            if (isHeic) {
              tx.isHeic = true;
              tx.isImage = true;
              tx.bodyType = 'image';

              try {
                const jpegBuffer = await convertHeicToJpeg(decompressedBuf);
                this.setPreviewBuffer(tx.id, jpegBuffer);
                tx.hasHeicPreview = true;
                tx.responseBody = `[HEIC 高清图像: 大小 ${decompressedBuf.length} 字节 (已转码 JPEG 预览)]`;
              } catch (convErr) {
                console.warn('[ProxyServer] HEIC 转换失败:', convErr.message);
                tx.hasHeicPreview = false;
                tx.responseBody = `[HEIC 图片: 大小 ${decompressedBuf.length} 字节]`;
              }
            } else if (isImage) {
              tx.isImage = true;
              tx.bodyType = 'image';
              tx.responseBody = `[图片内容: ${contentType || 'image'}, 大小: ${decompressedBuf.length} 字节]`;
            } else if (isVideo) {
              tx.isVideo = true;
              tx.bodyType = 'video';
              tx.responseBody = `[视频媒体: ${contentType || 'video'}, 大小: ${decompressedBuf.length} 字节]`;
            } else if (isAudio) {
              tx.isAudio = true;
              tx.bodyType = 'audio';
              tx.responseBody = `[音频内容: ${contentType || 'audio'}, 大小: ${decompressedBuf.length} 字节]`;
            } else {
              // 尝试 Protobuf 反编译
              const pbResult = decodeProtobuf(decompressedBuf);
              if (pbResult.success && Object.keys(pbResult.data || {}).length > 0) {
                tx.isProtobuf = true;
                tx.bodyType = 'protobuf';
                tx.responseBody = pbResult.json;
                tx.isJson = true;
                if (pbResult.isGrpc) {
                  tx.responseIsGrpc = true;
                  tx.isGrpc = true;
                }
              } else {
                const cryptoInfo = isAppLayerEncryptedPayload(res.headers, decompressedBuf, isProtobuf);
                tx.responseIsBinary = true;
                tx.responseBinarySize = decompressedBuf.length;
                tx.responseBinaryHex = decompressedBuf.toString('hex');
                tx.responseBody = ''; // 保持清空，不往正文区平铺大段 0x... 乱码十六进制
                tx.bodyType = 'binary';

                if (cryptoInfo.encrypted) {
                  tx.responseIsAppEncrypted = true;
                  tx.isAppEncrypted = true;
                  tx.responseBinaryType = 'aes';
                  tx.responseBinaryProtocol = cryptoInfo.protocol;
                  tx.responseBinaryReason = cryptoInfo.reason;
                } else if (isProtobuf) {
                  tx.responseIsProtobuf = true;
                  tx.responseBinaryType = 'protobuf';
                  tx.responseBinaryError = pbResult.error;
                } else {
                  tx.responseBinaryType = 'raw';
                }
              }
            }
          }
        } else {
          // 若 buffer 为空但状态码为 304，自动尝试从历史记录关联同 URL 之前的 200 数据补全
          if (Number(tx.statusCode) === 304) {
            tx.is304 = true;
            const hist = this.findHistoricalBufferByUrl(tx.url);
            if (hist && hist.buffer) {
              this.setBodyBuffer(tx.id, hist.buffer);
              tx.responseBody = hist.buffer.toString('utf8');
              tx.isCachedFromHistory = true;
            } else {
              tx.responseBody = '';
            }
          } else {
            tx.responseBody = '';
          }
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
      // 若该请求已经正常完成响应，直接忽略后续连接关闭引发的 abort，防止覆盖已完成的响应数据
      if (tx.completed) return;

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
    // 互斥锁保护：若当前已有规则重载任务在执行，标记排队并直接返回，避免多次并发 reset 导致在途网络请求崩溃
    if (this._isApplyingRules) {
      this._pendingApplyRules = true;
      return;
    }
    this._isApplyingRules = true;

    try {
      await this.server.reset();
      // mockttp.reset() 会清空所有事件监听器，因此 reset 后必须重新绑定
      this._setupEventListeners();

      const rules = ruleManager.getRules();
      const activeRules = rules.filter(r => r.enabled);

      let cachedPemContent = null;
      let cachedCrtContent = null;
      const getPemContent = () => {
        if (!cachedPemContent) {
          cachedPemContent = fs.readFileSync(CA_CERT_PATH);
        }
        return cachedPemContent;
      };
      const getCrtContent = () => {
        if (!cachedCrtContent) {
          cachedCrtContent = fs.readFileSync(CA_CRT_PATH);
        }
        return cachedCrtContent;
      };

      // 内置根证书下载路由（确保手机挂上代理后无论是访问 http://<IP>:8899/ca.pem 还是 http://hq.cert/ca.pem 都能直接秒下证书）
      await this.server.forGet().matching((req) => {
        const cleanPath = (req.path || '').split('?')[0];
        return cleanPath === '/ca.pem' || cleanPath === '/ca.cer';
      }).always().thenCallback(() => {
        return {
          statusCode: 200,
          headers: {
            'content-type': 'application/x-x509-ca-cert',
            'content-disposition': 'inline; filename="HQ-Network-Debug-CA.cer"'
          },
          body: getPemContent()
        };
      });

      await this.server.forGet().matching((req) => {
        const cleanPath = (req.path || '').split('?')[0];
        return cleanPath === '/ca.crt';
      }).always().thenCallback(() => {
        return {
          statusCode: 200,
          headers: {
            'content-type': 'application/x-x509-ca-cert',
            'content-disposition': 'attachment; filename="hq-ca.crt"'
          },
          body: getCrtContent()
        };
      });

      await this.server.forGet().matching((req) => {
        const cleanPath = (req.path || '').split('?')[0];
        return cleanPath === '/ca.0' || /^\/[0-9a-f]{8}\.0$/i.test(cleanPath);
      }).always().thenCallback(() => {
        const filename = getAndroidSystemCertFilename();
        return {
          statusCode: 200,
          headers: {
            'content-type': 'application/octet-stream',
            'content-disposition': `attachment; filename="${filename}"`
          },
          body: getPemContent()
        };
      });

      for (const rule of activeRules) {
        await this._registerSingleRule(rule);
      }

      // 透传配置：支持配置上游外部代理 (解决开启 VPN / 翻墙节点时直连失败或需要内网穿透的问题)
      const passThroughOpts = {
        ignoreHostHttpsErrors: true
      };

      const upstreamProxyUrl = settingsManager.getUpstreamProxyUrl();
      if (upstreamProxyUrl) {
        passThroughOpts.proxyConfig = {
          proxyUrl: upstreamProxyUrl,
          noProxy: settingsManager.getNoProxyList()
        };
        console.log(`[ProxyServer] 已挂载上游外部代理: ${upstreamProxyUrl}`);
      }

      // 默认兜底策略：使用 forUnmatchedRequest() 设置 FALLBACK 优先级透传，并忽略上游自签名证书错误，确保所有请求和 Mock 稳定工作
      await this.server.forUnmatchedRequest().thenPassThrough(passThroughOpts);
      console.log(`[ProxyServer] 已生效 ${activeRules.length} 条 Mock 规则，其余请求正常透传${upstreamProxyUrl ? ' (走上游代理: ' + upstreamProxyUrl + ')' : ''}`);
    } catch (err) {
      console.error('[ProxyServer] 应用规则时出错:', err);
    } finally {
      this._isApplyingRules = false;
      if (this._pendingApplyRules) {
        this._pendingApplyRules = false;
        // 异步触发排队的规则重载，避免递归与调用栈溢出
        setImmediate(() => {
          this.applyRules().catch(e => console.error('[ProxyServer] 执行排队应用规则时出错:', e));
        });
      }
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
        matchPredicate = (req) => {
          const canonical = getCanonicalUrl(req);
          return regex.test(canonical) || regex.test(req.url) || regex.test(req.path);
        };
      } catch (e) {
        console.error(`[ProxyServer] 正则语法错误: ${pattern}`, e.message);
        return;
      }
    } else if (matchType === 'contains') {
      matchPredicate = (req) => {
        const canonical = getCanonicalUrl(req);
        return canonical.includes(pattern) || req.url.includes(pattern) || (req.path && req.path.includes(pattern));
      };
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
        const canonical = getCanonicalUrl(req);
        try {
          const reqPath = new URL(canonical).pathname;
          if (reqPath === targetPath) return true;
        } catch (e) {}

        try {
          const reqPath = new URL(req.url).pathname;
          if (reqPath === targetPath) return true;
        } catch (e) {
          const reqPath = (req.path || '').split('?')[0];
          return reqPath === targetPath;
        }
        return false;
      };
    } else {
      // 'exact' 全量精确匹配
      // 支持带任意长 Query 参数的完整 URL 或 Path 匹配，自动兼容末尾斜杠与协议头差异
      const cleanPattern = pattern.replace(/\/+$/, '');
      const patternNoProtocol = cleanPattern.replace(/^https?:\/\//, '');
      const patternHasQuery = cleanPattern.includes('?');

      matchPredicate = (req) => {
        const canonical = getCanonicalUrl(req);
        const candidates = [canonical, req.url].filter(Boolean);

        for (const candidate of candidates) {
          const clean = candidate.replace(/\/+$/, '');
          if (clean === cleanPattern) return true;

          // 兼容忽略 http/https 协议头差异
          const cleanNoProtocol = clean.replace(/^https?:\/\//, '');
          if (cleanNoProtocol === patternNoProtocol) return true;

          // 若配置的 pattern 没有 Query，但请求带了 Query 参数，匹配其 Base URL
          if (!patternHasQuery) {
            const cleanBase = clean.split('?')[0];
            if (cleanBase === cleanPattern) return true;
            if (cleanBase.replace(/^https?:\/\//, '') === patternNoProtocol) return true;
          }
        }

        if (req.path && req.path.replace(/\/+$/, '') === cleanPattern) return true;
        if (!patternHasQuery && req.path && req.path.split('?')[0].replace(/\/+$/, '') === cleanPattern) return true;

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
      rule.response.statusCode ?? 200,
      rule.response.body || '',
      headers
    );
  }

  getTransactions(limit = 1500) {
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

  async setUpstreamProxy(config) {
    settingsManager.updateUpstreamProxy(config);
    if (this.server) {
      await this.applyRules();
    }
    return settingsManager.getUpstreamProxy();
  }

  async stop() {
    if (this.server) {
      await this.server.stop();
      console.log('[ProxyServer] 代理内核已停止');
    }
  }
}

module.exports = new ProxyServer();
