import { ref, computed } from '/vendor/vue.esm-browser.js';
import { formatJson, parseCookies, parseUrl, highlightJson, escapeHtml } from '../utils/formatters.js';
import { actions } from '../store.js';

export default {
  name: 'RequestViewer',
  props: {
    request: {
      type: Object,
      required: true
    }
  },
  setup(props) {
    const activeSubTab = ref('json'); // 'json' | 'headers' | 'cookies' | 'query' | 'raw'

    const jsonInfo = computed(() => {
      return formatJson(props.request.requestBody);
    });

    const isJson = computed(() => {
      return jsonInfo.value.isValidJson;
    });

    const lines = computed(() => {
      const text = activeSubTab.value === 'raw' 
        ? (props.request.requestBody || '') 
        : jsonInfo.value.formatted;
      return text ? text.split('\n') : ['(无请求体)'];
    });

    const highlightedContent = computed(() => {
      if (activeSubTab.value === 'json') {
        if (!props.request.requestBody) {
          return '<span style="color: var(--text-dim);">(无请求体)</span>';
        }
        if (jsonInfo.value.isValidJson && jsonInfo.value.formatted) {
          return highlightJson(jsonInfo.value.formatted);
        }
        return escapeHtml(props.request.requestBody);
      }
      const raw = props.request.requestBody || '';
      return raw ? escapeHtml(raw) : '<span style="color: var(--text-dim);">(无请求体)</span>';
    });

    const cookies = computed(() => {
      const cookieHeader = props.request.requestHeaders?.cookie || '';
      return parseCookies(cookieHeader);
    });

    const queryParams = computed(() => {
      return parseUrl(props.request.url).params || {};
    });

    const isParamJson = (val) => {
      if (!val || typeof val !== 'string') return false;
      const trimmed = val.trim();
      return (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
    };

    const renderParamValue = (val) => {
      if (isParamJson(val)) {
        const info = formatJson(val);
        if (info.isValidJson) {
          return highlightJson(info.formatted);
        }
      }
      return escapeHtml(String(val ?? ''));
    };

    const copyBody = () => {
      const text = (activeSubTab.value === 'json' && jsonInfo.value.formatted) 
        ? jsonInfo.value.formatted 
        : (props.request.requestBody || '');
      actions.copy(text, '请求体已复制');
    };

    return {
      activeSubTab,
      jsonInfo,
      isJson,
      lines,
      highlightedContent,
      cookies,
      queryParams,
      isParamJson,
      renderParamValue,
      copyBody,
      actions
    };
  },
  template: `
    <div class="half-panel request-panel">
      <!-- 区域头部与子 Tab -->
      <div class="panel-section-header">
        <div class="section-badge request-badge">
          <span>📤 请求 (Request)</span>
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
            Headers ({{ Object.keys(request.requestHeaders || {}).length }})
          </button>
          <button 
            class="sub-tab-btn" 
            :class="{ active: activeSubTab === 'query' }" 
            @click="activeSubTab = 'query'"
          >
            Query ({{ Object.keys(queryParams).length }})
          </button>
          <button 
            class="sub-tab-btn" 
            :class="{ active: activeSubTab === 'cookies' }" 
            @click="activeSubTab = 'cookies'"
          >
            Cookies ({{ Object.keys(cookies).length }})
          </button>
          <button 
            class="sub-tab-btn" 
            :class="{ active: activeSubTab === 'raw' }" 
            @click="activeSubTab = 'raw'"
          >
            Raw
          </button>
        </div>

        <div style="margin-left: auto;">
          <button class="btn btn-default btn-xs" @click="copyBody()">
            复制内容
          </button>
        </div>
      </div>

      <!-- 内容展示区域 (类似 Charles 带有代码行号与语法高亮) -->
      <div class="panel-content-area">
        <!-- JSON / Raw 文本视图 (支持 JSON 语法着色) -->
        <div v-if="activeSubTab === 'json' || activeSubTab === 'raw'" class="code-editor-view">
          <div class="code-line-numbers">
            <span v-for="n in lines.length" :key="n">{{ n }}</span>
          </div>
          <div class="code-lines-content">
            <pre><code v-html="highlightedContent"></code></pre>
          </div>
        </div>

        <!-- Headers 表格视图 -->
        <div v-else-if="activeSubTab === 'headers'" class="key-value-container">
          <table class="key-value-table">
            <tr v-for="(v, k) in request.requestHeaders" :key="k">
              <td class="key">{{ k }}</td>
              <td class="value">{{ v }}</td>
            </tr>
          </table>
        </div>

        <!-- Query 参数表格视图 (Query 参数中包含的 JSON 亦支持格式化与高亮) -->
        <div v-else-if="activeSubTab === 'query'" class="key-value-container">
          <div v-if="Object.keys(queryParams).length === 0" class="empty-hint">
            该 URL 无 Query 查询参数
          </div>
          <table v-else class="key-value-table">
            <tr v-for="(v, k) in queryParams" :key="k">
              <td class="key">{{ k }}</td>
              <td class="value">
                <pre v-if="isParamJson(v)" class="query-json-pre"><code v-html="renderParamValue(v)"></code></pre>
                <span v-else>{{ v }}</span>
              </td>
            </tr>
          </table>
        </div>

        <!-- Cookies 表格视图 -->
        <div v-else-if="activeSubTab === 'cookies'" class="key-value-container">
          <div v-if="Object.keys(cookies).length === 0" class="empty-hint">
            请求中未携带 Cookie
          </div>
          <table v-else class="key-value-table">
            <tr v-for="(v, k) in cookies" :key="k">
              <td class="key">{{ k }}</td>
              <td class="value">{{ v }}</td>
            </tr>
          </table>
        </div>
      </div>
    </div>
  `
};
