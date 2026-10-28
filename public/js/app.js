import { createApp, onMounted, onUnmounted } from '/vendor/vue.esm-browser.js';
import { store, actions } from './store.js';

// 导入独立子组件
import AppHeader from './components/AppHeader.js';
import LeftPanel from './components/LeftPanel.js';
import RightPanel from './components/RightPanel.js';
import ContextMenu from './components/ContextMenu.js';
import MapLocalModal from './components/MapLocalModal.js';
import RulesManagerModal from './components/RulesManagerModal.js';
import MobileModal from './components/MobileModal.js';
import CertModal from './components/CertModal.js';
import ConfirmModal from './components/ConfirmModal.js';

const app = createApp({
  components: {
    AppHeader,
    LeftPanel,
    RightPanel,
    ContextMenu,
    MapLocalModal,
    RulesManagerModal,
    MobileModal,
    CertModal,
    ConfirmModal
  },
  setup() {
    const onGlobalClick = () => {
      if (store.contextMenu.visible) {
        actions.closeContextMenu();
      }
    };

    onMounted(() => {
      actions.initTheme();
      actions.initWebSocket();
      window.addEventListener('click', onGlobalClick);
    });

    onUnmounted(() => {
      window.removeEventListener('click', onGlobalClick);
    });

    return {
      store,
      actions
    };
  },
  template: `
    <div id="app-root">
      <!-- 顶部通用导航工具栏 -->
      <app-header></app-header>

      <!-- 主工作区：两栏布局 (左栏目录树 + 右栏上下请求/响应) -->
      <div class="main-two-columns">
        <!-- 左栏：按域名建立目录的结构树或平铺列表 -->
        <left-panel></left-panel>

        <!-- 右栏：上下分栏 (上边是请求 Request，下边是响应 Response) -->
        <right-panel></right-panel>
      </div>

      <!-- 右键上下文弹出菜单 -->
      <context-menu></context-menu>

      <!-- Map Local 核心配置弹窗 -->
      <map-local-modal></map-local-modal>

      <!-- Map Local 规则库列表管理弹窗 -->
      <rules-manager-modal></rules-manager-modal>

      <!-- 手机配网向导弹窗 -->
      <mobile-modal></mobile-modal>

      <!-- 电脑根证书安装向导弹窗 -->
      <cert-modal></cert-modal>

      <!-- 全局通用确认/删除对话框 -->
      <confirm-modal></confirm-modal>

      <!-- Toast 浮层通知 -->
      <div class="toast-container">
        <div v-for="t in store.toasts" :key="t.id" class="toast" :class="t.type">
          <span>{{ t.type === 'success' ? '✅' : '❌' }}</span>
          <span>{{ t.message }}</span>
        </div>
      </div>
    </div>
  `
});

app.mount('#app');
