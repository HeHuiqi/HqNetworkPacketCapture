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
    return {
      store,
      domainTreeData,
      actions
    };
  },
  template: `
    <div class="left-panel">
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

        <div class="tree-quick-actions" v-if="store.viewMode === 'structure'">
          <button 
            class="icon-btn" 
            @click="actions.expandAllDomains" 
            title="展开所有域名目录"
          >
            ➕
          </button>
          <button 
            class="icon-btn" 
            @click="actions.collapseAllDomains" 
            title="折叠所有域名目录"
          >
            ➖
          </button>
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
