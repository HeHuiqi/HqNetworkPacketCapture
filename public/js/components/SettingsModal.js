import { store, actions } from '../store.js';

export default {
  name: 'SettingsModal',
  setup() {
    const openCertModal = () => {
      store.modals.cert = true;
    };

    const openMobileModal = () => {
      actions.openMobileModal();
    };

    const toggleSystemProxy = () => {
      actions.toggleSystemProxy();
    };

    const openUpstreamModal = () => {
      store.modals.upstream = true;
    };

    return {
      store,
      openCertModal,
      openMobileModal,
      toggleSystemProxy,
      openUpstreamModal
    };
  },
  template: `
    <div v-if="store.modals.settings" class="modal-overlay" @click.self="store.modals.settings = false">
      <div class="modal-card settings-modal-card">
        <div class="modal-header">
          <h3>⚙️ 代理与证书设置</h3>
          <button class="modal-close" @click="store.modals.settings = false">✕</button>
        </div>

        <div class="modal-body settings-modal-body">
          <div class="settings-action-list">
            <!-- 1. 安装根证书 -->
            <button
              type="button"
              class="settings-action-btn"
              @click="openCertModal"
            >
              <div class="settings-action-left">
                <span class="settings-action-icon">🔐</span>
                <div class="settings-action-info">
                  <div class="settings-action-title">安装根证书</div>
                  <div class="settings-action-desc">安装并信任本机 HTTPS 解密根证书</div>
                </div>
              </div>
              <span class="settings-action-arrow">›</span>
            </button>

            <!-- 2. 手机配网与证书 -->
            <button
              type="button"
              class="settings-action-btn"
              @click="openMobileModal"
            >
              <div class="settings-action-left">
                <span class="settings-action-icon">📱</span>
                <div class="settings-action-info">
                  <div class="settings-action-title">手机配网与证书</div>
                  <div class="settings-action-desc">查看局域网 IP、端口及扫码下载手机证书</div>
                </div>
              </div>
              <span class="settings-action-arrow">›</span>
            </button>

            <!-- 3. 系统代理 -->
            <button
              v-if="store.systemProxy.supported"
              type="button"
              class="settings-action-btn"
              :class="{ 'is-active': store.systemProxy.enabled }"
              @click="toggleSystemProxy"
            >
              <div class="settings-action-left">
                <span class="settings-action-icon">🖥️</span>
                <div class="settings-action-info">
                  <div class="settings-action-title">
                    系统代理
                    <span class="settings-status-badge" :class="store.systemProxy.enabled ? 'status-on' : 'status-off'">
                      {{ store.systemProxy.enabled ? '已开启' : '已关闭' }}
                    </span>
                  </div>
                  <div class="settings-action-desc">
                    {{ store.systemProxy.enabled ? '点击关闭本机全局系统网络代理' : '点击开启本机全局系统网络代理以抓取桌面流量' }}
                  </div>
                </div>
              </div>
              <span class="settings-toggle-pill" :class="{ active: store.systemProxy.enabled }">
                <span class="settings-toggle-knob"></span>
              </span>
            </button>

            <!-- 4. 上游代理 -->
            <button
              type="button"
              class="settings-action-btn"
              :class="{ 'is-active': store.upstreamProxy.enabled }"
              @click="openUpstreamModal"
            >
              <div class="settings-action-left">
                <span class="settings-action-icon">🚀</span>
                <div class="settings-action-info">
                  <div class="settings-action-title">
                    上游代理
                    <span class="settings-status-badge" :class="store.upstreamProxy.enabled ? 'status-on' : 'status-off'">
                      {{ store.upstreamProxy.enabled ? '已开启' : '未启用' }}
                    </span>
                  </div>
                  <div class="settings-action-desc">
                    {{ store.upstreamProxy.enabled ? (store.upstreamProxy.type + '://' + store.upstreamProxy.host + ':' + store.upstreamProxy.port) : '配置外部代理转发 (兼容 Clash / VPN 节点)' }}
                  </div>
                </div>
              </div>
              <span class="settings-action-arrow">›</span>
            </button>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-default" @click="store.modals.settings = false">关闭</button>
        </div>
      </div>
    </div>
  `
};
