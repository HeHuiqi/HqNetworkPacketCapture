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
    const requestHeightPercent = ref(48);
    const isDragging = ref(false);

    const isProbeRequest = computed(() => {
      return isDirectProbe(selectedRequest.value);
    });

    const onMouseDownResizer = (e) => {
      e.preventDefault();
      isDragging.value = true;

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
          <span class="titlebar-url" :title="selectedRequest.url">
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
          <button class="btn btn-purple btn-xs" @click="actions.openMockModal(selectedRequest)">
            <span>⚡ Map Local (Mock)</span>
          </button>
          <button class="btn btn-default btn-xs" @click="copyCurl">
            <span>💻 复制 cURL</span>
          </button>
          <button class="btn btn-default btn-xs" @click="actions.copy(selectedRequest.url, 'URL 已复制')">
            <span>📋 复制 URL</span>
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
      <div class="resizer-horizontal" @mousedown="onMouseDownResizer">
        <div class="resizer-handle"></div>
      </div>

      <!-- 下半部分：响应 Response -->
      <div class="split-bottom-wrapper" :style="{ height: (100 - requestHeightPercent) + '%' }">
        <response-viewer :request="selectedRequest"></response-viewer>
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
