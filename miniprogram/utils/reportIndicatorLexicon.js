/**
 * 报告指标词典：集中维护 OCR/报告别名、常见错字、拉丁缩写变体。
 * 解析时优先最长匹配，避免「3-羟基丁酸」误吸「3,4-二羟基丁酸」「3-羟基丁酸-2」。
 */
const ReportModel = require('../models/report');

const CHINESE_TYPO_REPLACEMENTS = [
  ['枸缘酸', '枸橼酸'],
  ['甲基枸缘酸', '甲基枸橼酸']
];

const EXTRA_ALIASES = {
  iso_leu: ['iso/leu', 'ile/leu', '异亮氨酸/亮氨酸', '异亮氨酸', '亮氨酸'],
  met: ['met', '蛋氨酸', '甲硫氨酸', '蛋氨酸/甲硫氨酸'],
  val: ['val', 'va1', '缬氨酸'],
  thr: ['thr', '苏氨酸'],
  arginine: ['精氨酸', 'arginine', 'arg'],
  c0: ['游离肉碱(c0)', '游离肉碱'],
  c2: ['乙酰基肉碱(c2)', '酰基肉碱(c2)', '乙酰基肉碱', '乙酰肉碱'],
  c3: ['丙酰基肉碱(c3)', '丙酰肉碱(c3)', '丙酰基肉碱', '丙酰肉碱'],
  methylmalonic_acid: ['mma', '甲基丙二酸'],
  hydroxypropionic_acid: ['3-hpa', '3hpa', '3-羟基丙酸'],
  hydroxybutyric_acid: [
    '3-hba', '3hba',
    '3-羟基丁酸-2', '3-羟基丁酸(2)', '3-羟基丁酸2', '3-羟基丁酸 2', '3羟基丁酸-2',
    '3-羟基丁酸'
  ],
  methylcitric_acid_1: [
    'mca(1)', 'mca1', '甲基枸橼酸(1)', '甲基枸橼酸1', '甲基枸橼酸-1',
    '甲基枸橼酸', 'mca'
  ],
  methylcitric_acid_2: [
    'mca(2)', 'mca2', '甲基枸橼酸(2)', '甲基枸橼酸2', '甲基枸橼酸-2'
  ],
  lactate: ['lac', '乳酸'],
  hgb: ['hgb', 'hb', 'hemoglobin', '血红蛋白'],
  plt: ['plt', 'platelet', '血小板', '血小板计数'],
  wbc: ['wbc', '白细胞', '白细胞计数'],
  crp: ['crp', 'c反应蛋白', '超敏crp', 'hs-crp', 'hscrp'],
  neut_abs: ['neut#', 'neut abs', 'neut_abs', 'neut', '中性粒细胞绝对值', '中性粒细胞数目', '中性粒细胞数'],
  neut_pct: ['neut%', 'neut pct', 'neut_pct', '中性粒细胞%', '中性粒细胞百分比', '中性粒细胞比例'],
  mono_pct: ['mono%', 'mono pct', 'mono_pct', '单核细胞%', '单核细胞百分比', '单核细胞比例'],
  mono_abs: ['mono#', 'mono abs', 'mono_abs', '单核细胞绝对值', '单核细胞数目', '单核细胞数'],
  lym_pct: ['lym%', 'lym pct', 'lym_pct', '淋巴细胞%', '淋巴细胞百分比', '淋巴细胞比例'],
  lym_abs: ['lym#', 'lym abs', 'lym_abs', '淋巴细胞绝对值', '淋巴细胞数目', '淋巴细胞数'],
  eos_pct: ['eos%', 'eos pct', 'eos_pct', '嗜酸粒细胞%', '嗜酸性粒细胞%', '嗜酸粒细胞百分比', '嗜酸性粒细胞百分比'],
  eos_abs: ['eos#', 'eos abs', 'eos_abs', '嗜酸粒细胞绝对值', '嗜酸性粒细胞绝对值', '嗜酸粒细胞数目'],
  baso_pct: ['baso%', 'baso pct', 'baso_pct', '嗜碱粒细胞%', '嗜碱性粒细胞%', '嗜碱粒细胞百分比', '嗜碱性粒细胞百分比'],
  baso_abs: ['baso#', 'baso abs', 'baso_abs', '嗜碱粒细胞绝对值', '嗜碱性粒细胞绝对值', '嗜碱粒细胞数目'],
  rbc: ['rbc', '红细胞', '红细胞计数'],
  hct: ['hct', '红细胞压积', 'hematocrit'],
  mcv: ['mcv', '平均红细胞体积'],
  mch: ['mch', '平均血红蛋白量', '平均红细胞血红蛋白含量'],
  mchc: ['mchc', '平均血红蛋白浓度', '平均红细胞血红蛋白浓度'],
  rdw_cv: ['rdw-cv', 'rdw cv', 'rdw_cv', '红细胞分布宽度cv', '红细胞分布宽度(cv)'],
  rdw_sd: ['rdw-sd', 'rdw sd', 'rdw_sd', '红细胞分布宽度sd', '红细胞分布宽度(sd)'],
  mpv: ['mpv', '平均血小板体积'],
  pct: ['pct', '血小板压积'],
  pdw: ['pdw', '血小板分布宽度'],
  glucose: ['glu', '葡萄糖', '血糖'],
  sodium: ['na+', 'na', '钠'],
  potassium: ['k+', 'k', '钾'],
  chloride: ['cl-', 'cl', '氯'],
  calcium: ['ca++', 'ca', '离子钙', '钙'],
  beecf: ['beecf', 'be(ecf)', 'be-ecf'],
  cthb: ['cthb', 'thb', '总血红蛋白'],
  ph: ['ph值', 'ph', '酸碱度'],
  pco2: ['pco2', 'p co2', 'p-co2', '二氧化碳分压', 'co2分压', 'partial pressure of co2'],
  po2: ['po2', 'p o2', 'p-o2', '氧分压', 'partial pressure of o2'],
  hco3: ['hco3-', 'hco3', 'hco3std', 'hco3 std', 'hco3-std', '碳酸氢根', '碳酸氢盐', '标准碳酸氢盐'],
  be: ['be(b)', 'be (b)', 'be', '剩余碱', '碱剩余', '碱剩余(base excess)'],
  ammonia: ['nh3', '血氨']
};

const RATIO_INDICATOR_ALIASES = {
  c3_c0: ['c3/c0', 'c3 / c0'],
  c3_c2: ['c3/c2', 'c3 / c2']
};

const LEGACY_INDICATOR_KEY_ALIASES = {
  methylcitric_acid: 'methylcitric_acid_1',
  methylcitric: 'methylcitric_acid_1',
  mca: 'methylcitric_acid_1',
  mca1: 'methylcitric_acid_1',
  mca_1: 'methylcitric_acid_1',
  mca2: 'methylcitric_acid_2',
  mca_2: 'methylcitric_acid_2',
  mma: 'methylmalonic_acid',
  '3-hpa': 'hydroxypropionic_acid',
  '3hpa': 'hydroxypropionic_acid',
  '3-hba': 'hydroxybutyric_acid',
  '3hba': 'hydroxybutyric_acid',
  '3-hba-2': 'hydroxybutyric_acid',
  '3hba2': 'hydroxybutyric_acid',
  nh3: 'ammonia',
  lac: 'lactate',
  hb: 'hgb',
  hgb: 'hgb',
  hemoglobin: 'hgb',
  plt: 'plt',
  platelet: 'plt',
  wbc: 'wbc',
  neut: 'neut_abs',
  'neut#': 'neut_abs',
  neut_abs: 'neut_abs',
  'neut%': 'neut_pct',
  neut_pct: 'neut_pct',
  lym: 'lym_pct',
  'lym%': 'lym_pct',
  lym_pct: 'lym_pct',
  'lym#': 'lym_abs',
  lym_abs: 'lym_abs',
  'mono%': 'mono_pct',
  mono_pct: 'mono_pct',
  'mono#': 'mono_abs',
  mono_abs: 'mono_abs',
  'eos%': 'eos_pct',
  eos_pct: 'eos_pct',
  'eos#': 'eos_abs',
  eos_abs: 'eos_abs',
  'baso%': 'baso_pct',
  baso_pct: 'baso_pct',
  'baso#': 'baso_abs',
  baso_abs: 'baso_abs',
  crp: 'crp',
  'hs-crp': 'crp',
  hscrp: 'crp',
  rbc: 'rbc',
  mch: 'mch',
  mchc: 'mchc',
  'rdw-cv': 'rdw_cv',
  rdw_cv: 'rdw_cv',
  'rdw-sd': 'rdw_sd',
  rdw_sd: 'rdw_sd',
  mpv: 'mpv',
  pct: 'pct',
  pdw: 'pdw',
  mcv: 'mcv',
  hct: 'hct',
  glu: 'glucose',
  na: 'sodium',
  'na+': 'sodium',
  k: 'potassium',
  'k+': 'potassium',
  cl: 'chloride',
  'cl-': 'chloride',
  ca: 'calcium',
  'ca++': 'calcium',
  beecf: 'beecf',
  cthb: 'cthb',
  thb: 'cthb',
  ile_leu: 'iso_leu',
  'ile/leu': 'iso_leu',
  'iso/leu': 'iso_leu',
  va1: 'val',
  hco3std: 'hco3',
  hco3_std: 'hco3',
  arg: 'arginine'
};

const CARNITINE_ABBREVS = new Set(['c0', 'c2', 'c3']);
const TRACKED_CARNITINE_CODES = {
  c0: 'c0',
  c2: 'c2',
  c3: 'c3'
};

function isRatioLikeIndicatorText(text = '') {
  const normalized = normalizeIndicatorText(text);
  if (!normalized) return false;
  if (/c\d+\s*\/\s*c\d+/.test(normalized)) return true;
  if (/c\d+\s*\/\s*\(/.test(normalized)) return true;
  if (/比\s*值/.test(normalized) && /c\d+/.test(normalized)) return true;
  return false;
}

function isRatioNoiseLine(text = '') {
  const normalized = normalizeIndicatorText(text);
  return /备注|自动计算|无需识别|仅供参考|比值备注/.test(normalized);
}

function shouldParseRatioIndicator(text = '') {
  return isRatioLikeIndicatorText(text) && !isRatioNoiseLine(text);
}

function isCarnitineAbbrevInsideRatio(normalizedLine = '', matchIndex = 0, matchLength = 0) {
  const before = normalizedLine[matchIndex - 1];
  const after = normalizedLine[matchIndex + matchLength];
  if (before === '/' || after === '/') return true;

  const tail = normalizedLine.slice(matchIndex + matchLength).replace(/^\s+/, '');
  if (tail.startsWith('/')) return true;

  const head = normalizedLine.slice(0, matchIndex).replace(/\s+$/, '');
  if (head.endsWith('/')) return true;

  return false;
}

function isBareCarnitineAbbrev(alias = '') {
  return CARNITINE_ABBREVS.has(`${alias || ''}`.toLowerCase());
}

function extractParenCarnitineCode(name = '') {
  const match = normalizeIndicatorText(name).match(/\((c\d+)\)/);
  return match ? match[1] : '';
}

function resolveTrackedCarnitineFromName(name = '', validKeys = new Set()) {
  const code = extractParenCarnitineCode(name);
  if (!code) {
    return { key: '', blocked: false };
  }
  const key = TRACKED_CARNITINE_CODES[code];
  if (key && validKeys.has(key)) {
    return { key, blocked: false };
  }
  return { key: '', blocked: true };
}

function isValidChineseAliasBoundary(normalizedLine = '', matchIndex = 0, alias = '') {
  if (matchIndex <= 0) {
    return true;
  }

  const before = normalizedLine[matchIndex - 1];

  if (alias === '酰基肉碱' || (alias.includes('酰基肉碱') && !alias.startsWith('乙酰'))) {
    return before === '乙';
  }

  if (alias.startsWith('丙酰') || alias.startsWith('游')) {
    return false;
  }

  if (alias.endsWith('酰基肉碱') && !alias.startsWith('乙酰') && !alias.startsWith('丙') && !alias.startsWith('游')) {
    if (/[烷烃丙丁戊己庚辛壬癸碳\d]/.test(before)) {
      return false;
    }
  }

  if (alias === '游离肉碱' && before === '非') {
    return false;
  }

  return true;
}

function normalizeIndicatorText(text) {
  let normalized = String(text || '');
  CHINESE_TYPO_REPLACEMENTS.forEach(([from, to]) => {
    normalized = normalized.split(from).join(to);
  });
  return normalized
    .toLowerCase()
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[，,]/g, ',')
    .replace(/[·•]/g, '')
    .replace(/[\u2080-\u209f]/g, (char) => {
      const subscripts = '₀₁₂₃₄₅₆₇₈₉';
      const index = subscripts.indexOf(char);
      return index >= 0 ? String(index) : char;
    })
    .trim();
}

function compactLatinToken(text = '') {
  return normalizeIndicatorText(text).replace(/[\s/_-]+/g, '');
}

function buildRatioAliasesForKey(config = {}) {
  const aliases = new Set(RATIO_INDICATOR_ALIASES[config.key] || []);
  if (config.name) aliases.add(normalizeIndicatorText(config.name));
  if (config.abbr) {
    aliases.add(normalizeIndicatorText(config.abbr));
    aliases.add(compactLatinToken(config.abbr));
  }
  return Array.from(aliases)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function getRatioIndicatorConfigs(reportType) {
  return ReportModel.getIndicators(reportType)
    .filter((config) => config.isRatio && config.allowRangeInput)
    .map((config) => ({ key: config.key, aliases: buildRatioAliasesForKey(config) }));
}

function getAllIndicatorKeys(reportType) {
  return new Set(ReportModel.getIndicators(reportType).map((config) => config.key));
}

function resolveRatioIndicatorKey(rawKey = '', itemName = '') {
  if (isRatioNoiseLine(rawKey) || isRatioNoiseLine(itemName)) {
    return '';
  }

  const keyText = normalizeIndicatorText(rawKey);
  const nameText = normalizeIndicatorText(itemName);
  const combined = `${keyText} ${nameText}`.trim();

  if (/c3\s*\/\s*c2/.test(combined)) {
    return 'c3_c2';
  }
  if (/c3\s*\/\s*c0/.test(combined)) {
    return 'c3_c0';
  }

  const compactKey = compactLatinToken(rawKey).replace(/[/.]+/g, '_');
  if (compactKey === 'c3_c0' || compactKey === 'c3c0') return 'c3_c0';
  if (compactKey === 'c3_c2' || compactKey === 'c3c2') return 'c3_c2';

  return '';
}

function buildAliasesForKey(config = {}) {
  const aliases = new Set(EXTRA_ALIASES[config.key] || []);
  if (config.name) aliases.add(normalizeIndicatorText(config.name));
  if (config.abbr) {
    aliases.add(normalizeIndicatorText(config.abbr));
    aliases.add(compactLatinToken(config.abbr));
  }
  return Array.from(aliases)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function getMatchableIndicatorConfigs(reportType) {
  return ReportModel.getIndicators(reportType)
    .filter((config) => !config.isRatio)
    .map((config) => ({ key: config.key, aliases: buildAliasesForKey(config) }));
}

function resolveMethylcitricVariantFromName(name = '') {
  const normalized = normalizeIndicatorText(name);
  if (!normalized.includes('甲基枸橼酸') && !normalized.includes('mca')) {
    return '';
  }
  if (/\(2\)|（2）|甲基枸橼酸2|甲基枸橼酸-2|mca\(2\)|(?:^|[^0-9])mca2(?:$|[^0-9])|mca_2/.test(normalized)) {
    return 'methylcitric_acid_2';
  }
  if (/\(1\)|（1）|甲基枸橼酸1|甲基枸橼酸-1|mca\(1\)|(?:^|[^0-9])mca1(?:$|[^0-9])|mca_1/.test(normalized)) {
    return 'methylcitric_acid_1';
  }
  return '';
}

function resolveLegacyIndicatorKey(rawKey, validKeys, itemName = '') {
  const methylVariant = resolveMethylcitricVariantFromName(itemName);
  if (methylVariant && validKeys.has(methylVariant)) {
    return methylVariant;
  }

  const normalizedKey = compactLatinToken(rawKey).replace(/[/.]+/g, '_');
  const legacyKey = LEGACY_INDICATOR_KEY_ALIASES[normalizedKey]
    || LEGACY_INDICATOR_KEY_ALIASES[normalizeIndicatorText(rawKey).replace(/\s+/g, '')];
  if (!legacyKey || !validKeys.has(legacyKey)) {
    return '';
  }

  if (legacyKey === 'methylcitric_acid_1' && resolveMethylcitricVariantFromName(itemName) === 'methylcitric_acid_2') {
    return 'methylcitric_acid_2';
  }

  return legacyKey;
}

module.exports = {
  CHINESE_TYPO_REPLACEMENTS,
  EXTRA_ALIASES,
  LEGACY_INDICATOR_KEY_ALIASES,
  normalizeIndicatorText,
  compactLatinToken,
  buildAliasesForKey,
  getMatchableIndicatorConfigs,
  getRatioIndicatorConfigs,
  getAllIndicatorKeys,
  buildRatioAliasesForKey,
  resolveMethylcitricVariantFromName,
  resolveRatioIndicatorKey,
  resolveLegacyIndicatorKey,
  resolveTrackedCarnitineFromName,
  extractParenCarnitineCode,
  isValidChineseAliasBoundary,
  isRatioLikeIndicatorText,
  isRatioNoiseLine,
  shouldParseRatioIndicator,
  isCarnitineAbbrevInsideRatio,
  isBareCarnitineAbbrev,
  CARNITINE_ABBREVS
};
