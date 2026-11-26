import { ref, computed } from '/vendor/vue.esm-browser.js';
import { selectedRequest, actions } from '../store.js';
import { generateCurl, formatDuration } from '../utils/formatters.js';
import { isDirectProbe } from '../utils/treeHelper.js';
import RequestViewer from './RequestViewer.js';
import ResponseViewer from './ResponseViewer.js';

export default {
  name: 'RightPanel',
  components: {
    RequestViewer,
    ResponseViewer
  },
  setup() {
    // 上下分栏的高度百分比（默认请求占 48%）
    const requestHeightPercent = ref(
      parseFloat(localStorage.getItem('hq_request_height_percent') || '48')
    );
    const isDragging = ref(false);
    const showUrlModal = ref(false);

    const isProbeRequest = computed(() => {
      return isDirectProbe(selectedRequest.value);
    });

    const parsedUrlInfo = computed(() => {
      const url = selectedRequest.value?.url || '';
      try {
        const u = new URL(url);
        const params = [];
        u.searchParams.forEach((val, key) => {
          params.push({ key, val });
        });
        return {
          protocol: u.protocol.replace(':', ''),
          origin: u.origin,
          pathname: u.pathname,
          search: u.search,
          hash: u.hash,
          params
        };
      } catch (e) {
        return {
          protocol: '',
          origin: '',
          pathname: url,
          search: '',
          hash: '',
          params: []
        };
      }
    });

    const onMouseDownResizer = (e) => {
      e.preventDefault();
      isDragging.value = true;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';

      const container = e.target.closest('.right-split-panel');
      if (!container) return;
      const containerRect = container.getBoundingClientRect();

      const onMouseMove = (moveEvent) => {
        const offsetY = moveEvent.clientY - containerRect.top - 40; // 减去头部高度
        const totalHeight = containerRect.height - 40;
        let percent = (offsetY / totalHeight) * 100;
        if (percent < 15) percent = 15;
        if (percent > 85) percent = 85;
        requestHeightPercent.value = percent;
      };

      const onMouseUp = () => {
        isDragging.value = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('hq_request_height_percent', String(Math.round(requestHeightPercent.value)));
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };

    const copyCurl = () => {
      if (selectedRequest.value) {
        const curl = generateCurl(selectedRequest.value);
        actions.copy(curl, 'cURL 命令已复制');
      }
    };

    return {
      selectedRequest,
      actions,
      requestHeightPercent,
      isDragging,
      showUrlModal,
      parsedUrlInfo,
      onMouseDownResizer,
      copyCurl,
      formatDuration,
      isProbeRequest
    };
  },
  template: `
    <div class="right-split-panel" v-if="selectedRequest">
      <!-- 类似 Charles 顶部的事务总览标题栏 -->
      <div class="right-panel-titlebar">
        <div class="titlebar-main">
          <span class="badge-method" :class="(selectedRequest.method || '').toLowerCase()">
            {{ selectedRequest.method }}
          </span>
          <span 
            class="titlebar-url" 
            :title="'双击或点击右侧查看完整 URL:\\n' + selectedRequest.url"
            @dblclick="showUrlModal = true"
          >
            {{ selectedRequest.url }}
          </span>
          <span 
            v-if="selectedRequest.isMocked" 
            class="badge-mock" 
            style="margin-left: 8px;"
          >
            ⚡ MOCK {{ selectedRequest.statusCode }}
          </span>
          <span 
            v-else-if="selectedRequest.statusCode" 
            class="titlebar-status" 
            :class="'status-' + String(selectedRequest.statusCode)[0] + 'xx'"
          >
            ➔ {{ selectedRequest.statusCode }} {{ selectedRequest.statusMessage }}
          </span>
          <span class="titlebar-duration">
            ({{ formatDuration(selectedRequest.duration) }})
          </span>
        </div>

        <div class="titlebar-actions">
          <button class="btn btn-default btn-xs" @click="showUrlModal = true" title="查看完整 URL 与分解参数">
            <span>🔍 查看 URL</span>
          </button>
          <button class="btn btn-default btn-xs" @click="actions.copy(selectedRequest.url, 'URL 已复制')" title="一键复制完整 URL 到剪贴板">
            <span>📋 复制 URL</span>
          </button>
          <button class="btn btn-purple btn-xs" @click="actions.openMockModal(selectedRequest)">
            <span>⚡ Map Local (Mock)</span>
          </button>
          <button class="btn btn-default btn-xs" @click="copyCurl">
            <span>💻 复制 cURL</span>
          </button>
        </div>
      </div>

      <!-- 探测请求特别说明条 -->
      <div v-if="isProbeRequest" class="probe-alert-bar">
        <span class="probe-alert-icon">⚠️</span>
        <div class="probe-alert-content">
          <strong>无 Host 目标探测请求 (客户端直接访问代理端口)</strong>：
          客户端直接向代理端口发起了 HTTP 请求，但未携带 <code>Host</code> 头或未指定目标域名。代理服务无法获知上游转发地址，因此按 HTTP 规范直接返回 <code>503 Service Unavailable</code>。这类请求常见于操作系统连通性探活、系统守护进程或扫描器。若无需关注，可点击左上方 <code>🛡️</code> 盾牌按钮一键过滤隐藏。
        </div>
      </div>

      <!-- 上半部分：请求 Request -->
      <div class="split-top-wrapper" :style="{ height: requestHeightPercent + '%' }">
        <request-viewer :request="selectedRequest"></request-viewer>
      </div>

      <!-- 中间可拖拽调整高度的分隔条 (Resizer) -->
      <div 
        class="resizer-horizontal" 
        :class="{ dragging: isDragging }"
        @mousedown="onMouseDownResizer"
        title="上下拖拽调整高度"
      >
        <div class="resizer-handle"></div>
      </div>

      <!-- 下半部分：响应 Response -->
      <div class="split-bottom-wrapper" :style="{ height: (100 - requestHeightPercent) + '%' }">
        <response-viewer :request="selectedRequest"></response-viewer>
      </div>

      <!-- 完整 URL 详情预览弹窗 -->
      <div v-if="showUrlModal" class="modal-overlay" @click.self="showUrlModal = false">
        <div class="modal-card url-preview-modal-card">
          <div class="modal-header">
            <h3>🔗 完整 URL 详情与解析</h3>
            <button class="modal-close" @click="showUrlModal = false">✕</button>
          </div>

          <div class="modal-body url-preview-modal-body">
            <!-- 完整 URL 文本展示 (自动换行，支持全选与一键复制) -->
            <div class="url-full-box">
              <div class="url-full-header">
                <span class="url-full-label">完整 URL (Full URL)</span>
                <button 
                  type="button" 
                  class="btn btn-default btn-xs" 
                  @click="actions.copy(selectedRequest.url, '完整 URL 已复制')"
                >
                  📋 复制完整 URL
                </button>
              </div>
              <div class="url-full-text">{{ selectedRequest.url }}</div>
            </div>

            <!-- URL 结构分解 (Host, Path, Query Params) -->
            <div class="url-parts-container">
              <div class="url-part-item">
                <span class="url-part-label">域名 (Origin):</span>
                <span class="url-part-val">{{ parsedUrlInfo.origin || '(无)' }}</span>
              </div>
              <div class="url-part-item">
                <span class="url-part-label">路径 (Path):</span>
                <span class="url-part-val">{{ parsedUrlInfo.pathname || '/' }}</span>
              </div>
              <div v-if="parsedUrlInfo.params.length > 0" class="url-part-item url-params-block">
                <span class="url-part-label">Query 查询参数 ({{ parsedUrlInfo.params.length }} 个):</span>
                <table class="url-params-table">
                  <thead>
                    <tr>
                      <th style="width: 35%;">参数名 (Key)</th>
                      <th>参数值 (Value)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="p in parsedUrlInfo.params" :key="p.key">
                      <td class="param-key">{{ p.key }}</td>
                      <td class="param-val">{{ p.val }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-default" @click="showUrlModal = false">关闭</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 未选中请求时的占位提示 -->
    <div class="right-split-panel empty-selection" v-else>
      <div style="font-size: 40px; margin-bottom: 12px;">🌳</div>
      <div style="font-size: 15px; font-weight: 600; color: var(--text-main);">从左侧目录选择一条请求</div>
      <div style="font-size: 12px; color: var(--text-dim); margin-top: 6px;">
        左侧已按照不同域名建立目录，展开可查看具体接口请求
      </div>
      <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
        在任意请求上 <strong>右键点击</strong> 可直接创建 Map Local Mock 规则
      </div>
    </div>
  `
};
