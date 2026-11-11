# Code Review 问题与建议（三次修复后复审）

> 仓库：`HqNetworkPacketCapture`（分支 `main`，工作区含未提交修复）

## 一、问题

### A. 安全（残余）
- **Web API 仍无身份认证/token**：仅靠 Origin 校验，安全性有限（设计为本地工具，但需明确风险）。
- **`file:` 协议被允许为 Origin**：本地 HTML 文件可调用本地 API（风险较低，但可收紧）。
- **证书下载无访问控制**：配网需要，但应提示风险。

### B. 性能/稳定性
- **WebSocket 广播完整事务（含响应体）**：每次响应都广播，虽已截断至 1MB，大流量下仍有压力。
- **前端 1000 条上限但无虚拟滚动**：大量请求时渲染压力。
- **HEIC 转换仅 macOS**；其他平台直接返回原 buffer，预览失败。
- **`cert-manager` 依赖系统 `openssl`** 计算 Android 哈希，非 macOS/Linux 可能缺失（有 fallback）。

### C. 工程化
- **无自动化测试**（项目采用人工测试，不引入测试框架）。
- **前端无类型检查**；可考虑 JSDoc 或迁移 TS（成本较高，可选）。
- **`system-proxy-manager` Windows 仅修改 HKCU Internet Settings**，对部分应用不生效（WinHTTP/代理感知差异）。

### D. 可维护性
- **`system-proxy-manager` Windows HKCU 局限**需文档说明。
- **`store.js` 仍较大**（~550 行），可继续按领域拆分 actions。
- **`codereview/` 被 `.gitignore` 忽略**：审查文档默认不入库（如需版本管理可调整）。

---

## 二、建议（按优先级）

| 优先级 | 事项 |
|---|---|
| P1 | Web 证书/配置文档补充 `WEB_HOST` 与 `--host` 用法 |
| P1 | Windows 代理局限文档说明 |
| P2 | 前端虚拟滚动、HEIC 跨平台 |
| P2 | WebSocket 广播瘦身（仅发送必要字段/增量） |
| P2 | `store.js` 继续拆分、Origin `file:` 协议收紧 |