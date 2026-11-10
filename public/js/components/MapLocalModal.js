import { ref } from '/vendor/vue.esm-browser.js';
import { store, actions } from '../store.js';
import { formatJson } from '../utils/formatters.js';
import JsonTreeEditor from './JsonTreeEditor.js';

export default {
  name: 'MapLocalModal',
  components: {
    JsonTreeEditor
  },
  setup() {
    // 默认开启全屏大小
    const isFullscreen = ref(true);
    // 左侧配置面板是否折叠
    const isSidebarCollapsed = ref(false);

    const toggleFullscreen = () => {
      isFullscreen.value = !isFullscreen.value;
    };

    const toggleSidebar = () => {
      isSidebarCollapsed.value = !isSidebarCollapsed.value;
    };

    const handleMatchTypeChange = (newType) => {
      if (store.mockForm.fromRulesModal || store.mockForm.id) {
        if (newType === 'path' && store.mockForm.pattern) {
          try {
            if (store.mockForm.pattern.startsWith('http://') || store.mockForm.pattern.startsWith('https://')) {
              store.mockForm.pattern = new URL(store.mockForm.pattern).pathname;
            }
          } catch (e) {}
        }
        return;
      }
      const tx = store.contextMenu.target || store.requests.find(r => r.id === store.selectedId);
      if (!tx) return;
      if (newType === 'path') {
        try {
          store.mockForm.pattern = new URL(tx.url).pathname;
        } catch (e) {
          store.mockForm.pattern = tx.path || tx.url;
        }
      } else if (newType === 'exact') {
        store.mockForm.pattern = tx.url;
      }
    };

    const formatJsonBody = () => {
      const { formatted, isValidJson } = formatJson(store.mockForm.body);
      if (isValidJson) {
        store.mockForm.body = formatted;
        actions.showToast('JSON 已重新排版格式化', 'success');
      } else {
        actions.showToast('当前文本不是有效 JSON', 'error');
      }
    };

    const minifyJsonBody = () => {
      try {
        const obj = JSON.parse(store.mockForm.body);
        store.mockForm.body = JSON.stringify(obj);
        actions.showToast('JSON 已压缩为单行', 'success');
      } catch (e) {
        actions.showToast('当前文本不是有效 JSON', 'error');
      }
    };

    const closeModal = () => {
      const shouldReturnToRules = !!store.mockForm.fromRulesModal;
      store.modals.mock = false;
      if (shouldReturnToRules) {
        store.modals.rules = true;
      }
    };

    return {
      store,
      actions,
      isFullscreen,
      isSidebarCollapsed,
      toggleFullscreen,
      toggleSidebar,
      handleMatchTypeChange,
      formatJsonBody,
      minifyJsonBody,
      closeModal
    };
  },
  template: `
    <div class="modal-overlay" v-if="store.modals.mock" @click.self="closeModal">
      <div 
        class="modal-card modal-mock"
        :class="{ 'modal-fullscreen': isFullscreen, 'modal-lg': !isFullscreen }"
      >
        <!-- 窗口头部工具条 -->
        <div class="modal-header">
          <div class="modal-title">
            <span>⚡ {{ store.mockForm.id ? '编辑 Map Local 规则' : '创建 Map Local (Mock 请求)' }}</span>
            <span v-if="store.mockForm.name" class="modal-subtitle">「{{ store.mockForm.name }}」</span>
          </div>
          <div class="modal-header-actions">
            <!-- 全屏/还原切换按钮 -->
            <button 
              type="button" 
              class="btn btn-default btn-xs" 
              @click="toggleFullscreen" 
              :title="isFullscreen ? '还原为常规弹窗大小' : '最大化铺满全屏'"
            >
              {{ isFullscreen ? '🗗 还原窗口' : '🗖 全屏显示' }}
            </button>
            <button class="close-btn" @click="closeModal" title="关闭窗口">✕</button>
          </div>
        </div>

        <!-- 全屏双栏主工作区 -->
        <div class="modal-body mock-fullscreen-body">
          <!-- 悬浮展开左侧配置按钮 (当左侧已收起折叠时显示) -->
          <button 
            v-if="isSidebarCollapsed" 
            class="mock-sidebar-expand-btn" 
            @click="isSidebarCollapsed = false" 
            title="点击展开左侧规则配置面板"
          >
            <span>▶ 展开规则配置</span>
            <span class="badge-mini-method">{{ store.mockForm.matchMethod }}</span>
            <span class="badge-mini-pattern">{{ store.mockForm.pattern || '/' }}</span>
          </button>

          <!-- 1. 左侧规则配置面板 (支持折叠收起) -->
          <div class="mock-sidebar-panel" :class="{ 'collapsed': isSidebarCollapsed }">
            <div class="mock-sidebar-header">
              <span class="sidebar-title">⚙️ 规则匹配与响应头</span>
              <button 
                type="button" 
                class="btn btn-default btn-xs btn-sidebar-toggle" 
                @click="isSidebarCollapsed = true" 
                title="收起左侧配置，右侧响应体独占全屏宽度"
              >
                ◀ 收起配置
              </button>
            </div>

            <div class="mock-sidebar-content">
              <!-- 规则名称与启用状态 -->
              <div class="form-row">
                <div class="form-group" style="flex: 2;">
                  <label class="form-label">规则名称</label>
                  <input type="text" class="form-input" v-model="store.mockForm.name" placeholder="例如: Mock 用户信息接口" />
                </div>

                <div class="form-group" style="flex: 1;">
                  <label class="form-label">启用状态</label>
                  <div style="padding-top: 6px;">
                    <label class="switch">
                      <input type="checkbox" v-model="store.mockForm.enabled">
                      <span class="slider"></span>
                    </label>
                    <span style="margin-left: 6px; font-size: 11px; color: var(--text-muted);">
                      {{ store.mockForm.enabled ? '已启用' : '已禁用' }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- 拦截匹配条件 -->
              <div class="form-box">
                <div class="form-box-title" style="color: #60a5fa;">
                  1. 拦截匹配条件 (Request Matcher)
                </div>

                <div class="form-row">
                  <div class="form-group" style="flex: 1;">
                    <label class="form-label">请求方法 (Method)</label>
                    <select class="form-select" v-model="store.mockForm.matchMethod">
                      <option value="ALL">ALL (全部方法)</option>
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="DELETE">DELETE</option>
                      <option value="PATCH">PATCH</option>
                    </select>
                  </div>

                  <div class="form-group" style="flex: 1;">
                    <label class="form-label">匹配模式 (Match Mode)</label>
                    <select class="form-select" v-model="store.mockForm.matchType" @change="handleMatchTypeChange(store.mockForm.matchType)">
                      <option value="exact">精确匹配 (Exact URL)</option>
                      <option value="path">仅匹配路径 (Path Only)</option>
                      <option value="contains">包含关键字 (Contains)</option>
                      <option value="regex">正则表达式 (RegExp)</option>
                    </select>
                  </div>
                </div>

                <div class="form-group" style="margin-bottom: 0;">
                  <label class="form-label">目标匹配 URL / 路径 / 正则表达式</label>
                  <input type="text" class="form-input" v-model="store.mockForm.pattern" placeholder="例如: https://api.domain.com/v1/user 或 /v1/user" />
                  <div class="form-hint">
                    提示: 匹配此条件的请求直接返回右侧 Mock 数据，不再向外网转发。
                  </div>
                </div>
              </div>

              <!-- 响应状态码与响应头 -->
              <div class="form-box" style="margin-top: 14px;">
                <div class="form-box-title" style="color: #c084fc;">
                  2. 响应状态与响应头 (Response Info)
                </div>

                <div class="form-row">
                  <div class="form-group" style="flex: 1;">
                    <label class="form-label">HTTP 状态码</label>
                    <input type="number" class="form-input" v-model.number="store.mockForm.statusCode" placeholder="200" />
                  </div>

                  <div class="form-group" style="flex: 1;">
                    <label class="form-label">模拟网络延迟 (ms)</label>
                    <input type="number" class="form-input" v-model.number="store.mockForm.delay" placeholder="0 (不延迟)" />
                  </div>
                </div>

                <div class="form-group" style="margin-bottom: 0;">
                  <label class="form-label">响应头 (Headers JSON)</label>
                  <textarea class="form-textarea" rows="4" v-model="store.mockForm.headersText"></textarea>
                </div>
              </div>
            </div>
          </div>

          <!-- 2. 右侧全屏工作区：响应内容 JsonTreeEditor (支持高度100%全高充满) -->
          <div class="mock-main-content">
            <json-tree-editor v-model="store.mockForm.body" height="100%"></json-tree-editor>
          </div>
        </div>

        <!-- 窗口底部工具条 -->
        <div class="modal-footer mock-fullscreen-footer">
          <div class="footer-left">
            <button 
              type="button" 
              class="btn btn-default btn-sm" 
              @click="toggleSidebar" 
              :title="isSidebarCollapsed ? '展开左侧规则配置面板' : '收起左侧规则配置面板'"
            >
              <span>{{ isSidebarCollapsed ? '▶ 展开左侧配置' : '◀ 折叠左侧配置' }}</span>
            </button>
            <span class="footer-tip-text">
              {{ isSidebarCollapsed ? '左侧配置已收起，当前处于宽屏沉浸式 JSON 编辑模式' : '提示: 点击折叠可使右侧响应体占据全部宽度' }}
            </span>
          </div>

          <div class="footer-right">
            <button class="btn btn-default" @click="closeModal">取消</button>
            <button class="btn btn-purple" @click="actions.saveMockRule">
              <span>💾 保存并启用 Mock</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `
};
