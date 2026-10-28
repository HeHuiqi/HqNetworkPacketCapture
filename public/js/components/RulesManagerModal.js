import { store, actions } from '../store.js';

export default {
  name: 'RulesManagerModal',
  setup() {
    const toggleRule = async (rule) => {
      const res = await fetch(`/api/rules/${rule.id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled })
      });
      const data = await res.json();
      if (data.success) {
        rule.enabled = data.rule.enabled;
        actions.showToast(`规则 "${rule.name}" 已${rule.enabled ? '启用' : '禁用'}`, 'success');
      }
    };

    const addNewRule = () => {
      store.mockForm = {
        id: null,
        name: '',
        enabled: true,
        matchMethod: 'ALL',
        matchType: 'exact',
        pattern: '',
        statusCode: 200,
        statusMessage: 'OK',
        delay: 0,
        headersText: JSON.stringify({ 'content-type': 'application/json; charset=utf-8' }, null, 2),
        body: '{\n  "code": 0,\n  "message": "ok",\n  "data": {}\n}',
        fromRulesModal: true
      };
      store.modals.rules = false;
      store.modals.mock = true;
    };

    const editRule = (rule) => {
      store.mockForm = {
        id: rule.id,
        name: rule.name,
        enabled: rule.enabled,
        matchMethod: rule.match.method,
        matchType: rule.match.matchType,
        pattern: rule.match.pattern,
        statusCode: rule.response.statusCode,
        statusMessage: rule.response.statusMessage || 'OK',
        delay: rule.response.delay || 0,
        headersText: JSON.stringify(rule.response.headers || {}, null, 2),
        body: rule.response.body || '',
        fromRulesModal: true
      };
      store.modals.rules = false;
      store.modals.mock = true;
    };

    const copyRule = async (rule) => {
      const payload = {
        name: `${rule.name} (副本)`,
        enabled: rule.enabled,
        match: {
          method: rule.match.method || 'ALL',
          matchType: rule.match.matchType || 'exact',
          pattern: rule.match.pattern || ''
        },
        response: {
          statusCode: rule.response.statusCode || 200,
          statusMessage: rule.response.statusMessage || 'OK',
          delay: rule.response.delay || 0,
          headers: { ...(rule.response.headers || {}) },
          body: rule.response.body || ''
        }
      };

      try {
        const res = await fetch('/api/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          if (!store.rules.some(r => r.id === data.rule.id)) {
            store.rules.unshift(data.rule);
          }
          actions.showToast(`已复制并新建规则 "${data.rule.name}"`, 'success');
        } else {
          actions.showToast('复制规则失败: ' + (data.error || '未知错误'), 'error');
        }
      } catch (err) {
        actions.showToast('复制规则出错: ' + err.message, 'error');
      }
    };

    const deleteRule = async (ruleId) => {
      const targetRule = store.rules.find(r => r.id === ruleId);
      const ruleName = targetRule?.name || '此规则';

      const confirmed = await actions.confirm({
        title: '删除规则确认',
        message: `确定要删除 Mock 规则 "${ruleName}" 吗？`,
        detail: '删除后此条规则将立即失效，对应的网络接口将恢复正常请求透传。',
        confirmText: '确认删除',
        cancelText: '取消',
        type: 'danger'
      });

      if (!confirmed) return;

      const res = await fetch(`/api/rules/${ruleId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        store.rules = store.rules.filter(r => r.id !== ruleId);
        actions.showToast('规则已删除', 'success');
      }
    };

    return {
      store,
      actions,
      toggleRule,
      addNewRule,
      editRule,
      copyRule,
      deleteRule
    };
  },
  template: `
    <div class="modal-overlay" v-if="store.modals.rules" @click.self="store.modals.rules = false">
      <div class="modal-card modal-lg">
        <div class="modal-header">
          <div class="modal-title">
            <span>🎯 Map Local 规则库管理 (共 {{ store.rules.length }} 条)</span>
          </div>
          <div class="modal-header-actions">
            <button class="btn btn-primary btn-sm rules-add-btn" @click="addNewRule" title="手动添加新规则">
              <span class="rules-add-plus">＋</span>
              <span>新增规则</span>
            </button>
            <button class="close-btn" @click="store.modals.rules = false">✕</button>
          </div>
        </div>

        <div class="modal-body">
          <div v-if="store.rules.length === 0" class="rules-empty">
            暂无 Mock 规则。可点击右上角 <strong>"＋ 新增规则"</strong> 手动创建，或在左侧列表中 <strong>右键点击任意请求</strong> 选择 <strong>"Map Local (Mock 当前请求)"</strong> 一键添加！
          </div>

          <table v-else class="rules-table">
            <thead>
              <tr>
                <th style="width: 56px; text-align: center;">状态</th>
                <th style="width: 170px;">规则名称</th>
                <th>匹配 URL / 路径</th>
                <th style="width: 76px; text-align: center;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in store.rules" :key="r.id">
                <td style="text-align: center;">
                  <label class="switch">
                    <input type="checkbox" :checked="r.enabled" @change="toggleRule(r)">
                    <span class="slider"></span>
                  </label>
                </td>
                <td>
                  <div class="rule-name-cell" :title="r.name">{{ r.name }}</div>
                </td>
                <td>
                  <div class="rules-url-cell" :title="r.match.pattern">
                    {{ r.match.pattern }}
                  </div>
                </td>
                <td style="text-align: center;">
                  <div class="rules-actions-group">
                    <button class="btn btn-default btn-xs" @click="editRule(r)" title="编辑规则">编辑</button>
                    <button class="btn btn-default btn-xs" @click="copyRule(r)" title="一键复制并新建规则">复制</button>
                    <button class="btn btn-danger btn-xs" @click="deleteRule(r.id)" title="删除规则">删除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="modal-footer">
          <button class="btn btn-default" @click="store.modals.rules = false">关闭</button>
        </div>
      </div>
    </div>
  `
};
