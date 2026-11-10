import { ref, computed, watch } from '/vendor/vue.esm-browser.js';
import { store, actions } from '../store.js';

export default {
  name: 'UpstreamProxyModal',
  setup() {
    const form = ref({
      enabled: false,
      type: 'http',
      host: '127.0.0.1',
      port: 7890,
      noProxy: 'localhost, 127.0.0.1, 10.*, 192.168.*, 172.16.*'
    });

    const isTesting = ref(false);
    const testResult = ref(null);

    // 当打开弹窗时，从 store 同步最新配置
    watch(() => store.modals.upstream, (isOpen) => {
      if (isOpen) {
        testResult.value = null;
        form.value = {
          enabled: !!store.upstreamProxy.enabled,
          type: store.upstreamProxy.type || 'http',
          host: store.upstreamProxy.host || '127.0.0.1',
          port: store.upstreamProxy.port || 7890,
          noProxy: store.upstreamProxy.noProxy || 'localhost, 127.0.0.1, 10.*, 192.168.*, 172.16.*'
        };
      }
    });

    const fullProxyUrl = computed(() => {
      const h = (form.value.host || '127.0.0.1').trim();
      const p = form.value.port || 7890;
      return `${form.value.type}://${h}:${p}`;
    });

    // 快捷应用常见 VPN 预设
    const applyPreset = (preset) => {
      if (preset === 'clash') {
        form.value.type = 'http';
        form.value.host = '127.0.0.1';
        form.value.port = 7890;
      } else if (preset === 'v2ray') {
        form.value.type = 'http';
        form.value.host = '127.0.0.1';
        form.value.port = 10809;
      } else if (preset === 'ss') {
        form.value.type = 'socks5';
        form.value.host = '127.0.0.1';
        form.value.port = 1080;
      } else if (preset === 'surge') {
        form.value.type = 'http';
        form.value.host = '127.0.0.1';
        form.value.port = 6152;
      }
      testResult.value = null;
    };

    // 测试上游代理端口连通性
    const testConnection = async () => {
      isTesting.value = true;
      testResult.value = null;
      try {
        const res = await actions.testUpstreamProxy(form.value.host, form.value.port);
        testResult.value = res;
      } catch (err) {
        testResult.value = { success: false, error: err.message };
      } finally {
        isTesting.value = false;
      }
    };

    // 保存配置
    const saveConfig = () => {
      actions.saveUpstreamProxy({
        enabled: form.value.enabled,
        type: form.value.type,
        host: form.value.host.trim(),
        port: parseInt(form.value.port, 10) || 7890,
        noProxy: form.value.noProxy
      });
    };

    const closeModal = () => {
      store.modals.upstream = false;
    };

    return {
      store,
      form,
      fullProxyUrl,
      isTesting,
      testResult,
      applyPreset,
      testConnection,
      saveConfig,
      closeModal
    };
  },
  template: `
    <div class="modal-overlay" v-if="store.modals.upstream" @click.self="closeModal">
      <div class="modal-card modal-upstream">
        <div class="modal-header">
          <div class="modal-title">
            <span>🚀 上游外部代理设置 (External Upstream Proxy)</span>
          </div>
          <button class="close-btn" @click="closeModal" title="关闭窗口">✕</button>
        </div>

        <div class="modal-body">
          <!-- 原理解析与重要提示 -->
          <div class="upstream-tip-card">
            <div class="tip-card-title">💡 为什么需要上游代理？</div>
            <div class="tip-card-desc">
              当开启 Clash、Surge、v2rayN 等翻墙软件或公司 VPN 时，抓包工具解密后若直接连接外网会被防火墙阻断（出现 502/连接超时）。
              开启上游代理后，抓包工具会将透传流量自动转发给你的 VPN 客户端，<strong>实现同时抓包解密 + 正常翻墙/内网访问</strong>！
            </div>
          </div>

          <!-- 总开关 -->
          <div class="form-box" style="margin-top: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-weight: 700; font-size: 13.5px; color: var(--text-main);">
                  启用上游代理转发 (Upstream Proxy)
                </div>
                <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 2px;">
                  开启后，未命中 Mock 规则的请求将通过下方指定的外部代理出站
                </div>
              </div>

              <div style="display: flex; align-items: center; gap: 8px;">
                <label class="switch">
                  <input type="checkbox" v-model="form.enabled">
                  <span class="slider"></span>
                </label>
                <span style="font-size: 12px; font-weight: 600;" :style="{ color: form.enabled ? 'var(--accent-green)' : 'var(--text-muted)' }">
                  {{ form.enabled ? '已开启' : '已关闭' }}
                </span>
              </div>
            </div>
          </div>

          <!-- 代理参数配置 -->
          <div class="form-box" style="margin-top: 12px;" :style="{ opacity: form.enabled ? 1 : 0.65 }">
            <div class="form-box-title" style="color: #60a5fa;">
              代理服务器配置
            </div>

            <!-- 快捷预设按钮 -->
            <div style="margin-bottom: 12px;">
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">一键填入常见 VPN 客户端端口预设：</div>
              <div class="upstream-preset-btns">
                <button type="button" class="btn btn-default btn-xs" @click="applyPreset('clash')">
                  ⚡ Clash (7890)
                </button>
                <button type="button" class="btn btn-default btn-xs" @click="applyPreset('v2ray')">
                  ⚡ v2rayN (10809)
                </button>
                <button type="button" class="btn btn-default btn-xs" @click="applyPreset('surge')">
                  ⚡ Surge (6152)
                </button>
                <button type="button" class="btn btn-default btn-xs" @click="applyPreset('ss')">
                  ⚡ Shadowsocks (1080)
                </button>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 1;">
                <label class="form-label">协议类型</label>
                <select class="form-select" v-model="form.type">
                  <option value="http">HTTP / HTTPS 代理</option>
                  <option value="socks5">SOCKS5 代理</option>
                </select>
              </div>

              <div class="form-group" style="flex: 2;">
                <label class="form-label">代理主机地址 (Host)</label>
                <input type="text" class="form-input" v-model="form.host" placeholder="127.0.0.1" />
              </div>

              <div class="form-group" style="flex: 1;">
                <label class="form-label">代理端口 (Port)</label>
                <input type="number" class="form-input" v-model.number="form.port" placeholder="7890" />
              </div>
            </div>

            <div style="margin-top: 6px; display: flex; justify-content: space-between; align-items: center;">
              <div style="font-size: 11.5px; color: var(--text-dim);">
                完整代理地址: <code class="highlight-code">{{ fullProxyUrl }}</code>
              </div>

              <!-- 连通性测试按钮 -->
              <button 
                type="button" 
                class="btn btn-default btn-xs" 
                :disabled="isTesting" 
                @click="testConnection"
                title="检测指定主机的代理端口是否处于监听可用状态"
              >
                <span>{{ isTesting ? '⏳ 检测中...' : '⚡ 测试连通性' }}</span>
              </button>
            </div>

            <!-- 测试结果反馈 -->
            <div v-if="testResult" style="margin-top: 8px;">
              <div v-if="testResult.success" class="test-feedback-success">
                <span>✅ {{ testResult.message }} (代理客户端运行正常，可正常转发)</span>
              </div>
              <div v-else class="test-feedback-error">
                <span>❌ {{ testResult.error }}</span>
              </div>
            </div>
          </div>

          <!-- 绕过代理地址 -->
          <div class="form-box" style="margin-top: 12px;">
            <div class="form-box-title" style="color: #c084fc;">
              不代理列表 (Bypass / No Proxy)
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <textarea 
                class="form-textarea" 
                rows="2" 
                v-model="form.noProxy" 
                placeholder="localhost, 127.0.0.1, 10.*, 192.168.*"
              ></textarea>
              <div class="form-hint">
                提示: 匹配上述域名或 IP 的请求将不经过上游代理，直接在本地直连（用逗号分隔）。
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-default" @click="closeModal">取消</button>
          <button class="btn btn-purple" @click="saveConfig">
            <span>💾 保存并即刻生效</span>
          </button>
        </div>
      </div>
    </div>
  `
};
