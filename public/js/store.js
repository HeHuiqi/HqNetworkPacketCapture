import { reactive, ref, computed } from '/vendor/vue.esm-browser.js';
import { buildDomainTree } from './utils/treeHelper.js';
import { formatJson } from './utils/formatters.js';

export const store = reactive({
  // 核心数据
  requests: [],
  selectedId: null,
  viewMode: 'structure', // 'structure' (按域名目录树) | 'sequence' (平铺列表)
  theme: localStorage.getItem('hq_theme') || 'dark', // 'dark' | 'light'
  isRecording: true,
  proxyPort: 8888,
  webPort: 8899,
  lanIps: [],
  rules: [],
  toasts: [],

  // Mac 本机系统代理状态
  systemProxy: {
    supported: true,
    enabled: false,
    service: 'Wi-Fi',
    server: '127.0.0.1',
    port: 8888
  },

  // 过滤
  searchQuery: '',
  domainFilter: '', // 左侧栏顶部独立域名过滤
  filterMethod: 'ALL',
  filterStatus: 'ALL',
  onlyShowMocked: false,

  // 目录树折叠状态存储 (domain -> boolean)
  domainExpandedMap: new Map(),

  // 上下文菜单
  contextMenu: {
    visible: false,
    x: 0,
    y: 0,
    target: null
  },

  // 弹窗状态
  modals: {
    mock: false,
    rules: false,
    mobile: false,
    cert: false
  },

  // 通用确认弹窗组件状态
  confirmDialog: {
    visible: false,
    title: '确认提示',
    message: '',
    detail: '',
    confirmText: '确定',
    cancelText: '取消',
    type: 'danger', // 'danger' | 'warning' | 'info'
    resolve: null
  },

  // Mock 表单当前编辑对象
  mockForm: {
    id: null,
    name: '',
    enabled: true,
    matchMethod: 'GET',
    matchType: 'exact',
    pattern: '',
    statusCode: 200,
    statusMessage: 'OK',
    delay: 0,
    headersText: '{\n  "content-type": "application/json; charset=utf-8"\n}',
    body: ''
  },

  // 手机配网状态
  mobileConfig: {
    qrDataUrl: '',
    certUrl: '',
    activeTab: 'ios',
    systemCertFilename: '8adeb422.0',
    ios: { qrDataUrl: '', certUrl: '' },
    android: { qrDataUrl: '', certUrl: '' }
  }
});

// 计算属性：当前选中的请求事务
export const selectedRequest = computed(() => {
  return store.requests.find(r => r.id === store.selectedId) || null;
});

// 计算属性：按域名组织的目录树数据
export const domainTreeData = computed(() => {
  return buildDomainTree(store.requests, store.domainExpandedMap, store.searchQuery, store.domainFilter);
});

// 计算属性：平铺过滤列表 (Sequence 模式)
export const filteredRequests = computed(() => {
  const q = store.searchQuery.trim().toLowerCase();
  const dFilter = store.domainFilter.trim().toLowerCase();
  const method = store.filterMethod;
  const status = store.filterStatus;
  const mockOnly = store.onlyShowMocked;

  return store.requests.filter(r => {
    if (mockOnly && !r.isMocked) return false;
    if (method !== 'ALL' && r.method !== method) return false;

    // 域名过滤
    if (dFilter) {
      const host = (r.requestHeaders?.host || '').toLowerCase();
      const inUrl = (r.url || '').toLowerCase().includes(dFilter);
      if (!host.includes(dFilter) && !inUrl) return false;
    }

    if (status === '2xx' && (!r.statusCode || r.statusCode < 200 || r.statusCode >= 300)) return false;
    if (status === '3xx' && (!r.statusCode || r.statusCode < 300 || r.statusCode >= 400)) return false;
    if (status === '4xx' && (!r.statusCode || r.statusCode < 400 || r.statusCode >= 500)) return false;
    if (status === '5xx' && (!r.statusCode || r.statusCode < 500)) return false;
    if (status === 'mocked' && !r.isMocked) return false;

    if (q) {
      const inUrl = r.url?.toLowerCase().includes(q);
      const inMethod = r.method?.toLowerCase().includes(q);
      const inStatus = String(r.statusCode || '').includes(q);
      const inHost = r.requestHeaders?.host?.toLowerCase().includes(q);
      return inUrl || inMethod || inStatus || inHost;
    }
    return true;
  });
});

// 动作方法 Actions
export const actions = {
  // Toast 通知
  showToast(message, type = 'success') {
    const id = Date.now() + Math.random();
    store.toasts.push({ id, message, type });
    setTimeout(() => {
      store.toasts = store.toasts.filter(t => t.id !== id);
    }, 3000);
  },

  // 通用 Promise 确认对话框
  confirm({
    title = '确认提示',
    message = '确定要执行此操作吗？',
    detail = '',
    confirmText = '确定',
    cancelText = '取消',
    type = 'danger'
  } = {}) {
    return new Promise((resolve) => {
      store.confirmDialog = {
        visible: true,
        title,
        message,
        detail,
        confirmText,
        cancelText,
        type,
        resolve
      };
    });
  },

  closeConfirm(result = false) {
    if (typeof store.confirmDialog.resolve === 'function') {
      store.confirmDialog.resolve(result);
    }
    store.confirmDialog.visible = false;
    store.confirmDialog.resolve = null;
  },

  // 主题切换 (深色 / 浅色)
  toggleTheme() {
    store.theme = store.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('hq_theme', store.theme);
    document.documentElement.setAttribute('data-theme', store.theme);
    actions.showToast(`已切换至${store.theme === 'dark' ? '黑色深色' : '白色浅色'}主题`, 'success');
  },

  initTheme() {
    const saved = localStorage.getItem('hq_theme') || 'dark';
    store.theme = saved;
    document.documentElement.setAttribute('data-theme', saved);
  },

  // 选择节点
  selectRequest(id) {
    store.selectedId = id;
  },

  // 折叠/展开域名节点
  toggleDomain(domain) {
    const current = store.domainExpandedMap.has(domain) ? store.domainExpandedMap.get(domain) : true;
    store.domainExpandedMap.set(domain, !current);
  },

  // 全部展开
  expandAllDomains() {
    domainTreeData.value.forEach(d => {
      store.domainExpandedMap.set(d.domain, true);
    });
  },

  // 全部折叠
  collapseAllDomains() {
    domainTreeData.value.forEach(d => {
      store.domainExpandedMap.set(d.domain, false);
    });
  },

  // 右键菜单打开
  openContextMenu(event, targetTx) {
    event.preventDefault();
    if (targetTx) {
      store.selectedId = targetTx.id;
    }
    store.contextMenu.target = targetTx;
    store.contextMenu.x = Math.min(event.clientX, window.innerWidth - 240);
    store.contextMenu.y = Math.min(event.clientY, window.innerHeight - 220);
    store.contextMenu.visible = true;
  },

  closeContextMenu() {
    store.contextMenu.visible = false;
  },

  // 核心功能：打开 Map Local 弹窗并预填所有请求与响应
  openMockModal(tx = null) {
    actions.closeContextMenu();
    const target = tx || store.contextMenu.target || selectedRequest.value;
    if (!target) return;

    // 格式化响应 Body
    const { formatted: formattedBody } = formatJson(target.responseBody);

    // 清理并提取响应 Headers
    let cleanHeaders = { 'content-type': 'application/json; charset=utf-8' };
    if (target.responseHeaders) {
      const h = {};
      for (const [k, v] of Object.entries(target.responseHeaders)) {
        const lower = k.toLowerCase();
        if (!['content-length', 'transfer-encoding', 'content-encoding', 'connection', 'x-mocked-by', 'x-mock-rule-id'].includes(lower)) {
          h[k] = v;
        }
      }
      if (Object.keys(h).length > 0) cleanHeaders = h;
    }

    let pathOnly = target.path || '';
    try {
      if (target.url.startsWith('http://') || target.url.startsWith('https://')) {
        pathOnly = new URL(target.url).pathname;
      }
    } catch (e) {}

    store.mockForm = {
      id: null,
      name: `Mock [${target.method}] ${pathOnly || target.url.slice(0, 30)}`,
      enabled: true,
      matchMethod: target.method || 'GET',
      matchType: 'exact',
      pattern: target.url,
      statusCode: target.statusCode || 200,
      statusMessage: target.statusMessage || 'OK',
      delay: 0,
      headersText: JSON.stringify(cleanHeaders, null, 2),
      body: formattedBody,
      fromRulesModal: false
    };

    store.modals.mock = true;
  },

  // 复制剪贴板
  copy(text, msg = '已复制到剪贴板') {
    navigator.clipboard.writeText(text).then(() => {
      actions.showToast(msg, 'success');
    }).catch(() => {
      actions.showToast('复制失败，请手动选取', 'error');
    });
    actions.closeContextMenu();
  },

  // 清空历史记录
  async clearHistory() {
    await fetch('/api/requests', { method: 'DELETE' });
    store.requests = [];
    store.selectedId = null;
    actions.showToast('已清空抓包记录', 'success');
  },

  // 切换录制
  async toggleRecording() {
    const next = !store.isRecording;
    await fetch('/api/recording', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recording: next })
    });
    store.isRecording = next;
    actions.showToast(next ? '▶ 已开始抓包' : '⏸ 已暂停抓包', 'success');
  },

  // 保存 Mock 规则
  async saveMockRule() {
    const patternTrimmed = (store.mockForm.pattern || '').trim();
    if (!patternTrimmed) {
      actions.showToast('请输入目标匹配 URL / 路径', 'error');
      return;
    }

    let headersObj = {};
    try {
      headersObj = JSON.parse(store.mockForm.headersText || '{}');
    } catch (err) {
      actions.showToast('响应头 JSON 格式有误，请检查', 'error');
      return;
    }

    const finalName = (store.mockForm.name || '').trim() || `Mock [${store.mockForm.matchMethod}] ${patternTrimmed.slice(0, 36)}`;

    const payload = {
      name: finalName,
      enabled: store.mockForm.enabled,
      match: {
        method: store.mockForm.matchMethod,
        matchType: store.mockForm.matchType,
        pattern: patternTrimmed
      },
      response: {
        statusCode: parseInt(store.mockForm.statusCode, 10) || 200,
        statusMessage: store.mockForm.statusMessage || 'OK',
        delay: parseInt(store.mockForm.delay, 10) || 0,
        headers: headersObj,
        body: store.mockForm.body
      }
    };

    try {
      let res;
      if (store.mockForm.id) {
        res = await fetch(`/api/rules/${store.mockForm.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch('/api/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      const data = await res.json();
      if (data.success) {
        actions.showToast('⚡ Map Local 规则已生效！后续相同请求将被拦截', 'success');
        const shouldReturnToRules = !!store.mockForm.fromRulesModal;
        store.modals.mock = false;
        if (shouldReturnToRules) {
          store.modals.rules = true;
        }
      } else {
        actions.showToast('保存失败: ' + (data.error || '未知错误'), 'error');
      }
    } catch (err) {
      actions.showToast('网络请求错误: ' + err.message, 'error');
    }
  },

  // 切换 Mac 本机系统代理
  async toggleSystemProxy() {
    try {
      const res = await fetch('/api/system-proxy/toggle', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        store.systemProxy = {
          supported: data.supported,
          enabled: data.enabled,
          service: data.service,
          server: data.server,
          port: data.port
        };
        if (data.enabled) {
          const detail = data.service ? ` (${data.service})` : '';
          actions.showToast(`🖥️ 系统代理已开启${detail} -> 127.0.0.1:${data.port || store.proxyPort}`, 'success');
        } else {
          actions.showToast('🖥️ 系统代理已关闭', 'success');
        }
      } else {
        actions.showToast('切换系统代理失败: ' + (data.error || '未知错误'), 'error');
      }
    } catch (err) {
      actions.showToast('网络请求失败: ' + err.message, 'error');
    }
  },

  // 打开手机配网向导
  async openMobileModal() {
    try {
      const ip = store.lanIps[0]?.ip || '127.0.0.1';
      const platform = store.mobileConfig.activeTab || 'ios';
      const res = await fetch(`/api/qrcode?ip=${ip}&platform=${platform}`);
      const data = await res.json();
      if (data.systemCertFilename) {
        store.mobileConfig.systemCertFilename = data.systemCertFilename;
      }
      store.mobileConfig.ios = data.ios || { qrDataUrl: data.qrDataUrl, certUrl: data.certUrl };
      store.mobileConfig.android = data.android || { qrDataUrl: data.qrDataUrl, certUrl: data.certUrl };
      const current = store.mobileConfig[platform] || store.mobileConfig.ios;
      store.mobileConfig.qrDataUrl = current.qrDataUrl;
      store.mobileConfig.certUrl = current.certUrl;
    } catch (err) {
      console.error('获取二维码失败:', err);
    }
    store.modals.mobile = true;
  },

  switchMobilePlatform(platform) {
    store.mobileConfig.activeTab = platform;
    const target = store.mobileConfig[platform];
    if (target && target.qrDataUrl) {
      store.mobileConfig.qrDataUrl = target.qrDataUrl;
      store.mobileConfig.certUrl = target.certUrl;
    }
  },

  // 初始化 WebSocket
  initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const { type, data } = msg;

        if (type === 'init') {
          store.requests = data.requests || [];
          store.rules = data.rules || [];
          store.isRecording = data.isRecording;
          store.proxyPort = data.proxyPort;
          store.webPort = data.webPort;
          store.lanIps = data.lanIps || [];
          if (data.systemProxy) store.systemProxy = data.systemProxy;
          if (store.requests.length > 0 && !store.selectedId) {
            store.selectedId = store.requests[0].id;
          }
        } else if (type === 'request') {
          store.requests.unshift(data);
          if (store.requests.length > 1000) store.requests.pop();
          if (!store.selectedId) store.selectedId = data.id;
        } else if (type === 'response') {
          const index = store.requests.findIndex(r => r.id === data.id);
          if (index !== -1) {
            store.requests[index] = { ...store.requests[index], ...data };
          } else {
            store.requests.unshift(data);
          }
        } else if (type === 'history-cleared') {
          store.requests = [];
          store.selectedId = null;
        } else if (type === 'recording-toggled') {
          store.isRecording = data;
        } else if (type === 'rules-updated') {
          store.rules = data;
        } else if (type === 'system-proxy-changed') {
          store.systemProxy = data;
        }
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

    ws.onclose = () => {
      setTimeout(() => actions.initWebSocket(), 2000);
    };
  }
};
