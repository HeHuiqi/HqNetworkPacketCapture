import { parseUrl } from './formatters.js';

/**
 * 将平铺的抓包记录按域名组织为 Charles 风格的树状结构
 */
export function buildDomainTree(requests, expandedMap = new Map(), searchQuery = '', domainFilter = '') {
  const query = searchQuery.trim().toLowerCase();
  const dFilter = domainFilter.trim().toLowerCase();
  const domainMap = new Map();

  for (const req of requests) {
    const { host, protocol, pathname, search } = parseUrl(req.url);
    const domainKey = host || (req.requestHeaders?.host) || '未知域名';

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
        protocol: protocol || req.protocol || 'http',
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
