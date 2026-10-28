import { store, actions } from '../store.js';
import { generateCurl } from '../utils/formatters.js';

export default {
  name: 'ContextMenu',
  setup() {
    const copyUrl = () => {
      if (store.contextMenu.target) {
        actions.copy(store.contextMenu.target.url, 'URL 已复制');
      }
    };

    const copyCurl = () => {
      if (store.contextMenu.target) {
        const cmd = generateCurl(store.contextMenu.target);
        actions.copy(cmd, 'cURL 命令已复制');
      }
    };

    const copyBody = () => {
      if (store.contextMenu.target) {
        actions.copy(store.contextMenu.target.responseBody || '', '响应数据已复制');
      }
    };

    return {
      store,
      actions,
      copyUrl,
      copyCurl,
      copyBody
    };
  },
  template: `
    <div 
      v-if="store.contextMenu.visible" 
      class="context-menu" 
      :style="{ left: store.contextMenu.x + 'px', top: store.contextMenu.y + 'px' }"
      @click.stop
    >
      <div class="menu-item mock-item" @click="actions.openMockModal()">
        <span>⚡</span>
        <span>Map Local (Mock 当前请求)</span>
      </div>
      <div class="menu-divider"></div>
      <div class="menu-item" @click="copyUrl">
        <span>📋</span>
        <span>复制完整 URL</span>
      </div>
      <div class="menu-item" @click="copyCurl">
        <span>💻</span>
        <span>复制为 cURL 命令</span>
      </div>
      <div class="menu-item" @click="copyBody">
        <span>📥</span>
        <span>复制响应 Body 数据</span>
      </div>
      <div class="menu-divider"></div>
      <div class="menu-item" @click="actions.closeContextMenu">
        <span>❌</span>
        <span>取消</span>
      </div>
    </div>
  `
};
