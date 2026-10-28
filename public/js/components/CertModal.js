import { ref, onMounted } from '/vendor/vue.esm-browser.js';
import { store, actions } from '../store.js';

export default {
  name: 'CertModal',
  setup() {
    const activeTab = ref('mac'); // 'mac' | 'windows'
    const certPath = ref('');
    const crtPath = ref('');
    const platform = ref('darwin');

    onMounted(async () => {
      try {
        const res = await fetch('/api/cert/info');
        const data = await res.json();
        certPath.value = data.certPath || '';
        crtPath.value = data.crtPath || '';
        platform.value = data.platform || 'darwin';
        if (platform.value === 'win32') {
          activeTab.value = 'windows';
        }
      } catch (e) {}
    });

    const openKeychain = async () => {
      try {
        const res = await fetch('/api/cert/open-keychain', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          actions.showToast(data.message, 'success');
        } else {
          actions.showToast('调起失败: ' + (data.error || data.message), 'error');
        }
      } catch (err) {
        actions.showToast('请求失败: ' + err.message, 'error');
      }
    };

    const copyTerminalCmd = () => {
      const p = certPath.value || './certs/ca.pem';
      const cmd = `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${p}"`;
      actions.copy(cmd, '终端命令已复制，在终端回车即可一键全自动信任！');
    };

    return {
      store,
      actions,
      activeTab,
      certPath,
      crtPath,
      openKeychain,
      copyTerminalCmd
    };
  },
  template: `
    <div class="modal-overlay" v-if="store.modals.cert" @click.self="store.modals.cert = false">
      <div class="modal-card modal-lg">
        <div class="modal-header">
          <div class="modal-title">
            <span>🔐 电脑安装并信任根证书 (解决开启代理后无法访问网络)</span>
          </div>
          <button class="close-btn" @click="store.modals.cert = false">✕</button>
        </div>

        <div class="modal-body">
          <!-- 为什么需要信任证书的通俗解释 -->
          <div class="cert-alert-box">
            <div style="font-size: 16px; margin-right: 8px;">💡</div>
            <div style="font-size: 12px; line-height: 1.6;">
              <strong>为什么开启“系统代理”后浏览器无法上网或提示安全警告？</strong><br>
              因为系统开启代理后，所有 HTTPS 加密请求均由本机的 <strong>HqNetworkDebuger</strong> 证书解密。如果操作系统钥匙串/受信任列表尚未信任此证书，浏览器（Chrome、Safari 等）出于安全保护会阻断连接。<strong>只需完成一次信任，后续即可顺畅抓取电脑所有流量！</strong>
            </div>
          </div>

          <!-- 平台切换选项卡 -->
          <div class="platform-tabs" style="margin-top: 14px;">
            <button 
              class="sub-tab-btn" 
              :class="{ active: activeTab === 'mac' }" 
              @click="activeTab = 'mac'"
            >
              🍎 macOS 安装指南 (推荐终端一键命令)
            </button>
            <button 
              class="sub-tab-btn" 
              :class="{ active: activeTab === 'windows' }" 
              @click="activeTab = 'windows'"
            >
              🪟 Windows 安装指南
            </button>
          </div>

          <!-- macOS 安装指南 -->
          <div v-if="activeTab === 'mac'" class="cert-guide-container">
            <!-- 方案 1: 终端单行命令一键永久信任 (最省事) -->
            <div class="cert-method-card highlight-card">
              <div class="method-badge">🚀 推荐方式：终端一行命令自动完成信任 (最快)</div>
              <p style="font-size: 12px; color: var(--text-muted); margin: 6px 0;">
                打开电脑自带的 <strong>终端 (Terminal)</strong>，粘贴并运行下方命令（输入一次开机密码回车即可全自动设为始终信任，无需任何手动点选）：
              </p>
              <div class="terminal-command-box">
                <code>sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "{{ certPath || './certs/ca.pem' }}"</code>
                <button class="btn btn-primary btn-xs" @click="copyTerminalCmd">📋 复制命令</button>
              </div>
            </div>

            <!-- 方案 2: 界面手动操作 -->
            <div class="cert-method-card" style="margin-top: 14px;">
              <div class="method-title">方式二：调起 Mac“钥匙串访问”图形界面操作</div>
              <div style="margin: 8px 0; display: flex; gap: 10px; align-items: center;">
                <button class="btn btn-default btn-sm" @click="openKeychain">
                  <span>🚀 点击调起 Mac 钥匙串</span>
                </button>
                <a :href="'/ca.pem?download=1'" download="hq-ca.pem" class="btn btn-default btn-sm">
                  <span>📥 手动下载 ca.pem</span>
                </a>
              </div>
              <ol class="cert-steps-list">
                <li>点击上方按钮调起钥匙串（或双击下载的 <code class="highlight-code">ca.pem</code>）。</li>
                <li>在钥匙串中找到名为 <strong>HqNetworkDebuger</strong> 的证书（位于“登录”或“系统”钥匙串）。</li>
                <li><strong>双击打开证书 -> 点击展开“信任”下拉项</strong>。</li>
                <li>将“使用此证书时”选项更改为 <strong>【始终信任】</strong>。</li>
                <li>关闭窗口并输入 Mac 开机密码确认保存即可！</li>
              </ol>
            </div>
          </div>

          <!-- Windows 安装指南 -->
          <div v-if="activeTab === 'windows'" class="cert-guide-container">
            <div class="cert-method-card">
              <div class="method-title">Windows 导入“受信任的根证书颁发机构”</div>
              <div style="margin: 8px 0; display: flex; gap: 10px; align-items: center;">
                <button class="btn btn-default btn-sm" @click="openKeychain">
                  <span>🚀 调起 Windows 证书导入向导</span>
                </button>
                <a :href="'/ca.crt'" download="hq-ca.crt" class="btn btn-default btn-sm">
                  <span>📥 手动下载 ca.crt</span>
                </a>
              </div>
              <ol class="cert-steps-list">
                <li>双击下载的 <code class="highlight-code">ca.crt</code> 证书文件，点击底部 <strong>“安装证书”</strong> 按钮。</li>
                <li>存储位置选择 <strong>“本地计算机”</strong>（或当前用户），点击下一步。</li>
                <li>选择 <strong>“将所有的证书都放入下列存储”</strong>，点击“浏览”。</li>
                <li>在列表中选中 <strong>【受信任的根证书颁发机构】</strong>，点击确定。</li>
                <li>点击下一步直到“完成”，并在安全提示窗口点击“是”允许安装即可！</li>
              </ol>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-primary" @click="store.modals.cert = false">我已完成安装与信任</button>
        </div>
      </div>
    </div>
  `
};
