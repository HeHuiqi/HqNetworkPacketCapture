/**
 * 工具函数库：格式化、解析与生成
 */

export function formatJson(content) {
  if (!content) return { formatted: '', isValidJson: false };
  if (typeof content === 'object') {
    return { formatted: JSON.stringify(content, null, 2), isValidJson: true };
  }
  try {
    const parsed = JSON.parse(content);
    return { formatted: JSON.stringify(parsed, null, 2), isValidJson: true };
  } catch (e) {
    return { formatted: String(content), isValidJson: false };
  }
}

/**
 * HTML 特殊字符转义，防御 XSS
 */
export function escapeHtml(text) {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 纯前端原生 JSON 语法着色分词器
 * 将 JSON 字符串解析为带 Token 样式的 HTML 片段（包括键名、字符串、数值、布尔值、空值、标点符号）
 */
export function highlightJson(jsonStr, emptyPlaceholder = '') {
  if (!jsonStr) return emptyPlaceholder;
  // 防御性保护：若 JSON 超过 2MB，避免海量 DOM 节点导致页面卡顿
  if (jsonStr.length > 2 * 1024 * 1024) {
    return escapeHtml(jsonStr);
  }
  const safe = escapeHtml(jsonStr);
  const tokenRegex = /("(?:\\.|[^"\\])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|[{}\[\]:,])/g;

  const res = safe.replace(tokenRegex, (match) => {
    let cls = 'tok-number';
    if (match.charCodeAt(0) === 34) {
      if (match.endsWith(':')) {
        const colonIdx = match.lastIndexOf(':');
        const keyPart = match.slice(0, colonIdx);
        const colonPart = match.slice(colonIdx);
        return `<span class="tok-key">${keyPart}</span><span class="tok-colon">${colonPart}</span>`;
      } else {
        cls = 'tok-string';
      }
    } else if (match === 'true' || match === 'false') {
      cls = 'tok-boolean';
    } else if (match === 'null') {
      cls = 'tok-null';
    } else if (match === '{' || match === '}' || match === '[' || match === ']' || match === ',' || match === ':') {
      cls = 'tok-punct';
    }
    return `<span class="${cls}">${match}</span>`;
  });

  return res + (jsonStr.endsWith('\n') ? ' ' : '');
}

export function parseUrl(urlStr) {
  if (!urlStr) return { protocol: '', host: '', pathname: '', search: '', params: {} };
  try {
    const u = new URL(urlStr);
    const params = {};
    u.searchParams.forEach((val, key) => {
      params[key] = val;
    });
    return {
      protocol: u.protocol.replace(':', ''),
      host: u.host,
      hostname: u.hostname,
      port: u.port,
      pathname: u.pathname,
      search: u.search,
      params
    };
  } catch (e) {
    return { protocol: 'http', host: 'unknown', pathname: urlStr, search: '', params: {} };
  }
}

export function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function formatDuration(ms) {
  if (ms === null || ms === undefined) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  const cookies = {};
  cookieHeader.split(';').forEach(pair => {
    const [k, ...v] = pair.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=').trim();
  });
  return cookies;
}

export function generateCurl(tx) {
  if (!tx) return '';
  let cmd = `curl -X ${tx.method || 'GET'} "${tx.url}"`;
  if (tx.requestHeaders) {
    for (const [k, v] of Object.entries(tx.requestHeaders)) {
      if (!['host', 'content-length'].includes(k.toLowerCase())) {
        cmd += ` \\\n  -H "${k}: ${v}"`;
      }
    }
  }
  if (tx.requestBody && ['POST', 'PUT', 'PATCH'].includes(tx.method)) {
    cmd += ` \\\n  --data '${tx.requestBody.replace(/'/g, "'\\''")}'`;
  }
  return cmd;
}

export function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '-';
  const num = Number(bytes);
  if (num === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(num) / Math.log(k));
  return parseFloat((num / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getFilenameFromUrl(urlStr, defaultExt = 'bin') {
  if (!urlStr) return `download.${defaultExt}`;
  try {
    const u = new URL(urlStr);
    const pathname = u.pathname;
    const base = pathname.split('/').filter(Boolean).pop();
    if (base && base.includes('.')) return base;
    return `download.${defaultExt}`;
  } catch (e) {
    return `download.${defaultExt}`;
  }
}

/**
 * 清理并规范化用于 Mock 响应的 Headers（过滤传输编码、长度与注入标记头）
 */
export function cleanMockResponseHeaders(headers) {
  const defaultHeaders = { 'content-type': 'application/json; charset=utf-8' };
  if (!headers || typeof headers !== 'object') return defaultHeaders;

  const ignoredHeaders = new Set([
    'content-length',
    'transfer-encoding',
    'content-encoding',
    'connection',
    'keep-alive',
    'x-mocked-by',
    'x-mock-rule-id'
  ]);

  const cleaned = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!ignoredHeaders.has(k.toLowerCase())) {
      cleaned[k] = v;
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : defaultHeaders;
}

