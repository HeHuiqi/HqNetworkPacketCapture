import { store, actions } from '../store.js';

export default {
  name: 'AppHeader',
  setup() {
    return { store, actions };
  },
  template: `
    <header class="app-header">
      <div class="header-left">
        <!-- 类似 Charles 的 Structure 与 Sequence 视图切换图标 -->
        <div class="view-switch-group">
          <button 
            class="view-switch-btn" 
            :class="{ active: store.viewMode === 'structure' }"
            @click="store.viewMode = 'structure'"
            title="结构视图 (按域名目录树展示)"
          >
            <span>🌳 结构 (Structure)</span>
          </button>
          <button 
            class="view-switch-btn" 
            :class="{ active: store.viewMode === 'sequence' }"
            @click="store.viewMode = 'sequence'"
            title="序列视图 (平铺列表展示)"
          >
            <span>📋 序列 (Sequence)</span>
          </button>
        </div>

        <div class="header-divider"></div>

        <div 
          class="proxy-info-pill" 
          @click="actions.copy((store.lanIps[0]?.ip || '127.0.0.1') + ':' + store.proxyPort, 'HTTP 代理地址已复制 (SOCKS5 端口: ' + (store.socksPort || 8889) + ')')" 
          :title="'点击复制 HTTP 代理地址\\nHTTP 端口: ' + store.proxyPort + '\\nSOCKS5 端口: ' + (store.socksPort || 8889)"
        >
          <span>🌐 HTTP:</span>
          <strong>{{ store.lanIps[0]?.ip || '127.0.0.1' }}:{{ store.proxyPort }}</strong>
          <span style="opacity: 0.4; margin: 0 4px;">|</span>
          <span>🧦 SOCKS5:</span>
          <strong>{{ store.socksPort || 8889 }}</strong>
          <span>📋</span>
        </div>

        <!-- 开始抓包 / 暂停抓包 按钮 (放置在 代理: 的右边) -->
        <button 
          class="btn btn-sm btn-record-toggle" 
          :class="store.isRecording ? 'btn-recording' : 'btn-paused'"
          @click="actions.toggleRecording"
          :title="store.isRecording ? '点击暂停网络抓包' : '点击开始网络抓包'"
        >
          <span class="record-dot" :class="{ active: store.isRecording }"></span>
          <span>{{ store.isRecording ? '⏸ 暂停抓包' : '▶ 开始抓包' }}</span>
        </button>
      </div>

      <div class="header-right">
        <!-- 代理与证书设置入口 (合并系统代理、上游代理、安装根证书、手机配网与证书) -->
        <button 
          class="btn btn-sm settings-entry-btn" 
          :class="(store.systemProxy.enabled || store.upstreamProxy.enabled) ? 'btn-settings-active' : 'btn-default'"
          @click="store.modals.settings = true" 
          title="打开代理与证书设置 (安装根证书、手机配网、系统代理、上游代理)"
        >
          <span v-if="store.systemProxy.enabled || store.upstreamProxy.enabled" class="mac-proxy-indicator active"></span>
          <span>⚙️ 设置</span>
        </button>

        <button class="btn btn-purple btn-sm" @click="store.modals.rules = true">
          <span>🎯 Map Local 规则 ({{ store.rules.length }})</span>
        </button>

        <button class="btn btn-danger btn-sm" @click="actions.clearHistory">
          <span>🧹 清空记录</span>
        </button>

        <!-- 黑色/白色主题切换按钮 (放置在最右边) -->
        <button 
          class="btn btn-default btn-sm theme-btn" 
          @click="actions.toggleTheme" 
          :title="'切换为' + (store.theme === 'dark' ? '白色浅色主题' : '黑色深色主题')"
        >
          <span>{{ store.theme === 'dark' ? '🌙 深色' : '☀️ 浅色' }}</span>
        </button>
      </div>
    </header>
  `
};
