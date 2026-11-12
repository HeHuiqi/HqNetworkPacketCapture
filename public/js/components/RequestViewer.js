import { ref, computed } from '/vendor/vue.esm-browser.js';
import { formatJson, parseCookies, parseUrl, highlightJson, escapeHtml, formatBytes } from '../utils/formatters.js';
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
    const showRawHex = ref(false); // 默认收起 Hex，按需展开

    const jsonInfo = computed(() => {
      return formatJson(props.request.requestBody);
    });

    const isJson = computed(() => {
      return jsonInfo.value.isValidJson;
    });

    const isProtobuf = computed(() => {
      const ct = (props.request.requestHeaders?.['content-type'] || '').toLowerCase();
      return !!props.request.requestIsProtobuf || 
             !!props.request.isProtobuf || 
             ct.includes('protobuf') ||
             ct.includes('application/xcp') ||
             ct.includes('/xcp') ||
             ct.includes('grpc');
    });

    const isGrpc = computed(() => {
      const ct = (props.request.requestHeaders?.['content-type'] || '').toLowerCase();
      return !!props.request.requestIsGrpc || 
             !!props.request.isGrpc || 
             ct.includes('grpc');
    });

    const isEncrypted = computed(() => {
      const h = props.request.requestHeaders || {};
      const ct = (h['content-type'] || '').toLowerCase();
      const body = props.request.requestBody || '';
      return !!props.request.requestIsAppEncrypted || 
             !!props.request.isAppEncrypted || 
             body.includes('应用层加密') || 
             body.includes('XiaoChuan XCP') || 
             !!h['x-xc-proto-req'] || 
             (ct.includes('application/xcp') && !jsonInfo.value.isValidJson);
    });

    // 核心判定：是否为不可读的纯二进制流或应用层密文
    const isBinary = computed(() => {
      if (isJson.value) return false;
      const req = props.request;
      return !!req.requestIsBinary || 
             (req.requestBody && /^(\[Protobuf|\[二进制数据|🔒 \[应用层|0x[0-9a-fA-F]{30,})/.test(req.requestBody.trim())) ||
             (isEncrypted.value && !jsonInfo.value.isValidJson);
    });

    const binarySize = computed(() => {
      const req = props.request;
      if (req.requestBinarySize) return req.requestBinarySize;
      if (req.requestBinaryHex) return req.requestBinaryHex.length / 2;
      const match = (req.requestBody || '').match(/(\d+)\s*字节/);
      if (match) return parseInt(match[1], 10);
      return 0;
    });

    const binaryHex = computed(() => {
      const req = props.request;
      if (req.requestBinaryHex) return req.requestBinaryHex;
      const match = (req.requestBody || '').match(/0x([0-9a-fA-F]+)/);
      if (match) return match[1];
      return '';
    });

    const copyHex = () => {
      if (binaryHex.value) {
        actions.copy('0x' + binaryHex.value, `已复制 ${formatBytes(binarySize.value)} Hex 密文数据`);
      } else if (props.request.requestBody) {
        actions.copy(props.request.requestBody, '数据已复制');
      }
    };

    const downloadRequestBinary = () => {
      if (!binaryHex.value) return;
      try {
        const hex = binaryHex.value;
        const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `request_${props.request.id || Date.now()}.bin`;
        a.click();
        URL.revokeObjectURL(a.href);
        actions.showToast('请求体二进制文件已下载', 'success');
      } catch (e) {
        actions.showToast('下载失败: ' + e.message, 'error');
      }
    };

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
      if (isBinary.value) {
        copyHex();
        return;
      }
      const text = (activeSubTab.value === 'json' && jsonInfo.value.formatted) 
        ? jsonInfo.value.formatted 
        : (props.request.requestBody || '');
      actions.copy(text, '请求体已复制');
    };

    return {
      activeSubTab,
      jsonInfo,
      isProtobuf,
      isEncrypted,
      isGrpc,
      isJson,
      isBinary,
      binarySize,
      binaryHex,
      showRawHex,
      copyHex,
      downloadRequestBinary,
      lines,
      highlightedContent,
      cookies,
      queryParams,
      isParamJson,
      renderParamValue,
      copyBody,
      formatBytes,
      actions
    };
  },
  template: `
    <div class="half-panel request-panel">
      <!-- 区域头部与子 Tab -->
      <div class="panel-section-header">
        <div class="section-badge request-badge">
          <span>📤 请求 (Request)</span>
          <span v-if="isGrpc && jsonInfo.isValidJson" class="badge-grpc" title="gRPC 帧解包 (拆解 5 字节帧头并反编译 Protobuf)">
            ⚡ gRPC (Protobuf)
          </span>
          <span v-else-if="isEncrypted && isBinary" class="badge-crypto-aes" title="检测到应用层二次加密(AES密文)，非裸Protobuf">
            🔒 AES 密文 ({{ formatBytes(binarySize) }})
          </span>
          <span v-else-if="isBinary" class="badge-binary-tag" title="原始二进制数据流">
            📦 二进制 ({{ formatBytes(binarySize) }})
          </span>
          <span v-else-if="isProtobuf && jsonInfo.isValidJson" style="margin-left: 6px; padding: 1px 6px; border-radius: 4px; font-size: 10px; background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.35); font-weight: normal;" title="基于 Wire Format 逆向反编译为 JSON 结构">
            📦 Protobuf 已解码
          </span>
        </div>

        <div class="sub-tabs-group">
          <button 
            class="sub-tab-btn" 
            :class="{ active: activeSubTab === 'json' }" 
            @click="activeSubTab = 'json'"
          >
            {{ isEncrypted && isBinary ? '🔒 AES 密文' : (isBinary ? '📦 二进制数据' : (isGrpc ? '⚡ gRPC (JSON)' : (isProtobuf ? '📦 Protobuf (JSON)' : 'JSON Text'))) }}
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
            {{ isBinary ? '复制 Hex' : '复制内容' }}
          </button>
        </div>
      </div>

      <!-- 内容展示区域 -->
      <div class="panel-content-area">
        <!-- 1. 二进制数据 / 密文专属卡片展示 (不在显示区中平铺乱码 0x... 文本) -->
        <div v-if="(activeSubTab === 'json' || activeSubTab === 'raw') && isBinary" class="binary-state-wrapper">
          <div class="binary-state-card">
            <div class="binary-state-icon">{{ isEncrypted ? '🔒' : '📦' }}</div>
            <div class="binary-state-info">
              <div class="binary-state-title">
                {{ isEncrypted ? '应用层二次加密密文 (AES-CBC / XCP)' : (isProtobuf ? '未识别的 Protobuf 原始二进制' : '二进制原始数据流') }}
              </div>
              <div class="binary-state-tags">
                <span class="binary-tag">📦 大小: {{ formatBytes(binarySize) }}</span>
                <span class="binary-tag" v-if="request.requestHeaders?.['content-type']">类型: {{ request.requestHeaders['content-type'] }}</span>
                <span class="binary-tag" v-if="isEncrypted">协议: XCP 动态密钥</span>
              </div>
              <div class="binary-state-desc" v-if="isEncrypted">
                该报文在客户端被私有对称密钥加密（密文流）。已完成标记，正文显示区<strong>不平铺展示无意义的乱码十六进制</strong>。若需逆向分析，可通过以下操作导出或复制。
              </div>
              <div class="binary-state-desc" v-else>
                当前请求体为二进制原始字节流。已完成标记，正文显示区<strong>不平铺展示无意义的十六进制乱码</strong>。
              </div>
              <div class="binary-state-actions">
                <button class="btn btn-default btn-xs" @click="copyHex" v-if="binaryHex">
                  📋 复制十六进制 (Hex)
                </button>
                <button class="btn btn-default btn-xs" @click="downloadRequestBinary" v-if="binaryHex">
                  📥 下载为 .bin 文件
                </button>
                <button class="btn btn-default btn-xs" @click="showRawHex = !showRawHex" v-if="binaryHex">
                  {{ showRawHex ? '🙈 收起 Hex' : '👁️ 按需展开 Hex' }}
                </button>
              </div>

              <!-- 只有用户主动点击时才展开预览 -->
              <div v-if="showRawHex" class="binary-hex-box">
                <pre><code>0x{{ binaryHex }}</code></pre>
              </div>
            </div>
          </div>
        </div>

        <!-- 2. 正常 JSON / Raw 文本视图 (支持 JSON 语法着色) -->
        <div v-else-if="activeSubTab === 'json' || activeSubTab === 'raw'" class="editor-outer-wrapper">
          <div class="code-editor-view">
            <div class="code-line-numbers">
              <span v-for="n in lines.length" :key="n">{{ n }}</span>
            </div>
            <div class="code-lines-content">
              <pre><code v-html="highlightedContent"></code></pre>
            </div>
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
