const { resolvePeriod, shiftDate } = require('./search-core/period');
const { parsePeriodPhrase } = require('./search-core/language');
const { normalizeSearchRequest } = require('./search-core/queryText');

const METRICS = [
  { expression: /天然蛋白(?:质)?(?:摄入)?系数/, key: 'naturalProteinCoefficient', label: '天然蛋白摄入系数', unit: 'g/kg/d' },
  { expression: /特殊蛋白(?:质)?(?:摄入)?系数/, key: 'specialProteinCoefficient', label: '特殊蛋白摄入系数', unit: 'g/kg/d' },
  { expression: /总蛋白(?:质)?(?:摄入)?系数/, key: 'totalProteinCoefficient', label: '总蛋白摄入系数', unit: 'g/kg/d' },
  { expression: /(?:热卡|热量|能量)(?:摄入)?系数/, key: 'calorieCoefficient', label: '热量摄入系数', unit: 'kcal/kg/d' }
];

function parseMetricQuery(query) {
  const text = normalizeSearchRequest(query);
  const metric = METRICS.find(item => item.expression.test(text));
  if (!metric || /目标|设置|医嘱|建议|应该|低于|高于|比较|平均|总和/.test(text)) return null;
  let rest = text.replace(metric.expression, '');
  let period = { kind: 'all' }; let latest = true;
  const temporal = parsePeriodPhrase(rest);
  if (temporal) { period = temporal.period; latest = false; rest = temporal.rest; }
  rest = rest.replace(/查询|搜索|查看|查找|看看|最近|最新|我的|宝宝|一下|请问|多少|情况|记录|的|是|了|[？?，,。]/g, '');
  if (rest) return null;
  return { key: metric.key, label: metric.label, unit: metric.unit, period, latest };
}

async function queryMetrics(service, babyUid, request) {
  const response = await service.metricDates({ babyUid, period: request.period, latest: request.latest });
  const { getDailyRecordV2 } = require('./dailyRecordV2Service');
  const { buildDailyNutritionMetricFromSummary } = require('./reportWorkbench');
  const rows = [];
  // 按日期逐个读取，避免为一个搜索同时打开大量当日明细查询。
  for (const date of response.dates || []) {
    const day = await getDailyRecordV2(babyUid, date, { readOnly: true });
    const summary = day.summary || {};
    const weight = Number((summary.basicInfo || {}).weight) || 0;
    const metric = buildDailyNutritionMetricFromSummary(summary, date, weight);
    const intakeCount = Number((summary.recordCounts || {}).food || 0) + Number((summary.recordCounts || {}).milk || 0);
    const value = metric && metric[request.key];
    const known = intakeCount > 0 && typeof value === 'number' && Number.isFinite(value);
    rows.push({ date, value: known ? value.toFixed(request.key === 'calorieCoefficient' ? 1 : 2) : '',
      known, weightText: weight > 0 ? weight + ' kg' : '',
      missingReason: known ? '' : weight <= 0 ? '缺少该日期可用的体重，无法计算' : '该日期缺少可计算的饮食明细',
      locator: { kind: 'day', babyUid, date } });
  }
  const period = response.effectivePeriod || resolvePeriod(request.period);
  return { label: request.label, unit: request.unit, latest: request.latest, rows,
    nextPeriod: response.nextPeriod || null,
    periodText: request.latest ? '最近一次饮食记录' : period.startDate && period.endDateExclusive ? period.startDate + ' 至 ' + shiftDate(period.endDateExclusive, -1) : '全部历史',
    note: '按各日实际摄入量与有效体重计算；今天的数值以当前已记录内容为准。' };
}

module.exports = { parseMetricQuery, queryMetrics };
