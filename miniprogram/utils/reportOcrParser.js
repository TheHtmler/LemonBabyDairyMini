// 检测报告拍照识别解析器
// 输入微信云开发 cloud.openapi.ocr.printedText 返回的文本块（{ text, pos }），
// 输出可以直接合并进 add-report 表单的指标数据（{ [indicatorKey]: { value, minRange, maxRange, sourceText } }）。
// 全模块不依赖 wx 全局对象，保持纯函数，方便单测覆盖识别准确率相关的边界场景。
const ReportModel = require('../models/report');

// 比值指标（C3/C0、C3/C2）由录入页现有逻辑自动算出，识别阶段主动跳过，避免识别噪声覆盖准确的计算值。
const EXTRA_ALIASES = {
  iso_leu: ['iso/leu', 'ile/leu', '异亮氨酸', '亮氨酸'],
  met: ['met', '蛋氨酸', '甲硫氨酸'],
  val: ['val', '缬氨酸'],
  thr: ['thr', '苏氨酸'],
  c0: ['c0', '游离肉碱'],
  c2: ['c2', '乙酰基肉碱', '乙酰肉碱'],
  c3: ['c3', '丙酰基肉碱', '丙酰肉碱'],
  methylmalonic_acid: ['mma', '甲基丙二酸'],
  hydroxypropionic_acid: ['3-hpa', '3hpa', '羟基丙酸', '3-羟基丙酸'],
  hydroxybutyric_acid: ['3-hba', '3hba', '羟基丁酸', '3-羟基丁酸'],
  methylcitric_acid_1: ['mca(1)', 'mca1', '甲基枸橼酸(1)', '甲基枸橼酸1', '甲基枸橼酸-1'],
  methylcitric_acid_2: ['mca(2)', 'mca2', '甲基枸橼酸(2)', '甲基枸橼酸2', '甲基枸橼酸-2'],
  lactate: ['lac', '乳酸'],
  ph: ['ph值', 'ph'],
  pco2: ['pco2', '二氧化碳分压'],
  po2: ['po2', '氧分压'],
  hco3: ['hco3-', 'hco3', '碳酸氢根'],
  be: ['be', '剩余碱'],
  ammonia: ['nh3', '血氨']
};

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .trim();
}

function isLatinAlias(alias) {
  return /^[a-z0-9()/.\-]+$/.test(alias);
}

// 手写边界判断而不是正则 lookbehind：部分小程序运行环境（尤其是较旧的 iOS JSCore）
// 对 (?<!...) 支持不完整，这里用手动字符检查规避兼容性风险。
function findAliasMatch(normalizedLine, alias) {
  if (!alias) return null;

  if (isLatinAlias(alias)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    let match = regex.exec(normalizedLine);
    while (match) {
      const before = normalizedLine[match.index - 1];
      const after = normalizedLine[match.index + match[0].length];
      const beforeOk = !before || !/[a-z0-9]/i.test(before);
      const afterOk = !after || !/[a-z0-9]/i.test(after);
      if (beforeOk && afterOk) {
        return { index: match.index, length: match[0].length };
      }
      match = regex.exec(normalizedLine);
    }
    return null;
  }

  const index = normalizedLine.indexOf(alias);
  return index >= 0 ? { index, length: alias.length } : null;
}

function buildAliasesForKey(config = {}) {
  const aliases = new Set(EXTRA_ALIASES[config.key] || []);
  if (config.name) aliases.add(normalizeText(config.name));
  if (config.abbr) aliases.add(normalizeText(config.abbr));
  // 别名越长越具体，优先匹配，减少像 "c0" 这种短缩写抢先命中的概率。
  return Array.from(aliases).sort((a, b) => b.length - a.length);
}

function getMatchableIndicatorConfigs(reportType) {
  return ReportModel.getIndicators(reportType)
    .filter((config) => !config.isRatio)
    .map((config) => ({ key: config.key, aliases: buildAliasesForKey(config) }));
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

const RANGE_PATTERN = /(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)/;
const NUMBER_PATTERN = /-?\d+(?:\.\d+)?/;

function parseNumbersFromLine(rawText = '') {
  const text = String(rawText || '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[～]/g, '~')
    .replace(/~/g, '-')
    .replace(/[，,]/g, ' ');

  const rangeMatch = text.match(RANGE_PATTERN);
  let minRange = '';
  let maxRange = '';
  let remaining = text;

  if (rangeMatch) {
    minRange = rangeMatch[1];
    maxRange = rangeMatch[2];
    remaining = text.slice(0, rangeMatch.index) + text.slice(rangeMatch.index + rangeMatch[0].length);
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
  const normalizedLine = normalizeText(lineText);

  for (const config of indicatorConfigs) {
    if (excludeKeys.has(config.key)) continue;

    for (const alias of config.aliases) {
      const match = findAliasMatch(normalizedLine, alias);
      if (match) {
        const rawEndIndex = match.index + match.length;
        return { key: config.key, matchEndIndex: extendPastTrailingAnnotation(normalizedLine, rawEndIndex) };
      }
    }
  }

  return null;
}

function parseReportOcrResult({ items = [], reportType = '' } = {}) {
  const normalizedItems = normalizeOcrItems(items);
  if (!reportType || !Array.isArray(normalizedItems) || normalizedItems.length === 0) {
    return {};
  }

  const indicatorConfigs = getMatchableIndicatorConfigs(reportType);
  if (indicatorConfigs.length === 0) {
    return {};
  }

  const lines = groupOcrItemsIntoLines(normalizedItems);
  const matchedKeys = new Set();
  const result = {};

  lines.forEach((line) => {
    const match = matchIndicatorLine(line.text, indicatorConfigs, matchedKeys);
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

module.exports = {
  normalizeOcrItems,
  groupOcrItemsIntoLines,
  parseNumbersFromLine,
  parseReportOcrResult
};
