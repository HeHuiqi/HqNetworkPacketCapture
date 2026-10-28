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
