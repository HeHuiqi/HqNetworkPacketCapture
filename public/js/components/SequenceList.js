import { store, filteredRequests, actions } from '../store.js';
import { formatTime, formatDuration, parseUrl } from '../utils/formatters.js';

export default {
  name: 'SequenceList',
  setup() {
    const getHost = (url, headers) => {
      if (headers && headers.host) return headers.host;
      return parseUrl(url).host || '-';
    };

    const getPath = (url, path) => {
      if (path) return path;
      const u = parseUrl(url);
      return (u.pathname || '/') + (u.search || '');
    };

    return {
      store,
      filteredRequests,
      actions,
      formatTime,
      formatDuration,
      getHost,
      getPath
    };
  },
  template: `
    <div class="sequence-table-container">
      <div class="sequence-table-header">
        <div class="seq-col col-idx">#</div>
        <div class="seq-col col-method">方法</div>
        <div class="seq-col col-status">状态</div>
        <div class="seq-col col-host">域名 (Host)</div>
        <div class="seq-col col-path">路径与参数 (Path)</div>
        <div class="seq-col col-duration">耗时</div>
        <div class="seq-col col-time">时间</div>
      </div>

      <div class="sequence-table-body">
        <div 
          v-for="(item, index) in filteredRequests" 
          :key="item.id"
          class="sequence-row"
          :class="{ active: store.selectedId === item.id, mocked: item.isMocked }"
          @click="actions.selectRequest(item.id)"
          @contextmenu="actions.openContextMenu($event, item)"
        >
          <div class="seq-col col-idx">
            {{ filteredRequests.length - index }}
          </div>

          <div class="seq-col col-method">
            <span class="badge-method" :class="(item.method || '').toLowerCase()">
              {{ item.method }}
            </span>
          </div>

          <div class="seq-col col-status">
            <span v-if="item.isMocked" class="badge-mock-mini">⚡ MOCK</span>
            <span v-else-if="item.statusCode" class="badge-status" :class="'status-' + String(item.statusCode)[0] + 'xx'">
              {{ item.statusCode }}
            </span>
            <span v-else class="badge-status status-pending">...</span>
          </div>

          <div class="seq-col col-host" :title="getHost(item.url, item.requestHeaders)">
            {{ getHost(item.url, item.requestHeaders) }}
          </div>

          <div class="seq-col col-path" :title="getPath(item.url, item.path)">
            {{ getPath(item.url, item.path) }}
          </div>

          <div class="seq-col col-duration">
            {{ formatDuration(item.duration) }}
          </div>

          <div class="seq-col col-time">
            {{ formatTime(item.requestTime) }}
          </div>
        </div>

        <div v-if="filteredRequests.length === 0" class="tree-empty-state">
          <div>无匹配请求</div>
        </div>
      </div>
    </div>
  `
};
