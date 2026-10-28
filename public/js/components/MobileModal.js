import { store, actions } from '../store.js';

export default {
  name: 'MobileModal',
  setup() {
    return { store, actions };
  },
  template: `
    <div class="modal-overlay" v-if="store.modals.mobile" @click.self="store.modals.mobile = false">
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title">
            <span>📱 手机配网与根证书安装向导</span>
          </div>
          <button class="close-btn" @click="store.modals.mobile = false">✕</button>
        </div>

        <div class="modal-body">
          <!-- 顶部优先选择手机系统类型，联动切换专属二维码与安装指南 -->
          <div class="platform-tabs" style="margin-bottom: 14px;">
            <button 
              class="sub-tab-btn" 
              :class="{ active: store.mobileConfig.activeTab === 'ios' }" 
              @click="actions.switchMobilePlatform('ios')"
            >
              🍎 iOS / iPhone (扫码安装 ca.pem)
            </button>
            <button 
              class="sub-tab-btn" 
              :class="{ active: store.mobileConfig.activeTab === 'android' }" 
              @click="actions.switchMobilePlatform('android')"
            >
              🤖 Android 安卓 (扫码下载 ca.crt)
            </button>
          </div>

          <div class="mobile-intro-box">
            <div style="display: flex; flex-direction: column; align-items: center; gap: 6px;">
              <div class="qr-wrapper">
                <img v-if="store.mobileConfig.qrDataUrl" :src="store.mobileConfig.qrDataUrl" alt="CA 证书二维码" class="qr-img" />
                <div v-else class="qr-loading">加载中...</div>
              </div>
              <div style="font-size: 11px; font-weight: 600;" :style="{ color: store.mobileConfig.activeTab === 'ios' ? '#60a5fa' : '#34d399' }">
                {{ store.mobileConfig.activeTab === 'ios' ? '🍎 iOS 专属二维码 (ca.pem)' : '🤖 Android 专属二维码 (ca.crt)' }}
              </div>
            </div>

            <div style="flex: 1;">
              <div style="font-weight: 700; font-size: 13.5px; margin-bottom: 6px;">第 1 步：配置手机 Wi-Fi 代理</div>
              <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 8px;">
                确保手机与电脑连接<strong>同一 Wi-Fi</strong>，并在手机 Wi-Fi 详情中配置手动代理：
              </p>
              <div class="proxy-param-box">
                <div>服务器 IP: <strong>{{ store.lanIps[0]?.ip || '127.0.0.1' }}</strong></div>
                <div>端口号:    <strong>{{ store.proxyPort }}</strong></div>
              </div>

              <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
                <a v-if="store.mobileConfig.activeTab === 'ios'" :href="'/ca.pem?download=1'" download="hq-ca.pem" class="btn btn-default btn-xs">下载 ca.pem (iOS)</a>
                <template v-if="store.mobileConfig.activeTab === 'android'">
                  <a :href="'/ca.crt'" download="hq-ca.crt" class="btn btn-default btn-xs">下载 ca.crt (Android)</a>
                  <a :href="'/apks/LSPatch-v1.2-492-release.apk'" download="LSPatch-v1.2-492-release.apk" class="btn btn-default btn-xs" style="color: #38bdf8;">📥 下载定制版 LSPatch.apk</a>
                  <a :href="'/' + (store.mobileConfig.systemCertFilename || '8adeb422.0')" :download="store.mobileConfig.systemCertFilename || '8adeb422.0'" class="btn btn-default btn-xs">下载 {{ store.mobileConfig.systemCertFilename || '8adeb422.0' }} (系统级证书)</a>
                </template>
              </div>
            </div>
          </div>

          <div v-if="store.mobileConfig.activeTab === 'ios'" class="platform-guide-content" style="margin-top: 12px;">
            <ol>
              <li>使用 iPhone <strong>系统相机</strong> 或 <strong>Safari 浏览器</strong> 扫描上方 <strong>iOS 专属二维码</strong>（或直接在 Safari 访问 <code class="highlight-code">{{ store.mobileConfig.certUrl }}</code>，请勿使用微信扫一扫）。</li>
              <li>在弹出的“此网站正尝试下载一个配置描述文件”提示中点击 <strong>“允许”</strong>。</li>
              <li>打开手机 <strong>设置 -> 已下载描述文件</strong> -> 点击右上角“安装”。</li>
              <li><strong style="color: #f87171;">⚠️ 必须开启信任：</strong>前往 <strong>设置 -> 通用 -> 关于本机 -> 证书信任设置</strong>，在最下方找到 <strong>HqNetworkDebuger</strong> 证书，<strong>开启“完全信任”</strong>。</li>
            </ol>
          </div>

          <div v-if="store.mobileConfig.activeTab === 'android'" class="platform-guide-content" style="margin-top: 12px;">
            <ol>
              <li>使用手机<strong>系统浏览器</strong>扫描上方 <strong>Android 专属二维码</strong>（或在浏览器直接访问 <code class="highlight-code">{{ store.mobileConfig.certUrl }}</code>，请勿使用微信扫一扫）下载 <code class="highlight-code">hq-ca.crt</code> 证书文件。</li>
              <li>前往手机 <strong>设置 -> 安全 -> 更多安全设置 -> 加密与凭据 -> 从存储设备安装证书 -> CA 证书</strong>。</li>
              <li>选择刚才下载的 <code class="highlight-code">hq-ca.crt</code> 完成安装。</li>
              <li><strong style="color: #38bdf8;">🛡️ 免 Root 真机抓包方案（首选推荐）：</strong>针对未 Root 的物理真机（华为鸿蒙/小米/OPPO/vivo 等），推荐使用定制版 <strong>LSPatch</strong>（内置证书放行与免 Shizuku）修补应用，配合 <strong>AppProxy</strong> 勾选目标应用进行分流抓包。</li>
              <li><strong style="color: #fbbf24;">📦 容器/Root 系统级证书方案：</strong>若使用 <strong>两仪（Twoyi）</strong> 容器虚拟机或已 Root 设备，可直接点击上方 <strong>「下载 {{ store.mobileConfig.systemCertFilename || '8adeb422.0' }} (系统级证书)」</strong>，将其复制至 <code class="highlight-code">/system/etc/security/cacerts/</code> 目录并将权限改为 <code class="highlight-code">644</code> 后重启即可。</li>
            </ol>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-primary btn-sm" @click="store.modals.mobile = false">我知道了</button>
        </div>
      </div>
    </div>
  `
};
