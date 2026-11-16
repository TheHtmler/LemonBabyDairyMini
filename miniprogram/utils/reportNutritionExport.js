const DailyRecordV2Service = require('./dailyRecordV2Service');
const { toDateKey } = require('./reportWorkbench');
const { resolveMultiNutritionWindows, buildMultiNutritionSummary } = require('./reportComparison');

/** 使用点击导出时捕获的报告列加载饮食，不依赖页面弹层或随后切换的报告。 */
async function loadReportNutritionSummary({ babyUid, columns, isCurrent = () => true }) {
  if (!babyUid) throw new Error('请先选择宝宝');
  const windows = resolveMultiNutritionWindows(columns);
  const groups = [];
  let nextIndex = 0;
  let stopped = false;
  const checkCurrent = () => {
    if (!isCurrent()) { stopped = true; throw new Error('导出已取消'); }
  };
  const worker = async () => {
    while (!stopped && nextIndex < windows.length) {
      checkCurrent();
      const range = windows[nextIndex++];
      try {
        const summaries = await DailyRecordV2Service.getDailySummariesForRange(
          babyUid, range.startDate, range.endDate,
          { rebuildMissing: true, rebuildStaleSchema: true, maxRebuildDays: 14, strictRebuild: true });
        checkCurrent();
        groups.push(summaries);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(3, windows.length) }, worker));
    checkCurrent();
  } catch (error) {
    if (!isCurrent()) throw new Error('导出已取消');
    console.warn('加载导出饮食汇总失败:', error);
    throw new Error('饮食汇总加载失败，请重试');
  }
  const unique = new Map();
  groups.flat().forEach(summary => {
    const date = toDateKey(summary?.date);
    if (date) unique.set(date, summary);
  });
  return buildMultiNutritionSummary(columns, Array.from(unique.values()));
}

module.exports = { loadReportNutritionSummary };
