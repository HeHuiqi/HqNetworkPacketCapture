const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE_DIR = process.env.HQ_DATA_DIR || path.join(os.homedir(), '.hqnetwork');
const SETTINGS_FILE = path.join(BASE_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  upstreamProxy: {
    enabled: false,
    type: 'http', // 'http' | 'socks5'
    host: '127.0.0.1',
    port: 7890,
    noProxy: 'localhost, 127.0.0.1, 10.*, 192.168.*, 172.16.*'
  }
};

class SettingsManager {
  constructor() {
    this._settings = null;
    this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(BASE_DIR)) {
        fs.mkdirSync(BASE_DIR, { recursive: true });
      }
      if (fs.existsSync(SETTINGS_FILE)) {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this._settings = {
          ...DEFAULT_SETTINGS,
          ...parsed,
          upstreamProxy: {
            ...DEFAULT_SETTINGS.upstreamProxy,
            ...(parsed.upstreamProxy || {})
          }
        };
        return;
      }
    } catch (err) {
      console.warn('[SettingsManager] 读取设置文件失败，使用默认配置:', err.message);
    }
    this._settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    this._save();
  }

  _save() {
    try {
      if (!fs.existsSync(BASE_DIR)) {
        fs.mkdirSync(BASE_DIR, { recursive: true });
      }
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this._settings, null, 2), 'utf-8');
    } catch (err) {
      console.error('[SettingsManager] 保存设置文件失败:', err);
    }
  }

  getSettings() {
    if (!this._settings) this._load();
    return this._settings;
  }

  getUpstreamProxy() {
    if (!this._settings) this._load();
    return this._settings.upstreamProxy;
  }

  updateUpstreamProxy(config) {
    if (!this._settings) this._load();
    this._settings.upstreamProxy = {
      ...this._settings.upstreamProxy,
      ...config
    };
    this._save();
    return this._settings.upstreamProxy;
  }

  /**
   * 获取格式化后的上游代理 URL，如果未启用则返回 null
   * 例如: "http://127.0.0.1:7890" 或 "socks5://127.0.0.1:7890"
   */
  getUpstreamProxyUrl() {
    const p = this.getUpstreamProxy();
    if (!p || !p.enabled) return null;
    const host = (p.host || '127.0.0.1').trim();
    const port = parseInt(p.port, 10);
    if (!host || isNaN(port) || port <= 0) return null;
    const protocol = p.type === 'socks5' ? 'socks5' : 'http';
    return `${protocol}://${host}:${port}`;
  }

  /**
   * 获取不走上游代理的域名/IP匹配列表
   */
  getNoProxyList() {
    const p = this.getUpstreamProxy();
    if (!p || !p.noProxy) {
      return ['localhost', '127.0.0.1', '10.*', '192.168.*', '172.16.*'];
    }
    return p.noProxy
      .split(/[,;\n]/)
      .map(s => s.trim())
      .filter(Boolean);
  }
}

module.exports = new SettingsManager();
