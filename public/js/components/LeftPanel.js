import { computed } from '/vendor/vue.esm-browser.js';
import { store, domainTreeData, actions } from '../store.js';
import DomainTree from './DomainTree.js';
import SequenceList from './SequenceList.js';

export default {
  name: 'LeftPanel',
  components: {
    DomainTree,
    SequenceList
  },
  setup() {
    // 判断所有域名目录是否已全部折叠
    const isAllCollapsed = computed(() => {
      const list = domainTreeData.value;
      if (!list || list.length === 0) return false;
      return list.every(d => !d.expanded);
    });

    const onToggleAllDomains = () => {
      actions.toggleAllDomains();
    };

    return {
      store,
      domainTreeData,
      actions,
      isAllCollapsed,
      onToggleAllDomains
    };
  },
  template: `
    <div class="left-panel" :style="{ width: store.leftPanelWidth + 'px' }">
      <!-- 左侧栏顶部：按域名过滤输入框与快捷操作 -->
      <div class="left-panel-top-bar">
        <div class="domain-filter-wrapper">
          <span class="domain-filter-icon">🌐</span>
          <input 
            type="text" 
            v-model="store.domainFilter" 
            placeholder="按域名过滤 (如: google.com)..." 
          />
          <button 
            v-if="store.domainFilter" 
            class="filter-clear-btn" 
            @click="store.domainFilter = ''"
            title="清空域名过滤"
          >✕</button>
        </div>

        <div class="tree-quick-actions">
          <button 
            class="icon-btn probe-toggle-btn" 
            :class="{ active: store.hideDirectProbes }"
            @click="actions.toggleHideProbes" 
            :title="store.hideDirectProbes ? '🛡️ 当前已过滤隐藏无 Host 探测(503)噪音，点击查看全部' : '🛡️ 当前显示所有无 Host 探测，点击一键过滤隐藏'"
          >
            🛡️
          </button>
          <template v-if="store.viewMode === 'structure'">
            <button 
              class="icon-btn tree-toggle-btn"
              :class="{ collapsed: isAllCollapsed }"
              @click="onToggleAllDomains" 
              :title="isAllCollapsed ? '一键展开所有域名目录' : '一键折叠所有域名目录'"
            >
              <!-- 展开中状态 (点击可折叠)：手风琴/三折地图折叠图标 -->
              <svg 
                v-if="!isAllCollapsed" 
                class="tree-toggle-svg" 
                viewBox="0 0 1024 1024" 
                width="15" 
                height="15" 
                fill="currentColor"
              >
                <path d="M1017.1392 4.608C1021.7472 7.68 1024 12.288 1024 18.3296l0 804.5568c0 9.1136-3.7888 15.2576-11.4688 18.3296L683.4176 950.8864 676.5568 950.8864 669.696 950.8864 347.4432 841.1136 25.1904 950.8864 18.3296 950.8864c-1.536 0-3.4816-0.3072-5.7344-1.1264C10.24 948.9408 8.3968 948.5312 6.8608 948.5312 2.2528 944.0256 0 938.7008 0 932.5568L0 128c0-7.5776 3.7888-13.7216 11.4688-18.3296L340.5824 0l6.8608 0L354.304 0l322.2528 109.6704L998.8096 0C1008.0256 0 1014.0672 1.536 1017.1392 4.608zM36.5568 907.4688l292.5568-98.304L329.1136 43.4176l-292.5568 98.304L36.5568 907.4688zM365.6704 809.1648l292.5568 98.304L658.2272 141.7216l-292.5568-98.304L365.6704 809.1648zM987.4432 43.4176l-292.5568 98.304 0 765.7472 292.5568-98.304L987.4432 43.4176z" />
              </svg>
              <!-- 折叠中状态 (点击可展开)：平铺完全展开图标 -->
              <svg 
                v-else 
                class="tree-toggle-svg" 
                viewBox="0 0 1024 1024" 
                width="15" 
                height="15" 
                fill="currentColor"
              >
                <path fill-rule="evenodd" d="M16 50h992c8.8 0 16 7.2 16 16v818c0 8.8-7.2 16-16 16H16c-8.8 0-16-7.2-16-16V66c0-8.8 7.2-16 16-16zM36.5568 864h292.5568V86H36.5568v778zM365.6704 864h292.5568V86H365.6704v778zM694.8864 864h292.5568V86H694.8864v778z" />
              </svg>
            </button>
          </template>
        </div>
      </div>

      <!-- 视图内容区域：根据 store.viewMode 切换树状或列表 -->
      <div class="left-panel-content">
        <domain-tree v-if="store.viewMode === 'structure'"></domain-tree>
        <sequence-list v-else></sequence-list>
      </div>

      <!-- 类似 Charles 底部的快速实时过滤栏 (Filter) -->
      <div class="left-panel-filter-bar">
        <span class="filter-label">Filter:</span>
        <div class="filter-input-wrapper">
          <input 
            type="text" 
            v-model="store.searchQuery" 
            placeholder="过滤路径、方法、状态码..." 
          />
          <button 
            v-if="store.searchQuery" 
            class="filter-clear-btn" 
            @click="store.searchQuery = ''"
            title="清空过滤"
          >✕</button>
        </div>
        <div class="filter-counter" v-if="store.viewMode === 'structure'">
          {{ domainTreeData.length }} 域名
        </div>
      </div>
    </div>
  `
};
