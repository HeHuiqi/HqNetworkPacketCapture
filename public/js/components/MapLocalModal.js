import { store, actions } from '../store.js';
import { formatJson } from '../utils/formatters.js';

export default {
  name: 'MapLocalModal',
  setup() {
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
      handleMatchTypeChange,
      formatJsonBody,
      minifyJsonBody,
      closeModal
    };
  },
  template: `
    <div class="modal-overlay" v-if="store.modals.mock" @click.self="closeModal">
      <div class="modal-card modal-lg">
        <div class="modal-header">
          <div class="modal-title">
            <span>⚡ {{ store.mockForm.id ? '编辑 Map Local 规则' : '创建 Map Local (Mock 请求)' }}</span>
          </div>
          <button class="close-btn" @click="closeModal">✕</button>
        </div>

        <div class="modal-body">
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
                <span style="margin-left: 8px; font-size: 12px; color: var(--text-muted);">
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
                  <option value="path">仅匹配路径 (Path Only，忽略域名与Query)</option>
                  <option value="contains">包含关键字 (Contains Substring)</option>
                  <option value="regex">正则表达式 (RegExp)</option>
                </select>
              </div>
            </div>

            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">目标匹配 URL / 路径 / 规则表达式</label>
              <input type="text" class="form-input" v-model="store.mockForm.pattern" placeholder="例如: https://api.domain.com/v1/user 或 /v1/user" />
              <div class="form-hint">
                提示: 当客户端发起匹配此条件的请求时，代理直接返回下方 Mock 数据，不再向外网转发请求。
              </div>
            </div>
          </div>

          <!-- 响应 Mock 数据配置 -->
          <div class="form-box" style="margin-top: 14px;">
            <div class="form-box-title" style="color: #c084fc;">
              2. 模拟返回响应 (Mock Response - 已默认全量填充，便于就地修改)
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 1;">
                <label class="form-label">HTTP 状态码</label>
                <input type="number" class="form-input" v-model.number="store.mockForm.statusCode" placeholder="200" />
              </div>

              <div class="form-group" style="flex: 1;">
                <label class="form-label">模拟网络延迟 (毫秒 ms)</label>
                <input type="number" class="form-input" v-model.number="store.mockForm.delay" placeholder="0 (不延迟)" />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">响应头 (Headers JSON)</label>
              <textarea class="form-textarea" rows="3" v-model="store.mockForm.headersText"></textarea>
            </div>

            <div class="form-group" style="margin-bottom: 0;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label class="form-label" style="margin-bottom: 0;">响应内容 (Response Body)</label>
                <div style="display: flex; gap: 6px;">
                  <button type="button" class="btn btn-default btn-xs" @click="formatJsonBody">✨ 格式化 JSON</button>
                  <button type="button" class="btn btn-default btn-xs" @click="minifyJsonBody">压缩单行</button>
                </div>
              </div>
              <textarea class="form-textarea" rows="8" v-model="store.mockForm.body" placeholder='{"code": 0, "message": "mocked success"}'></textarea>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-default" @click="closeModal">取消</button>
          <button class="btn btn-purple" @click="actions.saveMockRule">
            <span>💾 保存并启用 Mock</span>
          </button>
        </div>
      </div>
    </div>
  `
};
