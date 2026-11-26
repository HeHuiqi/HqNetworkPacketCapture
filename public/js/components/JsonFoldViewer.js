import { ref, computed, watch, nextTick } from '/vendor/vue.esm-browser.js';
import { computeFoldRanges, computeVisibleFoldLines, computeLineJsonPaths } from '../utils/jsonFold.js';
import { actions } from '../store.js';

export default {
  name: 'JsonFoldViewer',
  props: {
    text: {
      type: String,
      default: ''
    }
  },
  setup(props) {
    const collapsedLineIndices = ref(new Set());
    const searchQuery = ref('');
    const currentMatchIndex = ref(0);
    const scrollContainerRef = ref(null);

    watch(() => props.text, () => {
      collapsedLineIndices.value = new Set();
      searchQuery.value = '';
      currentMatchIndex.value = 0;
    });

    const lines = computed(() => {
      const val = props.text || '';
      return val ? val.split('\n') : [''];
    });

    const foldRanges = computed(() => computeFoldRanges(lines.value));
    const lineJsonPaths = computed(() => computeLineJsonPaths(lines.value));

    const hasFoldableBlocks = computed(() => Object.keys(foldRanges.value).length > 0);
    const hasCollapsed = computed(() => collapsedLineIndices.value.size > 0);

    // 搜索匹配行索引列表 (在所有原始行中检索)
    const matchingLineIndices = computed(() => {
      const q = (searchQuery.value || '').trim().toLowerCase();
      if (!q) return [];
      const res = [];
      const allLines = lines.value;
      for (let i = 0; i < allLines.length; i++) {
        if (allLines[i].toLowerCase().includes(q)) {
          res.push(i);
        }
      }
      return res;
    });

    const matchCount = computed(() => matchingLineIndices.value.length);

    // 当搜索关键词变化时，自动展开包含匹配结果的折叠块
    watch(matchingLineIndices, (matches) => {
      currentMatchIndex.value = 0;
      if (matches.length > 0 && collapsedLineIndices.value.size > 0) {
        const ranges = foldRanges.value;
        const nextCollapsed = new Set(collapsedLineIndices.value);
        let changed = false;

        // 如果某个匹配行被包含在折叠块中，展开该折叠块
        for (const matchLineIdx of matches) {
          for (const startIdx of nextCollapsed) {
            const range = ranges[startIdx];
            if (range && matchLineIdx >= startIdx && matchLineIdx <= range.endLine) {
              nextCollapsed.delete(startIdx);
              changed = true;
            }
          }
        }
        if (changed) {
          collapsedLineIndices.value = nextCollapsed;
        }
      }
      scrollToCurrentMatch();
    });

    const scrollToCurrentMatch = () => {
      nextTick(() => {
        if (!scrollContainerRef.value || matchingLineIndices.value.length === 0) return;
        const targetLineIdx = matchingLineIndices.value[currentMatchIndex.value];
        const el = scrollContainerRef.value.querySelector(`[data-line-idx="${targetLineIdx}"]`);
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
    };

    const nextMatch = () => {
      if (matchCount.value === 0) return;
      currentMatchIndex.value = (currentMatchIndex.value + 1) % matchCount.value;
      scrollToCurrentMatch();
    };

    const prevMatch = () => {
      if (matchCount.value === 0) return;
      currentMatchIndex.value = (currentMatchIndex.value - 1 + matchCount.value) % matchCount.value;
      scrollToCurrentMatch();
    };

    const visibleLines = computed(() =>
      computeVisibleFoldLines(
        lines.value,
        foldRanges.value,
        collapsedLineIndices.value,
        lineJsonPaths.value
      )
    );

    const toggleLineFold = (lineIdx) => {
      const next = new Set(collapsedLineIndices.value);
      if (next.has(lineIdx)) {
        next.delete(lineIdx);
      } else {
        next.add(lineIdx);
      }
      collapsedLineIndices.value = next;
    };

    const expandAll = () => {
      collapsedLineIndices.value = new Set();
    };

    const collapseAll = () => {
      const next = new Set();
      for (const k of Object.keys(foldRanges.value)) {
        next.add(Number(k));
      }
      collapsedLineIndices.value = next;
    };

    const copyPath = (path) => {
      if (!path) return;
      actions.copy(path, `已复制 JSONPath: ${path}`);
    };

    const isLineMatch = (lineIdx) => {
      return matchingLineIndices.value.includes(lineIdx);
    };

    const isCurrentMatchLine = (lineIdx) => {
      return matchingLineIndices.value[currentMatchIndex.value] === lineIdx;
    };

    return {
      scrollContainerRef,
      visibleLines,
      hasFoldableBlocks,
      hasCollapsed,
      searchQuery,
      matchCount,
      currentMatchIndex,
      toggleLineFold,
      expandAll,
      collapseAll,
      copyPath,
      nextMatch,
      prevMatch,
      isLineMatch,
      isCurrentMatchLine
    };
  },
  template: `
    <div class="json-fold-viewer">
      <div class="jfv-toolbar">
        <!-- 左侧折叠控制 -->
        <div v-if="hasFoldableBlocks" class="jfv-toolbar-left">
          <button
            type="button"
            class="jfv-btn"
            :disabled="!hasCollapsed"
            @click="expandAll"
            title="展开全部 JSON 节点"
          >
            <span class="jfv-btn-icon">🌿</span>
            <span>展开全部</span>
          </button>
          <button
            type="button"
            class="jfv-btn"
            @click="collapseAll"
            title="折叠全部 JSON 节点"
          >
            <span class="jfv-btn-icon">🌱</span>
            <span>折叠全部</span>
          </button>
        </div>

        <!-- 右侧行内搜索过滤条 -->
        <div class="jfv-search-box">
          <span class="jfv-search-icon">🔍</span>
          <input
            type="text"
            v-model="searchQuery"
            class="jfv-search-input"
            placeholder="搜索键名/数值..."
            @keydown.enter.prevent="nextMatch"
          />
          <span v-if="searchQuery" class="jfv-match-badge" :class="{ 'has-match': matchCount > 0 }">
            {{ matchCount > 0 ? (currentMatchIndex + 1) + '/' + matchCount : '0' }}
          </span>
          <button
            v-if="searchQuery && matchCount > 0"
            type="button"
            class="jfv-search-nav-btn"
            @click="prevMatch"
            title="上一个匹配 (Shift+Enter)"
          >▲</button>
          <button
            v-if="searchQuery && matchCount > 0"
            type="button"
            class="jfv-search-nav-btn"
            @click="nextMatch"
            title="下一个匹配 (Enter)"
          >▼</button>
          <button
            v-if="searchQuery"
            type="button"
            class="jfv-search-clear"
            @click="searchQuery = ''"
            title="清空搜索"
          >✕</button>
        </div>
      </div>

      <div class="jte-fold-code-view jfv-scroll-area" ref="scrollContainerRef">
        <div
          v-for="line in visibleLines"
          :key="line.lineIdx"
          class="jte-fold-line jfv-line"
          :data-line-idx="line.lineIdx"
          :class="{
            'is-folded-parent': line.isFolded,
            'is-search-match': isLineMatch(line.lineIdx),
            'is-current-match': isCurrentMatchLine(line.lineIdx)
          }"
        >
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
          <div class="jte-fold-content jfv-line-content">
            <span class="jte-fold-prefix" v-html="line.prefixHtml"></span>
            <span
              v-if="line.isFolded"
              class="jte-fold-pill"
              @click.stop="toggleLineFold(line.lineIdx)"
              :title="line.badgeInfo.count + '，点击展开'"
            >
              {{ line.badgeInfo.label }}
            </span>

            <!-- JSONPath 复制悬浮徽章 -->
            <button
              v-if="line.jsonPath"
              type="button"
              class="jfv-copy-path-btn"
              @click.stop="copyPath(line.jsonPath)"
              :title="'点击复制 JSONPath: ' + line.jsonPath"
            >
              <span class="jfv-path-icon">📋</span>
              <span class="jfv-path-text">{{ line.jsonPath }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `
};
