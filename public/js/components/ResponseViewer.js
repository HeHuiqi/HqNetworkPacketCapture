import { ref, computed } from '/vendor/vue.esm-browser.js';
import { formatJson, parseCookies } from '../utils/formatters.js';
import { actions } from '../store.js';

export default {
  name: 'ResponseViewer',
  props: {
    request: {
      type: Object,
      required: true
    }
  },
  setup(props) {
    const activeSubTab = ref('json'); // 'json' | 'headers' | 'cookies' | 'raw'

    const jsonInfo = computed(() => {
      return formatJson(props.request.responseBody);
    });

    const lines = computed(() => {
      const text = activeSubTab.value === 'raw' 
        ? (props.request.responseBody || '') 
        : jsonInfo.value.formatted;
      return text ? text.split('\n') : ['(无响应体或请求处理中)'];
    });

    const setCookies = computed(() => {
      const setCookie = props.request.responseHeaders?.['set-cookie'] || '';
      return parseCookies(Array.isArray(setCookie) ? setCookie.join('; ') : setCookie);
    });

    return {
      activeSubTab,
      jsonInfo,
      lines,
      setCookies,
      actions
    };
  },
  template: `
    <div class="half-panel response-panel">
      <!-- 区域头部与子 Tab -->
      <div class="panel-section-header">
        <div class="section-badge response-badge">
          <span>📥 响应 (Response)</span>
          <span v-if="request.isMocked" class="badge-mock-mini" style="margin-left: 6px;">
            ⚡ Map Local 拦截
          </span>
        </div>

        <div class="sub-tabs-group">
          <button 
            class="sub-tab-btn" 
            :class="{ active: activeSubTab === 'json' }" 
            @click="activeSubTab = 'json'"
          >
            JSON Text
          </button>
          <button 
            class="sub-tab-btn" 
            :class="{ active: activeSubTab === 'headers' }" 
            @click="activeSubTab = 'headers'"
          >
            Headers ({{ Object.keys(request.responseHeaders || {}).length }})
          </button>
          <button 
            class="sub-tab-btn" 
            :class="{ active: activeSubTab === 'cookies' }" 
            @click="activeSubTab = 'cookies'"
          >
            Set-Cookie ({{ Object.keys(setCookies).length }})
          </button>
          <button 
            class="sub-tab-btn" 
            :class="{ active: activeSubTab === 'raw' }" 
            @click="activeSubTab = 'raw'"
          >
            Raw
          </button>
        </div>

        <div style="margin-left: auto; display: flex; gap: 8px;">
          <button class="btn btn-purple btn-xs" @click="actions.openMockModal(request)">
            ⚡ Map Local (以此数据 Mock)
          </button>
          <button class="btn btn-default btn-xs" @click="actions.copy(request.responseBody || '', '响应内容已复制')">
            复制响应
          </button>
        </div>
      </div>

      <!-- 内容展示区域 (类似 Charles 带有代码行号) -->
      <div class="panel-content-area">
        <!-- JSON / Raw 视图 -->
        <div v-if="activeSubTab === 'json' || activeSubTab === 'raw'" class="code-editor-view">
          <div class="code-line-numbers">
            <span v-for="n in lines.length" :key="n">{{ n }}</span>
          </div>
          <div class="code-lines-content">
            <pre><code>{{ lines.join('\\n') }}</code></pre>
          </div>
        </div>

        <!-- 响应头表格视图 -->
        <div v-else-if="activeSubTab === 'headers'" class="key-value-container">
          <table class="key-value-table">
            <tr v-for="(v, k) in request.responseHeaders" :key="k">
              <td class="key">{{ k }}</td>
              <td class="value">{{ v }}</td>
            </tr>
          </table>
        </div>

        <!-- Set-Cookie 表格视图 -->
        <div v-else-if="activeSubTab === 'cookies'" class="key-value-container">
          <div v-if="Object.keys(setCookies).length === 0" class="empty-hint">
            响应未返回 Set-Cookie
          </div>
          <table v-else class="key-value-table">
            <tr v-for="(v, k) in setCookies" :key="k">
              <td class="key">{{ k }}</td>
              <td class="value">{{ v }}</td>
            </tr>
          </table>
        </div>
      </div>
    </div>
  `
};
