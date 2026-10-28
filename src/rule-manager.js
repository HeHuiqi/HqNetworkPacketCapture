const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

// 优先使用用户主目录 ~/.hqnetwork 存放规则数据
const BASE_DIR = process.env.HQ_DATA_DIR || path.join(os.homedir(), '.hqnetwork');
const DATA_DIR = path.join(BASE_DIR, 'data');
const RULES_FILE = path.join(DATA_DIR, 'rules.json');

class RuleManager extends EventEmitter {
  constructor() {
    super();
    this.rules = [];
    this._init();
  }

  _init() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(RULES_FILE)) {
      try {
        const raw = fs.readFileSync(RULES_FILE, 'utf8');
        this.rules = JSON.parse(raw);
      } catch (err) {
        console.error('[RuleManager] 读取规则文件失败，使用空规则:', err.message);
        this.rules = [];
      }
    } else {
      this.rules = [];
      this._persist();
    }
  }

  _persist() {
    try {
      fs.writeFileSync(RULES_FILE, JSON.stringify(this.rules, null, 2), 'utf8');
      this.emit('rules-changed', this.rules);
    } catch (err) {
      console.error('[RuleManager] 持久化规则文件失败:', err.message);
    }
  }

  getRules() {
    return this.rules;
  }

  getRule(id) {
    return this.rules.find(r => r.id === id);
  }

  addRule(ruleData) {
    const newRule = {
      id: ruleData.id || `rule_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      name: ruleData.name || '未命名 Mock 规则',
      enabled: ruleData.enabled !== false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      match: {
        method: (ruleData.match?.method || 'ALL').toUpperCase(),
        matchType: ruleData.match?.matchType || 'exact', // 'exact' | 'path' | 'contains' | 'regex'
        pattern: ruleData.match?.pattern || ''
      },
      response: {
        statusCode: parseInt(ruleData.response?.statusCode || 200, 10),
        statusMessage: ruleData.response?.statusMessage || 'OK',
        delay: parseInt(ruleData.response?.delay || 0, 10),
        headers: ruleData.response?.headers || {
          'content-type': 'application/json; charset=utf-8'
        },
        body: typeof ruleData.response?.body === 'string'
          ? ruleData.response.body
          : JSON.stringify(ruleData.response?.body || {}, null, 2)
      }
    };

    this.rules.unshift(newRule);
    this._persist();
    return newRule;
  }

  updateRule(id, updatedFields) {
    const index = this.rules.findIndex(r => r.id === id);
    if (index === -1) {
      return null;
    }

    const current = this.rules[index];
    const updated = {
      ...current,
      ...updatedFields,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
      match: {
        ...current.match,
        ...(updatedFields.match || {})
      },
      response: {
        ...current.response,
        ...(updatedFields.response || {})
      }
    };

    if (updatedFields.response?.statusCode) {
      updated.response.statusCode = parseInt(updatedFields.response.statusCode, 10);
    }
    if (updatedFields.response?.delay !== undefined) {
      updated.response.delay = parseInt(updatedFields.response.delay, 10);
    }

    this.rules[index] = updated;
    this._persist();
    return updated;
  }

  toggleRule(id, enabled) {
    const rule = this.rules.find(r => r.id === id);
    if (!rule) return null;
    rule.enabled = enabled !== undefined ? !!enabled : !rule.enabled;
    rule.updatedAt = Date.now();
    this._persist();
    return rule;
  }

  deleteRule(id) {
    const index = this.rules.findIndex(r => r.id === id);
    if (index === -1) return false;
    this.rules.splice(index, 1);
    this._persist();
    return true;
  }
}

module.exports = new RuleManager();
