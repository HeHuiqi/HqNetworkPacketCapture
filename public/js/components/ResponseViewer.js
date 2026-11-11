import { ref, computed, watch } from '/vendor/vue.esm-browser.js';
import { formatJson, parseCookies, formatBytes, getFilenameFromUrl, highlightJson, escapeHtml } from '../utils/formatters.js';
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
    const activeSubTab = ref('json');
    const imgNaturalWidth = ref(0);
    const imgNaturalHeight = ref(0);
    const imgFitMode = ref('fit'); // 'fit' | 'original'
    const imgLoadError = ref(false);

    const is304 = computed(() => {
      return Number(props.request.statusCode) === 304;
    });

    const contentType = computed(() => {
      return (props.request.responseHeaders?.['content-type'] || '').toLowerCase();
    });

    const contentLength = computed(() => {
      return props.request.responseHeaders?.['content-length'] || null;
    });

    const isHeic = computed(() => {
      const ct = contentType.value;
      const u = (props.request.url || '').toLowerCase();
      return !!props.request.isHeic || 
             ct.includes('image/heic') || 
             ct.includes('image/heif') || 
             /\.(heic|heif)(\?|$)/i.test(u);
    });

    const isImage = computed(() => {
      const ct = contentType.value;
      const u = (props.request.url || '').toLowerCase();
      return props.request.isImage || 
             isHeic.value || 
             ct.startsWith('image/') || 
             /\.(png|jpe?g|gif|webp|svg|ico|avif|bmp|heic|heif)(\?|$)/i.test(u);
    });

    const isVideo = computed(() => {
      const ct = contentType.value;
      const u = (props.request.url || '').toLowerCase();
      return props.request.isVideo || ct.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv|avi|flv|m3u8)(\?|$)/i.test(u);
    });

    const isAudio = computed(() => {
      const ct = contentType.value;
      const u = (props.request.url || '').toLowerCase();
      return props.request.isAudio || ct.startsWith('audio/') || /\.(mp3|wav|ogg|aac|m4a|flac)(\?|$)/i.test(u);
    });

    const isHtml = computed(() => {
      const ct = contentType.value;
      const u = (props.request.url || '').toLowerCase();
      return props.request.isHtml || ct.includes('text/html') || /\.(html?|xhtml)(\?|$)/i.test(u);
    });

    const isProtobuf = computed(() => {
      const ct = contentType.value;
      return !!props.request.isProtobuf || 
             ct.includes('protobuf') || 
             ct.includes('application/xcp') ||
             ct.includes('/xcp') ||
             props.request.bodyType === 'protobuf';
    });

    const isJs = computed(() => {
      const ct = contentType.value;
      const u = (props.request.url || '').toLowerCase();
      return ct.includes('javascript') || ct.includes('ecmascript') || /\.(js|mjs)(\?|$)/i.test(u);
    });

    const jsonInfo = computed(() => {
      return formatJson(props.request.responseBody);
    });

    const isJson = computed(() => {
      const ct = contentType.value;
      return ct.includes('json') || props.request.isJson || isProtobuf.value || jsonInfo.value.isValidJson;
    });

    const lines = computed(() => {
      if (activeSubTab.value === 'raw' || activeSubTab.value === 'html-source') {
        const text = props.request.responseBody || '';
        return text ? text.split('\n') : ['(无响应体或请求处理中)'];
      }
      return jsonInfo.value.formatted ? jsonInfo.value.formatted.split('\n') : ['(无响应体或请求处理中)'];
    });

    const highlightedContent = computed(() => {
      if (activeSubTab.value === 'json') {
        if (!props.request.responseBody) {
          return '<span style="color: var(--text-dim);">(无响应体或请求处理中)</span>';
        }
        if (jsonInfo.value.isValidJson && jsonInfo.value.formatted) {
          return highlightJson(jsonInfo.value.formatted);
        }
        return escapeHtml(props.request.responseBody);
      }
      const text = props.request.responseBody || '';
      return text ? escapeHtml(text) : '<span style="color: var(--text-dim);">(无响应体或请求处理中)</span>';
    });

    const copyBodyText = () => {
      const text = (activeSubTab.value === 'json' && jsonInfo.value.formatted)
        ? jsonInfo.value.formatted
        : (props.request.responseBody || '');
      actions.copy(text, '响应内容已复制');
    };

    const setCookies = computed(() => {
      const setCookie = props.request.responseHeaders?.['set-cookie'] || '';
      return parseCookies(Array.isArray(setCookie) ? setCookie.join('; ') : setCookie);
    });

    const mediaUrl = computed(() => {
      return `/api/requests/${props.request.id}/body`;
    });

    const imageSrc = computed(() => {
      if (isHeic.value) {
        if (props.request.imageDataUrl) return props.request.imageDataUrl;
        return `/api/requests/${props.request.id}/preview-image`;
      }
      return props.request.imageDataUrl || mediaUrl.value;
    });

    // 智能默认选中最符合当前响应类型的 Tab
    watch(() => props.request.id, () => {
      imgNaturalWidth.value = 0;
      imgNaturalHeight.value = 0;
      imgLoadError.value = false;

      if (isImage.value) {
        activeSubTab.value = 'image';
      } else if (isVideo.value) {
        activeSubTab.value = 'video';
      } else if (isAudio.value) {
        activeSubTab.value = 'audio';
      } else if (isHtml.value) {
        activeSubTab.value = 'html-preview';
      } else if (isJson.value) {
        activeSubTab.value = 'json';
      } else {
        activeSubTab.value = 'raw';
      }
    }, { immediate: true });

    const onImageLoad = (e) => {
      imgLoadError.value = false;
      if (e.target) {
        imgNaturalWidth.value = e.target.naturalWidth;
        imgNaturalHeight.value = e.target.naturalHeight;
      }
    };

    const onImageError = () => {
      imgLoadError.value = true;
    };

    const downloadBody = (forceFormat = null) => {
      let ext = 'bin';
      let url = mediaUrl.value;

      if (isHeic.value) {
        if (forceFormat === 'jpeg') {
          ext = 'jpg';
          url = `/api/requests/${props.request.id}/preview-image`;
        } else {
          ext = 'heic';
          url = mediaUrl.value;
        }
      } else if (isImage.value) {
        ext = 'png';
      } else if (isVideo.value) {
        ext = 'mp4';
      } else if (isAudio.value) {
        ext = 'mp3';
      } else if (isHtml.value) {
        ext = 'html';
      } else if (isJson.value) {
        ext = 'json';
      }

      let filename = getFilenameFromUrl(props.request.url, ext);
      if (isHeic.value && forceFormat === 'jpeg') {
        filename = filename.replace(/\.(heic|heif)$/i, '') + '.jpg';
        if (!filename.endsWith('.jpg')) filename += '.jpg';
      }

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };

    const openInNewTab = () => {
      window.open(mediaUrl.value, '_blank');
    };

    return {
      activeSubTab,
      contentType,
      contentLength,
      isHeic,
      isImage,
      isVideo,
      isAudio,
      isHtml,
      isProtobuf,
      isJs,
      isJson,
      jsonInfo,
      lines,
      highlightedContent,
      setCookies,
      mediaUrl,
      imageSrc,
      imgNaturalWidth,
      imgNaturalHeight,
      imgFitMode,
      imgLoadError,
      is304,
      onImageLoad,
      onImageError,
      downloadBody,
      openInNewTab,
      formatBytes,
      copyBodyText,
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
          <span v-if="isProtobuf" style="margin-left: 6px; padding: 1px 6px; border-radius: 4px; font-size: 10px; background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.35); font-weight: normal;" title="基于 Wire Format 逆向反编译为 JSON 结构">
            📦 Protobuf 已解码
          </span>
          <span v-if="is304" style="margin-left: 6px; padding: 1px 6px; border-radius: 4px; font-size: 10px; background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.35); font-weight: normal;" title="HTTP 304 协商缓存 (抓包工具已自动补全数据)">
            ⚡ 304 缓存补齐
          </span>
        </div>

        <div class="sub-tabs-group">
          <!-- 图片专属 Tab -->
          <button 
            v-if="isImage"
            class="sub-tab-btn" 
            :class="{ active: activeSubTab === 'image' }" 
            @click="activeSubTab = 'image'"
          >
            <span>{{ isHeic ? '🖼️ HEIC 图像' : '🖼️ 图片 (Image)' }}</span>
          </button>

          <!-- 视频专属 Tab -->
          <button 
            v-if="isVideo"
            class="sub-tab-btn" 
            :class="{ active: activeSubTab === 'video' }" 
            @click="activeSubTab = 'video'"
          >
            🎬 视频 (Video)
          </button>

          <!-- 音频专属 Tab -->
          <button 
            v-if="isAudio"
            class="sub-tab-btn" 
            :class="{ active: activeSubTab === 'audio' }" 
            @click="activeSubTab = 'audio'"
          >
            🎵 音频 (Audio)
          </button>

          <!-- HTML 专属 Tab (渲染预览与源码) -->
          <button 
            v-if="isHtml"
            class="sub-tab-btn" 
            :class="{ active: activeSubTab === 'html-preview' }" 
            @click="activeSubTab = 'html-preview'"
          >
            🌐 网页预览 (HTML)
          </button>
          <button 
            v-if="isHtml"
            class="sub-tab-btn" 
            :class="{ active: activeSubTab === 'html-source' }" 
            @click="activeSubTab = 'html-source'"
          >
            📝 HTML 源码
          </button>

          <!-- JSON / Protobuf / JS / 文本视图 Tab -->
          <button 
            v-if="!isImage && !isVideo && !isAudio && !isHtml"
            class="sub-tab-btn" 
            :class="{ active: activeSubTab === 'json' }" 
            @click="activeSubTab = 'json'"
          >
            {{ isProtobuf ? '📦 Protobuf (JSON)' : (isJs ? '📜 JavaScript' : (isJson ? 'JSON Text' : 'Text')) }}
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
          <button class="btn btn-default btn-xs" @click="downloadBody()" title="下载当前接口响应内容">
            💾 下载原响应
          </button>
          <button class="btn btn-default btn-xs" @click="copyBodyText()">
            复制文本
          </button>
        </div>
      </div>

      <!-- 内容展示区域 -->
      <div class="panel-content-area">
        <!-- 1. 图片预览视图 -->
        <div v-if="activeSubTab === 'image'" class="media-preview-container image-preview-layout">
          <div class="media-toolbar">
            <div class="media-meta-tags">
              <span class="media-tag tag-type" :class="{ 'tag-heic': isHeic }">
                {{ isHeic ? 'image/heic (HEIC 高清编码)' : (contentType || 'image') }}
              </span>
              <span v-if="isHeic" class="media-tag tag-heic-badge" title="已通过硬件加速解码为高清预览">
                ⚡ 硬件转码预览
              </span>
              <span v-if="imgNaturalWidth > 0" class="media-tag">尺寸: {{ imgNaturalWidth }} × {{ imgNaturalHeight }} px</span>
              <span v-if="contentLength" class="media-tag">大小: {{ formatBytes(contentLength) }}</span>
            </div>
            <div class="media-toolbar-actions">
              <button class="btn btn-xs btn-default" :class="{ active: imgFitMode === 'fit' }" @click="imgFitMode = 'fit'">适应窗口</button>
              <button class="btn btn-xs btn-default" :class="{ active: imgFitMode === 'original' }" @click="imgFitMode = 'original'">100% 原始大小</button>
              <button class="btn btn-xs btn-default" @click="openInNewTab">在新标签页打开 ↗</button>
              <button v-if="isHeic" class="btn btn-xs btn-default" @click="downloadBody('jpeg')" title="下载已转换的 JPEG 格式图片">下载 JPG ⬇</button>
              <button class="btn btn-xs btn-default" @click="downloadBody()" :title="isHeic ? '下载 HEIC 原始文件' : '下载原图'">{{ isHeic ? '下载 HEIC 原图 ⬇' : '下载图片 ⬇' }}</button>
            </div>
          </div>
          <div class="media-canvas checkerboard-bg" style="position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 220px; padding: 16px;">
            <!-- 304 协商缓存提示条 (若已补齐预览) -->
            <div v-if="is304 && !imgLoadError" style="margin-bottom: 12px; padding: 5px 12px; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 6px; font-size: 11px; color: #60a5fa; display: flex; align-items: center; gap: 6px;">
              <span>⚡</span>
              <span><b>HTTP 304 协商缓存</b>：服务器未下发报文，抓包工具已自动拉取/复用原图用于预览与下载</span>
            </div>

            <!-- 加载失败错误提示 (兜底) -->
            <div v-if="imgLoadError" style="text-align: center; padding: 24px; max-width: 440px; background: rgba(0,0,0,0.4); border-radius: 8px; border: 1px dashed var(--border-color); color: var(--text-color);">
              <div style="font-size: 26px; margin-bottom: 8px;">⚠️</div>
              <div style="font-weight: 600; margin-bottom: 6px; font-size: 14px;">{{ is304 ? 'HTTP 304 协商缓存 (未能回源补全)' : '图片无法正常加载' }}</div>
              <div style="font-size: 12px; color: var(--text-dim); line-height: 1.6; margin-bottom: 14px;">
                {{ is304 ? '服务器返回了 304 Not Modified 且源站拒绝了回源补全，客户端此时应复用本地磁盘缓存。' : '未获取到有效图片二进制数据。' }}
              </div>
              <button class="btn btn-primary btn-xs" @click="openInNewTab">
                🌐 在新窗口尝试直接打开原链接
              </button>
            </div>

            <!-- 正常图片渲染 (304 与 200 均可秒级渲染) -->
            <img 
              v-show="!imgLoadError" 
              :src="imageSrc" 
              :class="imgFitMode === 'fit' ? 'img-fit' : 'img-original'" 
              @load="onImageLoad" 
              @error="onImageError" 
              alt="Image Preview" 
            />
          </div>
        </div>

        <!-- 2. 视频播放视图 -->
        <div v-else-if="activeSubTab === 'video'" class="media-preview-container video-preview-layout">
          <div class="media-toolbar">
            <div class="media-meta-tags">
              <span class="media-tag tag-type">{{ contentType || 'video' }}</span>
              <span v-if="contentLength" class="media-tag">大小: {{ formatBytes(contentLength) }}</span>
            </div>
            <div class="media-toolbar-actions">
              <button class="btn btn-xs btn-default" @click="openInNewTab">在新标签页播放 ↗</button>
              <button class="btn btn-xs btn-default" @click="downloadBody()">下载视频 ⬇</button>
            </div>
          </div>
          <div class="media-canvas video-canvas-dark">
            <video controls autoplay="false" :src="mediaUrl" class="media-video-player"></video>
          </div>
        </div>

        <!-- 3. 音频播放视图 -->
        <div v-else-if="activeSubTab === 'audio'" class="media-preview-container audio-preview-layout">
          <div class="media-toolbar">
            <div class="media-meta-tags">
              <span class="media-tag tag-type">{{ contentType || 'audio' }}</span>
              <span v-if="contentLength" class="media-tag">大小: {{ formatBytes(contentLength) }}</span>
            </div>
            <div class="media-toolbar-actions">
              <button class="btn btn-xs btn-default" @click="downloadBody()">下载音频 ⬇</button>
            </div>
          </div>
          <div class="media-canvas audio-canvas-dark">
            <audio controls :src="mediaUrl" class="media-audio-player"></audio>
          </div>
        </div>

        <!-- 4. HTML 网页渲染预览视图 -->
        <div v-else-if="activeSubTab === 'html-preview'" class="media-preview-container html-preview-layout">
          <div class="media-toolbar">
            <div class="media-meta-tags">
              <span class="media-tag tag-type">HTML 沙箱渲染模式</span>
              <span v-if="contentLength" class="media-tag">大小: {{ formatBytes(contentLength) }}</span>
            </div>
            <div class="media-toolbar-actions">
              <button class="btn btn-xs btn-default" @click="openInNewTab">在新窗口打开完整页面 ↗</button>
              <button class="btn btn-xs btn-default" @click="downloadBody()">下载 HTML ⬇</button>
            </div>
          </div>
          <div class="html-iframe-wrapper">
            <!-- 安全加固：移除 allow-same-origin，阻止不可信响应 HTML 脚本沙箱逃逸提权访问父窗口 DOM/Storage -->
            <iframe :srcdoc="request.responseBody" class="html-preview-frame" sandbox="allow-scripts"></iframe>
          </div>
        </div>

        <!-- 5. 代码行号高亮视图 (JSON / Raw / HTML 源码) 默认全屏纯净展示解析后的数据 -->
        <div v-else-if="activeSubTab === 'json' || activeSubTab === 'raw' || activeSubTab === 'html-source'" class="code-editor-view">
          <div class="code-line-numbers">
            <span v-for="n in lines.length" :key="n">{{ n }}</span>
          </div>
          <div class="code-lines-content">
            <pre><code v-html="highlightedContent"></code></pre>
          </div>
        </div>

        <!-- 6. 响应头表格视图 -->
        <div v-else-if="activeSubTab === 'headers'" class="key-value-container">
          <table class="key-value-table">
            <tr v-for="(v, k) in request.responseHeaders" :key="k">
              <td class="key">{{ k }}</td>
              <td class="value">{{ v }}</td>
            </tr>
          </table>
        </div>

        <!-- 7. Set-Cookie 表格视图 -->
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
