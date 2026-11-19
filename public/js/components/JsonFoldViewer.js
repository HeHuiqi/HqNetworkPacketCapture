import { ref, computed, watch } from '/vendor/vue.esm-browser.js';
import { computeFoldRanges, computeVisibleFoldLines } from '../utils/jsonFold.js';

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

    watch(() => props.text, () => {
      collapsedLineIndices.value = new Set();
    });

    const lines = computed(() => {
      const val = props.text || '';
      return val ? val.split('\n') : [''];
    });

    const foldRanges = computed(() => computeFoldRanges(lines.value));

    const hasFoldableBlocks = computed(() => Object.keys(foldRanges.value).length > 0);
    const hasCollapsed = computed(() => collapsedLineIndices.value.size > 0);

    const visibleLines = computed(() =>
      computeVisibleFoldLines(lines.value, foldRanges.value, collapsedLineIndices.value)
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

    return {
      visibleLines,
      hasFoldableBlocks,
      hasCollapsed,
      toggleLineFold,
      expandAll,
      collapseAll
    };
  },
  template: `
    <div class="json-fold-viewer">
      <div v-if="hasFoldableBlocks" class="jfv-toolbar">
        <button
          type="button"
          class="jfv-btn"
          :disabled="!hasCollapsed"
          @click="expandAll"
          title="展开全部 JSON 节点"
        >
          🌿 展开全部
        </button>
        <button
          type="button"
          class="jfv-btn"
          @click="collapseAll"
          title="折叠全部 JSON 节点"
        >
          🌱 折叠全部
        </button>
      </div>
      <div class="jte-fold-code-view jfv-scroll-area">
        <div
          v-for="line in visibleLines"
          :key="line.lineIdx"
          class="jte-fold-line"
          :class="{ 'is-folded-parent': line.isFolded }"
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
          </div>
        </div>
      </div>
    </div>
  `
};
