// 检测报告拍照识别解析器
// 输入 OCR 文本块（{ text, pos }，由 recognizeReportCustom 云函数适配后下发），
// 输出可以直接合并进 add-report 表单的指标数据（{ [indicatorKey]: { value, minRange, maxRange, sourceText } }）。
// 全模块不依赖 wx 全局对象，保持纯函数，方便单测覆盖识别准确率相关的边界场景。
const {
  normalizeIndicatorText,
  compactLatinToken,
  buildAliasesForKey,
  getMatchableIndicatorConfigs,
  getRatioIndicatorConfigs,
  getAllIndicatorKeys,
  resolveMethylcitricVariantFromName,
  resolveRatioIndicatorKey,
  resolveLegacyIndicatorKey,
  resolveTrackedCarnitineFromName,
  isValidChineseAliasBoundary,
  isRatioLikeIndicatorText,
  isRatioNoiseLine,
  shouldParseRatioIndicator,
  isCarnitineAbbrevInsideRatio,
  isBareCarnitineAbbrev
} = require('./reportIndicatorLexicon');

function normalizeText(text) {
  return normalizeIndicatorText(text);
}

function isLatinAlias(alias) {
  return /^[a-z0-9(),./-]+$/.test(alias);
}

// 手写边界判断而不是正则 lookbehind：部分小程序运行环境（尤其是较旧的 iOS JSCore）
// 对 (?<!...) 支持不完整，这里用手动字符检查规避兼容性风险。
function findAliasMatch(normalizedLine, alias) {
  if (!alias) return null;

  if (isRatioLikeIndicatorText(normalizedLine) && !alias.includes('/') && !alias.includes('比')) {
    if (isLatinAlias(alias) && isBareCarnitineAbbrev(alias)) {
      return null;
    }
    if (!isLatinAlias(alias) && alias.length <= 6 && /^(c0|c2|c3)$/i.test(alias)) {
      return null;
    }
  }

  if (isLatinAlias(alias)) {
    const flexiblePattern = alias
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/[\s/_-]+/g, '[\\s/_-]*');
    const regex = new RegExp(flexiblePattern, 'gi');
    let match = regex.exec(normalizedLine);
    while (match) {
      const before = normalizedLine[match.index - 1];
      const after = normalizedLine[match.index + match[0].length];
      const beforeOk = !before || !/[a-z0-9]/i.test(before);
      const afterOk = !after || !/[a-z0-9]/i.test(after);
      const ratioGuardOk = !isBareCarnitineAbbrev(alias)
        || !isCarnitineAbbrevInsideRatio(normalizedLine, match.index, match[0].length);
      if (beforeOk && afterOk && ratioGuardOk) {
        return { index: match.index, length: match[0].length };
      }
      match = regex.exec(normalizedLine);
    }
    return null;
  }

  const index = normalizedLine.indexOf(alias);
  if (index < 0) return null;
  if (!isValidChineseAliasBoundary(normalizedLine, index, alias)) {
    return null;
  }
  return { index, length: alias.length };
}

function resolveStructuredItemName(item = {}) {
  return `${item.name
    || item.label
    || item.indicatorName
    || item.indicator_name
    || item.displayName
    || item.display_name
    || item.metricName
    || item.metric_name
    || item.text
    || ''}`.trim();
}

function resolveStructuredIndicatorKey(item = {}, reportType = '') {
  const itemName = resolveStructuredItemName(item);
  const rawKey = `${item.indicatorKey
    || item.indicator_key
    || item.key
    || item.code
    || item.metricKey
    || item.metric_key
    || ''}`.trim();
  const indicatorConfigs = getMatchableIndicatorConfigs(reportType);
  const matchableKeys = new Set(indicatorConfigs.map((config) => config.key));
  const allValidKeys = getAllIndicatorKeys(reportType);

  const ratioKey = resolveRatioIndicatorKey(rawKey, itemName);
  if (ratioKey && allValidKeys.has(ratioKey)) {
    return ratioKey;
  }

  const methylVariant = resolveMethylcitricVariantFromName(itemName);
  if (methylVariant && matchableKeys.has(methylVariant)) {
    return methylVariant;
  }

  if (isRatioLikeIndicatorText(itemName) || isRatioLikeIndicatorText(rawKey)) {
    return '';
  }

  const carnitineFromName = resolveTrackedCarnitineFromName(itemName, matchableKeys);
  if (carnitineFromName.blocked) {
    return '';
  }
  if (carnitineFromName.key) {
    return carnitineFromName.key;
  }

  if (!rawKey) return '';

  const normalizedKey = compactLatinToken(rawKey)
    .replace(/[/.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  if (allValidKeys.has(normalizedKey)) {
    if (matchableKeys.has(normalizedKey)) {
      if (isBareCarnitineAbbrev(normalizedKey) && isRatioLikeIndicatorText(itemName)) {
        return '';
      }
      return normalizedKey;
    }
    return normalizedKey;
  }

  const legacyKey = resolveLegacyIndicatorKey(rawKey, matchableKeys, itemName);
  if (legacyKey) {
    return legacyKey;
  }

  const normalizedRaw = normalizeIndicatorText(rawKey);
  if (isRatioLikeIndicatorText(normalizedRaw)) {
    return '';
  }
  for (const config of indicatorConfigs) {
    if (normalizeIndicatorText(config.key) === normalizedRaw) {
      return config.key;
    }
    if (config.aliases.some((alias) => alias === normalizedRaw || compactLatinToken(alias) === compactLatinToken(rawKey))) {
      return config.key;
    }
  }

  return '';
}

function buildStructuredItemRanges(item = {}) {
  const parsedFromRef = parseRefRange(item.refRange || item.ref_range || '');
  const minRange = `${item.minRange ?? ''}`.trim();
  const maxRange = `${item.maxRange ?? ''}`.trim();

  if (minRange && maxRange) {
    return { minRange, maxRange };
  }

  return {
    minRange: minRange || parsedFromRef.minRange,
    maxRange: maxRange || parsedFromRef.maxRange
  };
}

function assignStructuredIndicatorResult(result, matchedKeys, key, item, value, name) {
  if (!key || matchedKeys.has(key)) return false;

  const ranges = buildStructuredItemRanges(item);
  matchedKeys.add(key);
  result[key] = {
    value,
    minRange: ranges.minRange,
    maxRange: ranges.maxRange,
    sourceText: name || resolveStructuredItemName(item),
    flag: item.flag || null,
    confidence: item.confidence ?? null
  };
  return true;
}

function normalizeOcrItems(items = []) {
  return (items || []).map((item) => {
    const pos = item?.pos || {};
    return {
      ...item,
      text: typeof item?.text === 'string' ? item.text : `${item?.text || ''}`,
      pos: {
        top: Number(pos.top ?? pos.y ?? 0),
        left: Number(pos.left ?? pos.x ?? 0),
        width: Number(pos.width ?? pos.w ?? 0),
        height: Number(pos.height ?? pos.h ?? 20) || 20
      }
    };
  });
}

function groupOcrItemsIntoLines(items = []) {
  const validItems = normalizeOcrItems(items)
    .filter((item) => item && typeof item.text === 'string' && item.text.trim())
    .map((item) => ({
      text: item.text.trim(),
      top: Number(item.pos?.top) || 0,
      left: Number(item.pos?.left) || 0,
      height: Number(item.pos?.height) || 20
    }))
    .sort((a, b) => (a.top - b.top) || (a.left - b.left));

  const lines = [];
  validItems.forEach((item) => {
    const lastLine = lines[lines.length - 1];
    const threshold = Math.max(item.height, lastLine ? lastLine.height : 0) * 0.6;
    if (lastLine && Math.abs(item.top - lastLine.top) <= threshold) {
      lastLine.items.push(item);
      lastLine.height = Math.max(lastLine.height, item.height);
    } else {
      lines.push({ top: item.top, height: item.height, items: [item] });
    }
  });

  return lines.map((line) => ({
    text: [...line.items].sort((a, b) => a.left - b.left).map((i) => i.text).join(' ')
  }));
}

const SIGNED_NUMBER_PATTERN = '(\\(-?\\d+(?:\\.\\d+)?\\)|-?\\d+(?:\\.\\d+)?)';
const RANGE_PATTERN = new RegExp(`${SIGNED_NUMBER_PATTERN}\\s*[-~]\\s*${SIGNED_NUMBER_PATTERN}`);
const NUMBER_PATTERN = /-?\d+(?:\.\d+)?/;

function normalizeSignedNumberToken(token = '') {
  const trimmed = `${token || ''}`.trim();
  const parenMatch = trimmed.match(/^\((-?\d+(?:\.\d+)?)\)$/);
  return parenMatch ? parenMatch[1] : trimmed;
}

function parseSignedRange(text = '') {
  const match = String(text || '').match(RANGE_PATTERN);
  if (!match) return null;

  return {
    minRange: normalizeSignedNumberToken(match[1]),
    maxRange: normalizeSignedNumberToken(match[2]),
    index: match.index,
    length: match[0].length
  };
}

function parseNumbersFromLine(rawText = '') {
  const text = String(rawText || '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[～]/g, '~')
    .replace(/~/g, '-')
    .replace(/[，,]/g, ' ');

  const rangeMatch = parseSignedRange(text);
  let minRange = '';
  let maxRange = '';
  let remaining = text;

  if (rangeMatch) {
    minRange = rangeMatch.minRange;
    maxRange = rangeMatch.maxRange;
    remaining = text.slice(0, rangeMatch.index) + text.slice(rangeMatch.index + rangeMatch.length);
  }

  const valueMatch = remaining.match(NUMBER_PATTERN);
  if (!valueMatch) {
    return null;
  }

  return {
    value: valueMatch[0],
    minRange,
    maxRange
  };
}

// 报告里指标常写成"中文名(英文缩写)"，比如"丙酰基肉碱(C3)"。别名命中中文名部分之后，
// 紧跟着的括号缩写本身可能带数字（如 C3、C0），如果不跳过会被误当成检测值，这里把它一并吃掉。
function extendPastTrailingAnnotation(normalizedLine, endIndex) {
  const trailingMatch = normalizedLine.slice(endIndex).match(/^\s*\([^)]*\)/);
  return trailingMatch ? endIndex + trailingMatch[0].length : endIndex;
}

function matchIndicatorLine(lineText, indicatorConfigs = [], excludeKeys = new Set()) {
  const normalizedLine = normalizeIndicatorText(lineText);
  let bestMatch = null;

  indicatorConfigs.forEach((config) => {
    if (excludeKeys.has(config.key)) return;

    config.aliases.forEach((alias) => {
      const match = findAliasMatch(normalizedLine, alias);
      if (!match) return;

      const candidate = {
        key: config.key,
        alias,
        aliasLength: alias.length,
        matchEndIndex: extendPastTrailingAnnotation(normalizedLine, match.index + match.length)
      };

      if (!bestMatch
        || candidate.aliasLength > bestMatch.aliasLength
        || (candidate.aliasLength === bestMatch.aliasLength && candidate.matchEndIndex > bestMatch.matchEndIndex)) {
        bestMatch = candidate;
      }
    });
  });

  if (!bestMatch) return null;

  return { key: bestMatch.key, matchEndIndex: bestMatch.matchEndIndex };
}

function parseReportOcrResult({ items = [], reportType = '' } = {}) {
  const normalizedItems = normalizeOcrItems(items);
  if (!reportType || !Array.isArray(normalizedItems) || normalizedItems.length === 0) {
    return {};
  }

  const indicatorConfigs = getMatchableIndicatorConfigs(reportType);
  const ratioConfigs = getRatioIndicatorConfigs(reportType);
  if (indicatorConfigs.length === 0 && ratioConfigs.length === 0) {
    return {};
  }

  const lines = groupOcrItemsIntoLines(normalizedItems);
  const matchedKeys = new Set();
  const result = {};

  lines.forEach((line) => {
    let match = matchIndicatorLine(line.text, indicatorConfigs, matchedKeys);
    if (!match && shouldParseRatioIndicator(line.text)) {
      match = matchIndicatorLine(line.text, ratioConfigs, matchedKeys);
    }
    if (!match) return;

    const remainderText = line.text.slice(match.matchEndIndex);
    const numbers = parseNumbersFromLine(remainderText);
    if (!numbers) return;

    matchedKeys.add(match.key);
    result[match.key] = {
      value: numbers.value,
      minRange: numbers.minRange,
      maxRange: numbers.maxRange,
      sourceText: line.text
    };
  });

  return result;
}

function parseRefRange(refRange = '') {
  const text = `${refRange || ''}`.trim();
  if (!text) {
    return { minRange: '', maxRange: '' };
  }

  const rangeMatch = parseSignedRange(text.replace(/[～~–—]/g, '-'));
  if (rangeMatch) {
    return { minRange: rangeMatch.minRange, maxRange: rangeMatch.maxRange };
  }

  return { minRange: '', maxRange: '' };
}

// Mac mini OCR format-report 已返回结构化指标，优先用 indicator_key，其次按名称/缩写映射。
function parseStructuredReportItems({ structuredItems = [], reportType = '' } = {}) {
  if (!reportType || !Array.isArray(structuredItems) || structuredItems.length === 0) {
    return {};
  }

  const indicatorConfigs = getMatchableIndicatorConfigs(reportType);
  const ratioConfigs = getRatioIndicatorConfigs(reportType);
  if (indicatorConfigs.length === 0 && ratioConfigs.length === 0) {
    return {};
  }

  const matchedKeys = new Set();
  const result = {};

  structuredItems.forEach((item) => {
    const value = `${item?.value ?? ''}`.trim();
    if (!value) return;

    const directKey = resolveStructuredIndicatorKey(item, reportType);
    if (directKey) {
      const assigned = assignStructuredIndicatorResult(
        result,
        matchedKeys,
        directKey,
        item,
        value,
        resolveStructuredItemName(item) || directKey
      );
      if (assigned) return;
    }

    const name = resolveStructuredItemName(item);
    if (!name) return;

    let match = matchIndicatorLine(name, indicatorConfigs, matchedKeys);
    if (!match && shouldParseRatioIndicator(name)) {
      match = matchIndicatorLine(name, ratioConfigs, matchedKeys);
    }
    if (!match) {
      const syntheticLine = `${name} ${value} ${item.refRange || item.ref_range || ''}`.trim();
      match = matchIndicatorLine(syntheticLine, indicatorConfigs, matchedKeys);
      if (!match && shouldParseRatioIndicator(syntheticLine)) {
        match = matchIndicatorLine(syntheticLine, ratioConfigs, matchedKeys);
      }
    }
    if (!match) return;

    assignStructuredIndicatorResult(result, matchedKeys, match.key, item, value, name);
  });

  return result;
}

module.exports = {
  normalizeOcrItems,
  groupOcrItemsIntoLines,
  parseNumbersFromLine,
  parseRefRange,
  parseReportOcrResult,
  parseStructuredReportItems,
  resolveStructuredItemName,
  resolveStructuredIndicatorKey,
  buildAliasesForKey
};
