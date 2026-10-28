import { store, domainTreeData, actions } from '../store.js';

export default {
  name: 'DomainTree',
  setup() {
    return { store, domainTreeData, actions };
  },
  template: `
    <div class="domain-tree-container">
      <div v-if="domainTreeData.length === 0" class="tree-empty-state">
        <div style="font-size: 28px; margin-bottom: 8px;">📡</div>
        <div>暂无匹配的网络请求</div>
        <div style="font-size: 11px; color: var(--text-dim); margin-top: 4px;">
          设置代理 <strong>{{ store.lanIps[0]?.ip || '127.0.0.1' }}:{{ store.proxyPort }}</strong> 发起请求
        </div>
      </div>

      <div 
        v-for="domainNode in domainTreeData" 
        :key="domainNode.id"
        class="domain-group"
      >
        <!-- 域名目录头部 -->
        <div 
          class="domain-header" 
          @click="actions.toggleDomain(domainNode.domain)"
          @contextmenu="actions.openContextMenu($event, domainNode.children[0]?.tx)"
        >
          <span class="tree-arrow" :class="{ expanded: domainNode.expanded }">▶</span>
          <span class="domain-icon">🌐</span>
          <span class="domain-name" :title="domainNode.domain">{{ domainNode.domain }}</span>
          <span v-if="domainNode.hasMocked" class="badge-mock-sm">MOCK</span>
          <span class="domain-count">({{ domainNode.children.length }})</span>
        </div>

        <!-- 域名下的请求子节点列表 -->
        <div v-show="domainNode.expanded" class="domain-children">
          <div 
            v-for="child in domainNode.children" 
            :key="child.id"
            class="tree-request-item"
            :class="{ active: store.selectedId === child.id, mocked: child.isMocked }"
            @click="actions.selectRequest(child.id)"
            @contextmenu="actions.openContextMenu($event, child.tx)"
          >
            <span class="badge-method-mini" :class="(child.method || '').toLowerCase()">
              {{ child.method }}
            </span>

            <span class="tree-request-path" :title="child.displayName">
              {{ child.displayName }}
            </span>

            <span v-if="child.isMocked" class="badge-mock-mini">⚡ MOCK</span>
            <span v-else-if="child.statusCode" class="tree-status-code" :class="'status-' + String(child.statusCode)[0] + 'xx'">
              {{ child.statusCode }}
            </span>
            <span v-else class="tree-status-code status-pending">...</span>
          </div>
        </div>
      </div>
    </div>
  `
};
