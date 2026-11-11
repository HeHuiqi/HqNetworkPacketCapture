import { ref, computed, watch, nextTick } from '/vendor/vue.esm-browser.js';
import { escapeHtml, highlightJson } from '../utils/formatters.js';
import JsonTreeNode from './JsonTreeNode.js';

// 计算代码折叠区间 (扫描多行括号对)
function computeFoldRanges(lines) {
  const stack = [];
  const foldRanges = {};
  lines.forEach((lineText, idx) => {
    for (let i = 0; i < lineText.length; i++) {
      const char = lineText[i];
      if (char === '"') {
        i++;
        while (i < lineText.length && lineText[i] !== '"') {
          if (lineText[i] === '\\') i++;
          i++;
        }
      } else if (char === '{' || char === '[') {
        stack.push({ char, lineIndex: idx });
      } else if (char === '}' || char === ']') {
        const matchChar = char === '}' ? '{' : '[';
        if (stack.length > 0 && stack[stack.length - 1].char === matchChar) {
          const open = stack.pop();
          if (open.lineIndex !== idx) {
            foldRanges[open.lineIndex] = {
              endLine: idx,
              type: open.char === '{' ? 'object' : 'array'
            };
          }
        }
      }
    }
  });
  return foldRanges;
}

// 提取折叠行的前缀内容与徽章文本
function getFoldPrefixAndBadge(lineText, endLineText, type) {
  const bracket = type === 'object' ? '{' : '[';
  const bracketPos = lineText.lastIndexOf(bracket);
  const prefix = bracketPos >= 0 ? lineText.slice(0, bracketPos) : lineText;
  const hasComma = (endLineText || '').trim().endsWith(',');
  const closeBracket = type === 'object' ? '}' : ']';
  return {
    prefix,
    badgeLabel: `${bracket} ... ${closeBracket}${hasComma ? ',' : ''}`
  };
}

export default {
  name: 'JsonTreeEditor',
  components: {
    JsonTreeNode
  },
  props: {
    modelValue: {
      type: String,
      default: ''
    },
    readonly: {
      type: Boolean,
      default: false
    },
    height: {
      type: String,
      default: '380px'
    },
    defaultMode: {
      type: String,
      default: 'split' // 'split' | 'code' | 'tree'
    }
  },
  emits: ['update:modelValue', 'change'],
  setup(props, { emit }) {
    // 视图模式: split (左右双栏), code (仅代码), tree (仅树形)
    const viewMode = ref(props.defaultMode || 'split');
    const rawText = ref(props.modelValue || '');
    const parsedData = ref(null);
    const parseError = ref(null);
    const expandSignal = ref(null);

    // 左侧代码栏子模式: 'fold' (代码折叠) | 'raw' (源码编辑)
    const codeViewSubMode = ref('fold');

    // 存储左侧当前处于折叠状态的代码行号索引 (0-based)
    const collapsedLineIndices = ref(new Set());

    // 双向同步锁
    const isUpdatingFromTree = ref(false);
    const isUpdatingFromText = ref(false);

    // DOM 元素引用
    const textareaRef = ref(null);
    const highlightRef = ref(null);
    const lineNumbersRef = ref(null);

    // 复制提示
    const copiedTooltip = ref(false);

    // 尝试解析 JSON
    const tryParse = (val) => {
      const trimmed = (val || '').trim();
      if (!trimmed) {
        parsedData.value = {};
        parseError.value = null;
        return true;
      }
      try {
        const obj = JSON.parse(trimmed);
        parsedData.value = obj;
        parseError.value = null;
        return true;
      } catch (err) {
        parseError.value = err.message;
        return false;
      }
    };

    // 外部 modelValue 变更监听
    watch(() => props.modelValue, (newVal) => {
      if (isUpdatingFromTree.value) return;
      rawText.value = newVal || '';
      tryParse(newVal || '');
    }, { immediate: true });

    // 拆分所有文本行
    const rawLines = computed(() => {
      const text = rawText.value || '';
      return text ? text.split('\n') : [''];
    });

    // 计算总行数
    const lineCount = computed(() => {
      return rawLines.value.length;
    });

    // 计算高亮 HTML (用于源码编辑模式)
    const highlightedHtml = computed(() => {
      return highlightJson(rawText.value);
    });

    // 计算所有可折叠的多行括号区间
    const foldRanges = computed(() => {
      return computeFoldRanges(rawLines.value);
    });

    // 计算左侧代码折叠视图中的可见行列表
    const visibleLines = computed(() => {
      const lines = rawLines.value;
      const ranges = foldRanges.value;
      const collapsed = collapsedLineIndices.value;
      const result = [];

      for (let i = 0; i < lines.length; i++) {
        // 判断当前行是否被外层某个已折叠的代码块隐藏
        let isHidden = false;
        for (const startIdx of collapsed) {
          const range = ranges[startIdx];
          if (range && i > startIdx && i <= range.endLine) {
            isHidden = true;
            break;
          }
        }

        if (!isHidden) {
          const isFolded = collapsed.has(i);
          const canFold = !!ranges[i];
          let prefixHtml = '';
          let badgeInfo = null;

          if (isFolded && ranges[i]) {
            const endText = lines[ranges[i].endLine] || '';
            const foldData = getFoldPrefixAndBadge(lines[i], endText, ranges[i].type);
            prefixHtml = highlightJson(foldData.prefix);
            badgeInfo = {
              label: foldData.badgeLabel,
              count: `${ranges[i].endLine - i} 行已折叠`
            };
          } else {
            prefixHtml = highlightJson(lines[i]);
          }

          result.push({
            lineIdx: i,
            canFold,
            isFolded,
            prefixHtml,
            badgeInfo
          });
        }
      }

      return result;
    });

    // 切换某一行代码的折叠/展开
    const toggleLineFold = (lineIdx) => {
      const newSet = new Set(collapsedLineIndices.value);
      if (newSet.has(lineIdx)) {
        newSet.delete(lineIdx);
      } else {
        newSet.add(lineIdx);
      }
      collapsedLineIndices.value = newSet;
    };

    // 计算有效性概要信息
    const jsonMetaInfo = computed(() => {
      if (parseError.value) {
        return { valid: false, text: `⚠️ 语法错误: ${parseError.value}` };
      }
      if (parsedData.value === null || parsedData.value === undefined) {
        return { valid: true, text: '无数据' };
      }
      if (Array.isArray(parsedData.value)) {
        return { valid: true, text: `✅ JSON 数组 (${parsedData.value.length} 项)` };
      }
      if (typeof parsedData.value === 'object') {
        const keysLen = Object.keys(parsedData.value).length;
        return { valid: true, text: `✅ JSON 对象 (${keysLen} 个顶层属性)` };
      }
      return { valid: true, text: `✅ JSON ${typeof parsedData.value}` };
    });

    // 左侧输入防抖定时器
    let debounceTimer = null;

    // 左侧输入处理 (左 -> 右)
    const onTextInput = (e) => {
      const val = e.target.value;
      rawText.value = val;
      emit('update:modelValue', val);
      emit('change', val);

      if (isUpdatingFromTree.value) return;
      isUpdatingFromText.value = true;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        tryParse(val);
        isUpdatingFromText.value = false;
      }, 150);
    };

    // 滚动同步 (左侧滚动驱动高亮层和行号)
    const syncScroll = () => {
      if (!textareaRef.value) return;
      const top = textareaRef.value.scrollTop;
      const left = textareaRef.value.scrollLeft;
      if (highlightRef.value) {
        highlightRef.value.scrollTop = top;
        highlightRef.value.scrollLeft = left;
      }
      if (lineNumbersRef.value) {
        lineNumbersRef.value.scrollTop = top;
      }
    };

    // Tab 键智能缩进 2 空格
    const handleKeydown = (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const textarea = textareaRef.value;
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = rawText.value;
        const insert = '  ';
        rawText.value = val.substring(0, start) + insert + val.substring(end);
        emit('update:modelValue', rawText.value);
        emit('change', rawText.value);

        nextTick(() => {
          textarea.selectionStart = textarea.selectionEnd = start + insert.length;
          syncScroll();
        });

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          tryParse(rawText.value);
        }, 150);
      }
    };

    // 右侧树形修改触发反向同步 (右 -> 左)
    const onTreeChanged = () => {
      if (isUpdatingFromText.value) return;
      isUpdatingFromTree.value = true;
      try {
        const formatted = JSON.stringify(parsedData.value, null, 2) || '';
        rawText.value = formatted;
        emit('update:modelValue', formatted);
        emit('change', formatted);
        parseError.value = null;
      } catch (err) {
        console.error('[JsonTreeEditor] Failed to stringify tree:', err);
      } finally {
        nextTick(() => {
          isUpdatingFromTree.value = false;
          syncScroll();
        });
      }
    };

    // 格式化美化
    const formatJsonContent = () => {
      try {
        const obj = JSON.parse(rawText.value || '{}');
        const formatted = JSON.stringify(obj, null, 2);
        rawText.value = formatted;
        parsedData.value = obj;
        parseError.value = null;
        emit('update:modelValue', formatted);
        emit('change', formatted);
        nextTick(syncScroll);
      } catch (err) {
        parseError.value = err.message;
      }
    };

    // 压缩为单行
    const minifyJsonContent = () => {
      try {
        const obj = JSON.parse(rawText.value || '{}');
        const minified = JSON.stringify(obj);
        rawText.value = minified;
        parsedData.value = obj;
        parseError.value = null;
        emit('update:modelValue', minified);
        emit('change', minified);
        nextTick(syncScroll);
      } catch (err) {
        parseError.value = err.message;
      }
    };

    // 清空内容
    const clearContent = () => {
      const emptyStr = '{}';
      rawText.value = emptyStr;
      parsedData.value = {};
      parseError.value = null;
      emit('update:modelValue', emptyStr);
      emit('change', emptyStr);
      nextTick(syncScroll);
    };

    // 复制内容 (支持局域网 HTTP 安全降级)
    const copyContent = async () => {
      const str = rawText.value || '';
      let success = false;
      if (navigator?.clipboard?.writeText && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(str);
          success = true;
        } catch (_) {}
      }
      if (!success) {
        try {
          const textarea = document.createElement('textarea');
          textarea.value = str;
          textarea.style.position = 'fixed';
          textarea.style.top = '-9999px';
          textarea.style.left = '-9999px';
          textarea.style.opacity = '0';
          textarea.setAttribute('readonly', '');
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          success = document.execCommand('copy');
          document.body.removeChild(textarea);
        } catch (_) {}
      }

      if (success) {
        copiedTooltip.value = true;
        setTimeout(() => {
          copiedTooltip.value = false;
        }, 1500);
      }
    };

    // 展开全部 (左侧代码折叠与右侧树形同时展开)
    const expandAll = () => {
      collapsedLineIndices.value = new Set();
      expandSignal.value = true;
      nextTick(() => {
        expandSignal.value = null;
      });
    };

    // 折叠全部 (左侧代码折叠与右侧树形同时折叠)
    const collapseAll = () => {
      const newSet = new Set();
      for (const k of Object.keys(foldRanges.value)) {
        newSet.add(Number(k));
      }
      collapsedLineIndices.value = newSet;
      expandSignal.value = false;
      nextTick(() => {
        expandSignal.value = null;
      });
    };

    // 切换左侧代码栏折叠/展开
    const toggleLeftCodePane = () => {
      if (viewMode.value === 'split' || viewMode.value === 'code') {
        viewMode.value = 'tree';
      } else {
        viewMode.value = 'split';
      }
    };

    // 应用快捷模板
    const applyTemplate = (type) => {
      let tpl = {};
      if (type === 'standard') {
        tpl = {
          code: 200,
          message: 'success',
          data: {
            id: 1001,
            username: 'tester',
            status: 'active',
            tags: ['dev', 'mock']
          }
        };
      } else if (type === 'emptyObject') {
        tpl = {};
      } else if (type === 'emptyArray') {
        tpl = [];
      }

      const formatted = JSON.stringify(tpl, null, 2);
      rawText.value = formatted;
      parsedData.value = tpl;
      parseError.value = null;
      emit('update:modelValue', formatted);
      emit('change', formatted);
      nextTick(syncScroll);
    };

    return {
      viewMode,
      rawText,
      parsedData,
      parseError,
      expandSignal,
      codeViewSubMode,
      visibleLines,
      toggleLineFold,
      textareaRef,
      highlightRef,
      lineNumbersRef,
      lineCount,
      highlightedHtml,
      jsonMetaInfo,
      copiedTooltip,
      onTextInput,
      syncScroll,
      handleKeydown,
      onTreeChanged,
      formatJsonContent,
      minifyJsonContent,
      clearContent,
      copyContent,
      expandAll,
      collapseAll,
      toggleLeftCodePane,
      applyTemplate
    };
  },
  template: `
    <div 
      class="json-tree-editor-wrapper" 
      :class="{ 'is-full-height': height === '100%' }" 
      :style="{ height: height, minHeight: height === '100%' ? '0' : height }"
    >
      <!-- 顶部操作工具栏 -->
      <div class="jte-toolbar">
        <!-- 左侧：视图模式切换 -->
        <div class="jte-mode-group">
          <button 
            type="button" 
            class="jte-mode-btn" 
            :class="{ active: viewMode === 'split' }" 
            @click="viewMode = 'split'"
            title="左右双栏 (左侧代码，右侧树形)"
          >
            🔀 双栏并排
          </button>
          <button 
            type="button" 
            class="jte-mode-btn" 
            :class="{ active: viewMode === 'code' }" 
            @click="viewMode = 'code'"
            title="纯 JSON 代码编辑视图"
          >
            📝 仅代码
          </button>
          <button 
            type="button" 
            class="jte-mode-btn" 
            :class="{ active: viewMode === 'tree' }" 
            @click="viewMode = 'tree'"
            title="纯可视化树形编辑视图"
          >
            🌳 仅树形
          </button>
        </div>

        <!-- 中间：操作动作按钮 -->
        <div class="jte-actions-group">
          <button type="button" class="jte-tool-btn" @click="formatJsonContent" title="美化排版 (2 空格缩进)">
            ✨ 格式化
          </button>
          <button type="button" class="jte-tool-btn" @click="minifyJsonContent" title="压缩为单行紧凑 JSON">
            🗜️ 压缩
          </button>
          <button type="button" class="jte-tool-btn" @click="copyContent" title="复制完整 JSON 到剪贴板">
            {{ copiedTooltip ? '✅ 已复制' : '📋 复制' }}
          </button>
          <button type="button" class="jte-tool-btn" @click="clearContent" title="清空内容">
            🗑️ 清空
          </button>

          <!-- 树形与代码折叠控制 (左右同时受控) -->
          <span class="jte-divider"></span>
          <button type="button" class="jte-tool-btn" @click="expandAll" title="展开左侧代码和右侧树形的所有节点">
            🌿 展开全部
          </button>
          <button type="button" class="jte-tool-btn" @click="collapseAll" title="折叠左侧代码和右侧树形的所有节点">
            🌱 收起全部
          </button>
        </div>

        <!-- 右侧：语法校验与状态指示器 -->
        <div class="jte-status-box" :class="{ 'status-error': !jsonMetaInfo.valid }">
          <span class="status-indicator-dot"></span>
          <span class="status-indicator-text" :title="jsonMetaInfo.text">{{ jsonMetaInfo.text }}</span>
        </div>
      </div>

      <!-- 主编辑工作区 -->
      <div class="jte-workspace" :class="'mode-' + viewMode">
        <!-- 1. 左侧代码编辑器 (支持 VS Code 风格代码折叠与自由源码编辑) -->
        <div 
          v-show="viewMode === 'split' || viewMode === 'code'" 
          class="jte-pane jte-code-pane"
        >
          <div class="jte-pane-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="jte-pane-title">📝 JSON 源码 (Code View)</span>
              
              <!-- 折叠视图 vs 自由源码编辑 子模式切换 -->
              <div class="jte-submode-tabs">
                <button 
                  type="button" 
                  class="jte-submode-btn" 
                  :class="{ active: codeViewSubMode === 'fold' }"
                  @click="codeViewSubMode = 'fold'"
                  title="代码折叠视图 (点击 ▶/▼ 展开折叠大对象)"
                >
                  🌲 代码折叠
                </button>
                <button 
                  type="button" 
                  class="jte-submode-btn" 
                  :class="{ active: codeViewSubMode === 'raw' }"
                  @click="codeViewSubMode = 'raw'"
                  title="自由源码编辑 (支持随意打字、全选粘贴与编辑)"
                >
                  ✍️ 源码编辑
                </button>
              </div>
            </div>

            <button 
              type="button" 
              class="jte-tool-btn btn-xs" 
              @click="toggleLeftCodePane" 
              title="收起左侧代码栏，独占显示树形"
            >
              ◀ 收起代码
            </button>
          </div>

          <div class="jte-code-canvas">
            <!-- 模式 A: 结构化代码折叠视图 (带折叠箭头 ▶/▼ 与折叠胶囊) -->
            <div 
              v-if="codeViewSubMode === 'fold'" 
              class="jte-fold-code-view"
            >
              <div 
                v-for="line in visibleLines" 
                :key="line.lineIdx"
                class="jte-fold-line"
                :class="{ 'is-folded-parent': line.isFolded }"
              >
                <!-- 行号与折叠箭头 -->
                <div class="jte-fold-gutter">
                  <span class="jte-fold-linenum">{{ line.lineIdx + 1 }}</span>
                  <span 
                    v-if="line.canFold"
                    class="jte-fold-btn"
                    :class="{ 'is-collapsed': line.isFolded }"
                    @click.stop="toggleLineFold(line.lineIdx)"
                    :title="line.isFolded ? '点击展开此代码块' : '点击折叠此代码块'"
                  >
                    {{ line.isFolded ? '▶' : '▼' }}
                  </span>
                  <span v-else class="jte-fold-btn-placeholder"></span>
                </div>

                <!-- 代码行内容与折叠徽章 (双击可快速切换到源码编辑) -->
                <div 
                  class="jte-fold-content" 
                  @dblclick="codeViewSubMode = 'raw'" 
                  title="双击进入自由源码编辑模式"
                >
                  <span class="jte-fold-prefix" v-html="line.prefixHtml"></span>
                  <span 
                    v-if="line.isFolded" 
                    class="jte-fold-pill" 
                    @click.stop="toggleLineFold(line.lineIdx)"
                    :title="line.badgeInfo.count + '，点击展开'"
                  >
                    {{ line.badgeInfo.label }}
                  </span>
                </div>
              </div>
            </div>

            <!-- 模式 B: 自由源码编辑模式 (底层高亮 + 顶层可编辑 textarea) -->
            <template v-else>
              <!-- 行号列 -->
              <div class="jte-line-numbers" ref="lineNumbersRef" aria-hidden="true">
                <div v-for="n in lineCount" :key="n" class="jte-line-no">{{ n }}</div>
              </div>

              <!-- 编辑与高亮舞台 -->
              <div class="jte-stage">
                <!-- 底层实时高亮渲染层 -->
                <pre 
                  class="jte-highlight-layer" 
                  ref="highlightRef" 
                  v-html="highlightedHtml" 
                  aria-hidden="true"
                ></pre>

                <!-- 顶层真实交互输入文本域 -->
                <textarea
                  ref="textareaRef"
                  class="jte-code-textarea"
                  :value="rawText"
                  :readonly="readonly"
                  placeholder="请输入或粘贴接口返回的 JSON 内容..."
                  @input="onTextInput"
                  @scroll="syncScroll"
                  @keydown="handleKeydown"
                  spellcheck="false"
                  autocomplete="off"
                  autocorrect="off"
                  autocapitalize="off"
                ></textarea>
              </div>
            </template>
          </div>
        </div>

        <!-- 2. 中间分隔线 (仅双栏显示) -->
        <div 
          v-if="viewMode === 'split'" 
          class="jte-split-divider" 
          @click="toggleLeftCodePane" 
          title="点击快速收起左侧代码栏，全屏展示树形"
        >
          <div class="divider-line"></div>
          <div class="divider-icon" title="点击快速收起/展开左侧代码栏">⇄</div>
        </div>

        <!-- 3. 右侧树形可视化编辑器 -->
        <div 
          v-show="viewMode === 'split' || viewMode === 'tree'" 
          class="jte-pane jte-tree-pane"
        >
          <div class="jte-pane-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <button 
                v-if="viewMode === 'tree'" 
                type="button" 
                class="jte-tool-btn btn-xs" 
                @click="toggleLeftCodePane" 
                title="展开左侧代码栏，恢复双栏并排"
              >
                ▶ 展开代码
              </button>
              <span class="jte-pane-title">🌳 可视化树形编辑器 (Tree View)</span>
              <span class="jte-pane-hint">点击键/值就地修改，下拉换类型，悬浮加删字段</span>
            </div>
          </div>

          <div class="jte-tree-canvas">
            <!-- 语法错误提示条 (当输入未完成时不闪烁崩溃树) -->
            <div v-if="parseError" class="jte-parse-error-banner">
              <span class="error-icon">⚠️</span>
              <span class="error-desc">JSON 语法尚未闭合: {{ parseError }} (树形保持当前可用状态)</span>
            </div>

            <!-- 数据存在且有效时渲染树形节点 -->
            <div v-if="parsedData !== null && parsedData !== undefined" class="jte-tree-root">
              <json-tree-node
                node-key="root"
                :value="parsedData"
                :depth="0"
                :is-read-only="readonly"
                :expand-signal="expandSignal"
                @change="onTreeChanged"
              ></json-tree-node>
            </div>

            <!-- 空数据状态：提供快速模板入口 -->
            <div v-else class="jte-empty-tree">
              <div class="jte-empty-icon">🌳</div>
              <div class="jte-empty-title">当前无有效 JSON 数据</div>
              <div class="jte-empty-sub">可在左侧直接粘贴，或选择预设模板快速填充：</div>
              <div class="jte-template-btns">
                <button type="button" class="btn btn-xs btn-purple" @click="applyTemplate('standard')">
                  ⚡ 标准 API 响应 (code/msg/data)
                </button>
                <button type="button" class="btn btn-xs btn-default" @click="applyTemplate('emptyObject')">
                  { } 空对象
                </button>
                <button type="button" class="btn btn-xs btn-default" @click="applyTemplate('emptyArray')">
                  [ ] 空数组
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
};
