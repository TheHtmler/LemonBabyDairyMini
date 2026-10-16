const FIELD_NAMES = { calories: '热量', protein: '蛋白质', fat: '脂肪', carbs: '碳水', fiber: '膳食纤维', sodium: '钠' };
function displayNumber(value, unit = '') {
  return value === null || value === undefined || !Number.isFinite(value) ? '缺失' : String(Math.round(value * 10000) / 10000) + unit;
}
function isBlank(value) { return value == null || String(value).trim() === ''; }
module.exports = { FIELD_NAMES, displayNumber, isBlank };
