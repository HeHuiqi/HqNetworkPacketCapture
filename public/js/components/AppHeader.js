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
          @click="actions.copy((store.lanIps[0]?.ip || '127.0.0.1') + ':' + store.proxyPort, '代理地址已复制')" 
          title="点击复制代理地址"
        >
          <span>🌐 代理:</span>
          <strong>{{ store.lanIps[0]?.ip || '127.0.0.1' }}:{{ store.proxyPort }}</strong>
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
        <!-- 一键开关跨平台系统全局代理 (macOS / Windows / Linux) -->
        <button 
          v-if="store.systemProxy.supported"
          class="btn btn-sm mac-proxy-btn" 
          :class="store.systemProxy.enabled ? 'btn-mac-proxy-active' : 'btn-default'"
          @click="actions.toggleSystemProxy" 
          :title="store.systemProxy.enabled ? '点击关闭电脑系统全局代理' : '点击开启电脑系统全局代理 (抓取电脑所有软件和浏览器网络请求)'"
        >
          <span class="mac-proxy-indicator" :class="{ active: store.systemProxy.enabled }"></span>
          <span>{{ store.systemProxy.enabled ? '🖥️ 系统代理: 已开启' : '🖥️ 系统代理: 已关闭' }}</span>
        </button>

        <!-- 电脑端根证书安装与信任菜单 -->
        <button 
          class="btn btn-default btn-sm" 
          @click="store.modals.cert = true"
          title="解决开启系统代理后浏览器提示证书无效或无法上网"
        >
          <span>🔐 安装根证书</span>
        </button>

        <button class="btn btn-default btn-sm" @click="actions.openMobileModal">
          <span>📱 手机配网与证书</span>
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
