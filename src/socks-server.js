const net = require('net');
const { EventEmitter } = require('events');

/**
 * 原生 SOCKS5 / SOCKS4 代理网桥服务
 * 
 * 作用：
 * 接收客户端发起的 SOCKS5 (或 SOCKS4) 连接请求，
 * 解析目标主机与端口后，向本地 HTTP 抓包代理发起 HTTP CONNECT 隧道请求，
 * 并在握手成功后与本地代理建立全双工管道。
 * 
 * 从而使客户端配置 SOCKS5 代理也能无缝享受：
 * 1. HTTPS MITM 动态证书解密与流量解析；
 * 2. Web 界面全量请求与响应捕获；
 * 3. Map Local Mock 规则拦截与篡改；
 * 4. 外部上游代理 (VPN / Clash) 链式转发。
 */
class SocksServer extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.port = 8889;
    this.httpProxyPort = 8888;
    this.activeSockets = new Set();
  }

  /**
   * 启动 SOCKS 代理网桥
   * @param {number} socksPort - 期望监听的 SOCKS5 端口（默认 8889）
   * @param {number} httpProxyPort - 本地运行的 HTTP 抓包代理端口（默认 8888）
   * @returns {Promise<number>} - 实际成功监听的端口号
   */
  start(socksPort = 8889, httpProxyPort = 8888) {
    this.httpProxyPort = httpProxyPort;

    return new Promise((resolve, reject) => {
      let currentPort = socksPort;
      const maxPort = socksPort + 50;

      const tryListen = () => {
        this.port = currentPort;
        const server = net.createServer((clientSocket) => {
          this._handleClientConnection(clientSocket);
        });

        server.once('error', (err) => {
          if (err.code === 'EADDRINUSE' || (err.message && err.message.includes('EADDRINUSE'))) {
            console.warn(`[SocksServer] SOCKS5 代理端口 ${currentPort} 已被占用，尝试探测下一个端口 ${currentPort + 1}...`);
            currentPort++;
            if (currentPort > maxPort) {
              return reject(new Error(`无法找到可用的 SOCKS5 代理端口（已尝试 ${socksPort} ~ ${maxPort}）: ${err.message}`));
            }
            tryListen();
          } else {
            reject(err);
          }
        });

        server.listen(this.port, '0.0.0.0', () => {
          this.server = server;
          if (currentPort !== socksPort) {
            console.warn(`[SocksServer] 默认 SOCKS5 代理端口 ${socksPort} 已被占用，已自动递增切换至空闲端口: ${this.port}`);
          } else {
            console.log(`[SocksServer] SOCKS5 代理网桥已启动，监听端口: ${this.port} (转发至 HTTP 代理 :${this.httpProxyPort})`);
          }
          resolve(this.port);
        });
      };

      tryListen();
    });
  }

  /**
   * 处理客户端接入的 Socket
   */
  _handleClientConnection(clientSocket) {
    this.activeSockets.add(clientSocket);
    clientSocket.once('close', () => {
      this.activeSockets.delete(clientSocket);
    });

    let buffer = Buffer.alloc(0);

    const onInitialData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length === 0) return;

      const version = buffer[0];

      if (version === 0x05) {
        // SOCKS5 协议
        clientSocket.removeListener('data', onInitialData);
        this._handleSocks5(clientSocket, buffer);
      } else if (version === 0x04) {
        // SOCKS4 / SOCKS4a 协议
        clientSocket.removeListener('data', onInitialData);
        this._handleSocks4(clientSocket, buffer);
      } else {
        // 非 SOCKS 协议包（如误发了 HTTP 请求到 SOCKS 端口）
        // 尝试友好响应或关闭连接
        clientSocket.destroy();
      }
    };

    clientSocket.on('data', onInitialData);
    clientSocket.on('error', (err) => {
      clientSocket.destroy();
    });
  }

  /**
   * 处理 SOCKS5 协议握手与请求转发 (RFC 1928)
   */
  _handleSocks5(clientSocket, initialBuffer) {
    let buf = initialBuffer;

    // 阶段 1: 协商认证方式
    // 客户端包结构: [VER(1), NMETHODS(1), METHODS(N)]
    if (buf.length < 2 || buf.length < 2 + buf[1]) {
      const waitForAuth = (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length >= 2 && buf.length >= 2 + buf[1]) {
          clientSocket.removeListener('data', waitForAuth);
          this._handleSocks5Auth(clientSocket, buf);
        }
      };
      clientSocket.on('data', waitForAuth);
    } else {
      this._handleSocks5Auth(clientSocket, buf);
    }
  }

  _handleSocks5Auth(clientSocket, buf) {
    // 回复: [VER=0x05, METHOD=0x00 (无需密码验证)]
    if (!clientSocket.writable) return;
    clientSocket.write(Buffer.from([0x05, 0x00]));

    // 阶段 2: 接收客户端连接请求
    let reqBuf = Buffer.alloc(0);

    const onRequestData = (chunk) => {
      reqBuf = Buffer.concat([reqBuf, chunk]);
      if (reqBuf.length < 4) return;

      const ver = reqBuf[0];
      const cmd = reqBuf[1];
      const atyp = reqBuf[3];

      if (ver !== 0x05) {
        clientSocket.destroy();
        return;
      }

      // 目前仅支持 CONNECT (0x01)
      if (cmd !== 0x01) {
        // 0x07 = Command not supported
        if (clientSocket.writable) {
          clientSocket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
        }
        clientSocket.destroy();
        return;
      }

      let host = '';
      let port = 0;
      let headerLen = 0;

      if (atyp === 0x01) {
        // IPv4: 4 字节 IP + 2 字节端口
        if (reqBuf.length < 10) return;
        host = `${reqBuf[4]}.${reqBuf[5]}.${reqBuf[6]}.${reqBuf[7]}`;
        port = reqBuf.readUInt16BE(8);
        headerLen = 10;
      } else if (atyp === 0x03) {
        // 域名: 1 字节长度 + N 字节域名 + 2 字节端口
        const domainLen = reqBuf[4];
        if (reqBuf.length < 5 + domainLen + 2) return;
        host = reqBuf.slice(5, 5 + domainLen).toString('utf8');
        port = reqBuf.readUInt16BE(5 + domainLen);
        headerLen = 7 + domainLen;
      } else if (atyp === 0x04) {
        // IPv6: 16 字节 IP + 2 字节端口
        if (reqBuf.length < 22) return;
        const parts = [];
        for (let i = 0; i < 16; i += 2) {
          parts.push(reqBuf.readUInt16BE(4 + i).toString(16));
        }
        host = parts.join(':');
        port = reqBuf.readUInt16BE(20);
        headerLen = 22;
      } else {
        // 未知地址类型
        clientSocket.destroy();
        return;
      }

      clientSocket.removeListener('data', onRequestData);

      const leftover = reqBuf.slice(headerLen);
      this._bridgeToHttpProxy(clientSocket, host, port, 'socks5', leftover);
    };

    clientSocket.on('data', onRequestData);
  }

  /**
   * 处理 SOCKS4 / SOCKS4a 协议握手
   */
  _handleSocks4(clientSocket, buf) {
    let reqBuf = buf;

    const onData = (chunk) => {
      reqBuf = Buffer.concat([reqBuf, chunk]);
      this._parseSocks4(clientSocket, reqBuf, onData);
    };

    this._parseSocks4(clientSocket, reqBuf, onData);
  }

  _parseSocks4(clientSocket, reqBuf, onData) {
    if (reqBuf.length < 8) {
      clientSocket.once('data', onData);
      return;
    }

    const cmd = reqBuf[1];
    if (cmd !== 0x01) {
      // 仅支持 CONNECT (0x01)
      if (clientSocket.writable) {
        clientSocket.write(Buffer.from([0x00, 0x5b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
      }
      clientSocket.destroy();
      return;
    }

    const port = reqBuf.readUInt16BE(2);
    const ipBytes = reqBuf.slice(4, 8);
    const isSocks4a = ipBytes[0] === 0 && ipBytes[1] === 0 && ipBytes[2] === 0 && ipBytes[3] !== 0;

    // 查找 UserID 的结尾 0x00
    const userIdEnd = reqBuf.indexOf(0x00, 8);
    if (userIdEnd === -1) {
      clientSocket.once('data', onData);
      return;
    }

    let host = '';
    let headerLen = userIdEnd + 1;

    if (isSocks4a) {
      // 查找 Domain 结尾 0x00
      const domainEnd = reqBuf.indexOf(0x00, userIdEnd + 1);
      if (domainEnd === -1) {
        clientSocket.once('data', onData);
        return;
      }
      host = reqBuf.slice(userIdEnd + 1, domainEnd).toString('utf8');
      headerLen = domainEnd + 1;
    } else {
      host = `${ipBytes[0]}.${ipBytes[1]}.${ipBytes[2]}.${ipBytes[3]}`;
    }

    const leftover = reqBuf.slice(headerLen);
    this._bridgeToHttpProxy(clientSocket, host, port, 'socks4', leftover);
  }

  /**
   * 将 SOCKS 连接桥接到本地 HTTP 抓包代理内核 (127.0.0.1:httpProxyPort)
   */
  _bridgeToHttpProxy(clientSocket, host, port, protocolVersion, leftoverData) {
    const target = `${host}:${port}`;
    let isConnected = false;

    // 连接到本地 HTTP 抓包代理
    const proxySocket = net.connect(this.httpProxyPort, '127.0.0.1', () => {
      // 向 HTTP 代理发送标准 CONNECT 隧道请求
      const connectReq = `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nUser-Agent: HQ-Socks5-Bridge\r\nProxy-Connection: keep-alive\r\n\r\n`;
      proxySocket.write(connectReq);

      let respBuffer = Buffer.alloc(0);

      const onProxyData = (chunk) => {
        respBuffer = Buffer.concat([respBuffer, chunk]);
        const headerEnd = respBuffer.indexOf('\r\n\r\n');

        if (headerEnd !== -1) {
          proxySocket.removeListener('data', onProxyData);

          const statusLine = respBuffer.slice(0, headerEnd).toString('utf8').split('\r\n')[0] || '';

          if (statusLine.includes('200')) {
            isConnected = true;

            // 握手成功，回复客户端 SOCKS 成功包
            if (clientSocket.writable) {
              if (protocolVersion === 'socks5') {
                // SOCKS5 成功响应: [0x05, 0x00(成功), 0x00(保留), 0x01(IPv4), 0,0,0,0, 0,0]
                clientSocket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
              } else {
                // SOCKS4 成功响应: [0x00, 0x5a(成功), 0x00,0x00, 0,0,0,0]
                clientSocket.write(Buffer.from([0x00, 0x5a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
              }

              // 将 HTTP 代理多余的数据（如果有）转发给客户端
              const proxyExtra = respBuffer.slice(headerEnd + 4);
              if (proxyExtra.length > 0) {
                clientSocket.write(proxyExtra);
              }

              // 将客户端随握手请求带过来的数据（如果有）转发给 HTTP 代理
              if (leftoverData && leftoverData.length > 0) {
                proxySocket.write(leftoverData);
              }

              // 建立全双工实时管道
              clientSocket.pipe(proxySocket);
              proxySocket.pipe(clientSocket);
            } else {
              proxySocket.destroy();
            }
          } else {
            // HTTP 代理返回了非 200 响应（例如上游连接失败或被拦截）
            if (clientSocket.writable) {
              if (protocolVersion === 'socks5') {
                // 0x05 = Connection refused
                clientSocket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
              } else {
                clientSocket.write(Buffer.from([0x00, 0x5b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
              }
            }
            clientSocket.destroy();
            proxySocket.destroy();
          }
        }
      };

      proxySocket.on('data', onProxyData);
    });

    // 错误处理与清理
    proxySocket.on('error', (err) => {
      if (!isConnected && clientSocket.writable) {
        if (protocolVersion === 'socks5') {
          clientSocket.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
        } else {
          clientSocket.write(Buffer.from([0x00, 0x5b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
        }
      }
      clientSocket.destroy();
      proxySocket.destroy();
    });

    clientSocket.on('error', (err) => {
      proxySocket.destroy();
      clientSocket.destroy();
    });
  }

  /**
   * 停止 SOCKS 代理服务
   */
  stop() {
    return new Promise((resolve) => {
      for (const socket of this.activeSockets) {
        try {
          socket.destroy();
        } catch (e) {}
      }
      this.activeSockets.clear();

      if (this.server) {
        this.server.close(() => {
          console.log('[SocksServer] SOCKS5 代理网桥已停止');
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = new SocksServer();
