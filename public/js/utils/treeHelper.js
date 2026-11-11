import { parseUrl } from './formatters.js';

/**
 * 判断请求是否属于直接向代理端口发起的无 Host 探测或探活心跳 (如直接访问 127.0.0.1:8888/)
 */
export function isDirectProbe(req) {
  if (!req) return false;
  const hostHeader = (req.requestHeaders?.host || req.requestHeaders?.[':authority'] || '').trim();
  const rawUrl = req.rawUrl || req.url || '';
  const isRoot = rawUrl === '/' || req.path === '/' || !rawUrl;

  // 没有 Host 请求头且请求根路径
  if (!hostHeader && isRoot) return true;
  // 或者 Host 明确是代理端口自身且未指定真实代理目标
  if (isRoot && /^(127\.0\.0\.1|localhost|0\.0\.0\.0):(88\d{2}|89\d{2})/i.test(hostHeader)) {
    return true;
  }
  return false;
}

/**
 * 将平铺的抓包记录按域名组织为 Charles 风格的树状结构
 */
export function buildDomainTree(requests, expandedMap = new Map(), searchQuery = '', domainFilter = '', hideDirectProbes = true) {
  const query = searchQuery.trim().toLowerCase();
  const dFilter = domainFilter.trim().toLowerCase();
  const domainMap = new Map();

  for (const req of requests) {
    // 智能过滤无 Host 头的无效探测请求（防范重试刷屏）
    if (hideDirectProbes && isDirectProbe(req)) {
      continue;
    }

    const { host, protocol, pathname, search } = parseUrl(req.url);
    const hostHeader = (req.requestHeaders?.host || req.requestHeaders?.[':authority'] || '').trim();

    let domainKey;
    const isProbe = isDirectProbe(req);

    if (isProbe) {
      domainKey = '⚠️ 无 Host 探测 (直接访问代理端口)';
    } else {
      // 优先采用原始业务域名作为树状分组 Key，避免被内部解析后的 IP 拆分
      const isHeaderDomain = hostHeader && !/^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(hostHeader);
      const isUrlDomain = host && !/^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(host);
      domainKey = isHeaderDomain ? hostHeader : (isUrlDomain ? host : (hostHeader || host || '⚠️ 未知来源请求'));
    }

    // 顶部域名过滤器：不匹配该域名的直接排除
    if (dFilter && !domainKey.toLowerCase().includes(dFilter)) {
      continue;
    }

    if (!domainMap.has(domainKey)) {
      // 若处于域名搜索中，默认自动展开匹配的目录
      const isExpanded = dFilter
        ? (expandedMap.has(domainKey) ? expandedMap.get(domainKey) : true)
        : (expandedMap.has(domainKey) ? expandedMap.get(domainKey) : true);

      domainMap.set(domainKey, {
        id: `domain_${domainKey}`,
        domain: domainKey,
        protocol: isProbe ? 'probe' : (protocol || req.protocol || 'http'),
        isProbe,
        requestCount: 0,
        hasMocked: false,
        expanded: isExpanded,
        requests: []
      });
    }

    const domainNode = domainMap.get(domainKey);
    domainNode.requestCount++;
    if (req.isMocked) {
      domainNode.hasMocked = true;
    }

    // 格式化展示路径
    const displayName = (pathname || '/') + (search || '');
    domainNode.requests.push({
      id: req.id,
      displayName,
      pathname: pathname || '/',
      method: req.method,
      statusCode: req.statusCode,
      statusMessage: req.statusMessage,
      isMocked: req.isMocked,
      duration: req.duration,
      requestTime: req.requestTime,
      tx: req
    });
  }

  // 转换为数组并支持过滤
  const treeNodes = Array.from(domainMap.values()).map(domainNode => {
    // 按请求时间正序或倒序排列子请求
    const filteredChildren = domainNode.requests.filter(req => {
      if (!query) return true;
      const inDomain = domainNode.domain.toLowerCase().includes(query);
      const inPath = req.displayName.toLowerCase().includes(query);
      const inMethod = req.method.toLowerCase().includes(query);
      const inStatus = String(req.statusCode || '').includes(query);
      return inDomain || inPath || inMethod || inStatus;
    });

    return {
      ...domainNode,
      children: filteredChildren,
      // 如果当前域名匹配或有匹配的子请求，则显示
      matched: query ? (domainNode.domain.toLowerCase().includes(query) || filteredChildren.length > 0) : true
    };
  }).filter(node => node.matched && node.children.length > 0);

  return treeNodes;
}
