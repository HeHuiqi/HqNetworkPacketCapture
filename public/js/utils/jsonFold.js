import { highlightJson } from './formatters.js';

/**
 * 计算多行 JSON 文本中所有可折叠的括号区间 ({...} / [...])
 * 返回 { [startLineIndex]: { endLine, type: 'object' | 'array' } }
 */
export function computeFoldRanges(lines) {
  const stack = [];
  const foldRanges = {};
  for (let idx = 0; idx < lines.length; idx++) {
    const lineText = lines[idx];
    for (let i = 0; i < lineText.length; i++) {
      const char = lineText[i];
      if (char === '"') {
        i++;
        while (i < lineText.length && lineText[i] !== '"') {
          if (lineText[i] === '\\') i++;
          i++;
        }
      } else if (char === '{' || char === '[') {
        stack.push({ char, lineIndex: idx });
      } else if (char === '}' || char === ']') {
        const matchChar = char === '}' ? '{' : '[';
        if (stack.length > 0 && stack[stack.length - 1].char === matchChar) {
          const open = stack.pop();
          if (open.lineIndex !== idx) {
            foldRanges[open.lineIndex] = {
              endLine: idx,
              type: open.char === '{' ? 'object' : 'array'
            };
          }
        }
      }
    }
  }
  return foldRanges;
}

/**
 * 提取折叠行的前缀文本与折叠胶囊文案
 */
export function getFoldPrefixAndBadge(lineText, endLineText, type) {
  const bracket = type === 'object' ? '{' : '[';
  const bracketPos = lineText.lastIndexOf(bracket);
  const prefix = bracketPos >= 0 ? lineText.slice(0, bracketPos) : lineText;
  const hasComma = (endLineText || '').trim().endsWith(',');
  const closeBracket = type === 'object' ? '}' : ']';
  return {
    prefix,
    badgeLabel: `${bracket} ... ${closeBracket}${hasComma ? ',' : ''}`
  };
}

/**
 * 计算每一行对应的 JSONPath 路径 (如 data.user.name, items[0].id)
 */
export function computeLineJsonPaths(lines) {
  const linePaths = new Array(lines.length).fill('');
  const stack = []; // { type: 'object'|'array', key: null, index: 0 }

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const isClosing = /^[}\]],?$/.test(trimmed);
    const keyMatch = trimmed.match(/^\"((?:\\\\\"|[^\"])+)\"\s*:/);
    const key = keyMatch ? keyMatch[1] : null;

    if (isClosing) {
      if (stack.length > 0) {
        stack.pop();
        if (stack.length > 0 && stack[stack.length - 1].type === 'array') {
          stack[stack.length - 1].index++;
        }
      }
      continue;
    }

    const pathParts = [];
    for (let i = 0; i < stack.length; i++) {
      const parent = stack[i];
      if (parent.key) pathParts.push(parent.key);
      if (parent.type === 'array') {
        pathParts.push('[' + parent.index + ']');
      }
    }

    if (key) {
      pathParts.push(key);
    }

    let fullPath = '';
    for (const part of pathParts) {
      if (part.startsWith('[')) {
        fullPath += part;
      } else {
        fullPath = fullPath ? (fullPath + '.' + part) : part;
      }
    }
    linePaths[idx] = fullPath;

    const opensObject = /[{\[]\s*,?$/.test(trimmed) && trimmed.includes('{');
    const opensArray = /[{\[]\s*,?$/.test(trimmed) && trimmed.includes('[');

    if (opensObject) {
      stack.push({ type: 'object', key: key || null });
    } else if (opensArray) {
      stack.push({ type: 'array', key: key || null, index: 0 });
    } else if (stack.length > 0 && stack[stack.length - 1].type === 'array') {
      stack[stack.length - 1].index++;
    }
  }

  return linePaths;
}

/**
 * 根据折叠状态集合计算可见行列表（含高亮 HTML 与折叠信息）
 */
export function computeVisibleFoldLines(lines, ranges, collapsed, linePaths = []) {
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    let isHidden = false;
    for (const startIdx of collapsed) {
      const range = ranges[startIdx];
      if (range && i > startIdx && i <= range.endLine) {
        isHidden = true;
        break;
      }
    }

    if (!isHidden) {
      const isFolded = collapsed.has(i);
      const canFold = !!ranges[i];
      let prefixHtml = '';
      let badgeInfo = null;
      const jsonPath = linePaths[i] || '';

      if (isFolded && ranges[i]) {
        const endText = lines[ranges[i].endLine] || '';
        const foldData = getFoldPrefixAndBadge(lines[i], endText, ranges[i].type);
        prefixHtml = highlightJson(foldData.prefix);
        badgeInfo = {
          label: foldData.badgeLabel,
          count: `${ranges[i].endLine - i} 行已折叠`
        };
      } else {
        prefixHtml = highlightJson(lines[i]);
      }

      result.push({
        lineIdx: i,
        canFold,
        isFolded,
        prefixHtml,
        badgeInfo,
        jsonPath
      });
    }
  }
  return result;
}
