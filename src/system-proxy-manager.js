const { execSync } = require('child_process');

/**
 * 跨平台系统全局代理管理器
 * 支持:
 *  - macOS (darwin): 使用 networksetup
 *  - Windows (win32): 使用 Windows Registry 注册表
 *  - Linux (linux): 使用 GNOME gsettings
 */
class SystemProxyManager {
  constructor() {
    this.platform = process.platform; // 'darwin' | 'win32' | 'linux'
    this.wasEnabledByUs = false;
  }

  isSupported() {
    return ['darwin', 'win32', 'linux'].includes(this.platform);
  }

  // -------------------------------------------------------------
  // macOS 平台实现
  // -------------------------------------------------------------
  _getMacActiveService() {
    try {
      const out = execSync('route -n get default', { encoding: 'utf8' });
      const match = out.match(/interface:\s*(\w+)/);
      const iface = match ? match[1].trim() : 'en0';

      const order = execSync('networksetup -listnetworkserviceorder', { encoding: 'utf8' });
      const lines = order.split('\n');
      let serviceName = null;
      for (const line of lines) {
        const sm = line.match(/^\(\d+\)\s+(.+)$/);
        if (sm) serviceName = sm[1].trim();
        if (line.includes(`Device: ${iface}`) && serviceName) {
          return serviceName;
        }
      }
    } catch (err) {
      console.warn('[SystemProxy] 获取 macOS 网络服务名失败，回退至 Wi-Fi:', err.message);
    }
    return 'Wi-Fi';
  }

  _getMacStatus() {
    const service = this._getMacActiveService();
    try {
      const out = execSync(`networksetup -getwebproxy "${service}"`, { encoding: 'utf8' });
      const enabled = /Enabled:\s*Yes/i.test(out);
      const serverMatch = out.match(/Server:\s*(.+)/);
      const portMatch = out.match(/Port:\s*(\d+)/);

      return {
        supported: true,
        enabled,
        platform: 'macOS',
        service,
        server: serverMatch ? serverMatch[1].trim() : '',
        port: portMatch ? parseInt(portMatch[1].trim(), 10) : 0
      };
    } catch (err) {
      return { supported: true, enabled: false, platform: 'macOS', service, error: err.message };
    }
  }

  _setMacProxy(enable, port = 8888, host = '127.0.0.1') {
    const service = this._getMacActiveService();
    if (enable) {
      console.log(`[SystemProxy] 正在开启 macOS 系统代理: 服务=${service}, 目标=${host}:${port}`);
      execSync(`networksetup -setwebproxy "${service}" ${host} ${port}`);
      execSync(`networksetup -setwebproxystate "${service}" on`);
      execSync(`networksetup -setsecurewebproxy "${service}" ${host} ${port}`);
      execSync(`networksetup -setsecurewebproxystate "${service}" on`);
      try {
        execSync(`networksetup -setproxybypassdomains "${service}" 127.0.0.1 localhost "*.local" 192.168.0.0/16 10.0.0.0/8`);
      } catch (e) {}
    } else {
      console.log(`[SystemProxy] 正在关闭 macOS 系统代理: 服务=${service}`);
      execSync(`networksetup -setwebproxystate "${service}" off`);
      execSync(`networksetup -setsecurewebproxystate "${service}" off`);
    }
  }

  // -------------------------------------------------------------
  // Windows 平台实现 (通过修改注册表 Internet Settings)
  // -------------------------------------------------------------
  _getWindowsStatus() {
    try {
      const queryCmd = 'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable';
      const out = execSync(queryCmd, { encoding: 'utf8' });
      const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(out);

      let server = '';
      let port = 0;
      try {
        const serverOut = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer', { encoding: 'utf8' });
        const match = serverOut.match(/ProxyServer\s+REG_SZ\s+(.+)/i);
        if (match) {
          const parts = match[1].trim().split(':');
          server = parts[0];
          port = parseInt(parts[1] || '8888', 10);
        }
      } catch (e) {}

      return {
        supported: true,
        enabled,
        platform: 'Windows',
        service: 'Internet Settings',
        server,
        port
      };
    } catch (err) {
      return { supported: true, enabled: false, platform: 'Windows', error: err.message };
    }
  }

  _setWindowsProxy(enable, port = 8888, host = '127.0.0.1') {
    const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    if (enable) {
      console.log(`[SystemProxy] 正在开启 Windows 系统代理: 目标=${host}:${port}`);
      execSync(`reg add "${regKey}" /v ProxyEnable /t REG_DWORD /d 1 /f`);
      execSync(`reg add "${regKey}" /v ProxyServer /t REG_SZ /d "${host}:${port}" /f`);
    } else {
      console.log(`[SystemProxy] 正在关闭 Windows 系统代理`);
      execSync(`reg add "${regKey}" /v ProxyEnable /t REG_DWORD /d 0 /f`);
    }
  }

  // -------------------------------------------------------------
  // Linux 平台实现 (基于 GNOME 桌面环境 gsettings)
  // -------------------------------------------------------------
  _getLinuxStatus() {
    try {
      const mode = execSync("gsettings get org.gnome.system.proxy mode", { encoding: 'utf8' }).trim();
      const enabled = mode.includes('manual');
      let server = '';
      let port = 0;
      if (enabled) {
        try {
          server = execSync("gsettings get org.gnome.system.proxy.http host", { encoding: 'utf8' }).replace(/'/g, '').trim();
          port = parseInt(execSync("gsettings get org.gnome.system.proxy.http port", { encoding: 'utf8' }).trim(), 10);
        } catch (e) {}
      }
      return {
        supported: true,
        enabled,
        platform: 'Linux (GNOME)',
        service: 'GNOME Proxy',
        server,
        port
      };
    } catch (err) {
      return { supported: false, enabled: false, platform: 'Linux', error: '当前环境可能非 GNOME 桌面: ' + err.message };
    }
  }

  _setLinuxProxy(enable, port = 8888, host = '127.0.0.1') {
    if (enable) {
      console.log(`[SystemProxy] 正在开启 Linux (GNOME) 系统代理: 目标=${host}:${port}`);
      execSync("gsettings set org.gnome.system.proxy mode 'manual'");
      execSync(`gsettings set org.gnome.system.proxy.http host '${host}'`);
      execSync(`gsettings set org.gnome.system.proxy.http port ${port}`);
      execSync(`gsettings set org.gnome.system.proxy.https host '${host}'`);
      execSync(`gsettings set org.gnome.system.proxy.https port ${port}`);
    } else {
      console.log(`[SystemProxy] 正在关闭 Linux 系统代理`);
      execSync("gsettings set org.gnome.system.proxy mode 'none'");
    }
  }

  // -------------------------------------------------------------
  // 跨平台统一对外接口
  // -------------------------------------------------------------
  getStatus() {
    if (this.platform === 'darwin') return this._getMacStatus();
    if (this.platform === 'win32') return this._getWindowsStatus();
    if (this.platform === 'linux') return this._getLinuxStatus();

    return {
      supported: false,
      enabled: false,
      platform: this.platform,
      error: `暂不支持当前操作系统: ${this.platform}`
    };
  }

  enable(port = 8888, host = '127.0.0.1') {
    if (!this.isSupported()) return false;

    if (this.platform === 'darwin') this._setMacProxy(true, port, host);
    else if (this.platform === 'win32') this._setWindowsProxy(true, port, host);
    else if (this.platform === 'linux') this._setLinuxProxy(true, port, host);

    this.wasEnabledByUs = true;
    return true;
  }

  disable() {
    if (!this.isSupported()) return false;

    if (this.platform === 'darwin') this._setMacProxy(false);
    else if (this.platform === 'win32') this._setWindowsProxy(false);
    else if (this.platform === 'linux') this._setLinuxProxy(false);

    this.wasEnabledByUs = false;
    return true;
  }

  toggle(port = 8888, host = '127.0.0.1') {
    const status = this.getStatus();
    if (status.enabled) {
      this.disable();
      return false;
    } else {
      this.enable(port, host);
      return true;
    }
  }

  // 程序异常退出或 Ctrl+C 时自动恢复
  restore() {
    if (this.wasEnabledByUs) {
      console.log('\n[SystemProxy] 服务正在关闭，自动清理并恢复系统代理设置...');
      try {
        this.disable();
      } catch (e) {}
    }
  }
}

module.exports = new SystemProxyManager();
