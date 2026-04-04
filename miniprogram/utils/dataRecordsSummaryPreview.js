function normalizeValue(value, fallback = '0') {
if (value === undefined || value === null || value === '') {
return fallback;
}
return String(value);
}
function toNumber(value) {
return Number(value || 0);
}
function formatTwoDecimals(value) {
return normalizeValue(Number(toNumber(value).toFixed(2)).toFixed(2));
}
function buildRangeValue(range) {
if (!range || range.min === undefined || range.max === undefined) {
return '--';
}
return `${range.min}~${range.max} kcal/kg`;
}
function buildDailyRangeValue(range) {
if (!range || range.min === undefined || range.max === undefined) {
return '--';
}
return `${range.min}~${range.max} kcal/kg/d`;
}
function getFoodProtein(overview = {}) {
if (overview.protein !== undefined && overview.protein !== null) {
return overview.protein;
}
return (overview.naturalProtein || 0) + (overview.specialProtein || 0);
}
function createMetric(label, value, unit) {
return {
label,
value: normalizeValue(value, value === '' ? '--' : '0'),
unit
};
}
function buildSourceBreakdownLine(parts = []) {
return parts.map(({ label, value }) => `${label} ${normalizeValue(value)}`).join(' · ');
}
function buildProteinBreakdownLine(parts = []) {
return parts.map(({ label, value }) => `${label} ${formatTwoDecimals(value)}g`).join(' · ');
}
function buildStatValue(value, unit) {
return `${normalizeValue(value)} ${unit}`;
}
function buildCoefficientValue(value) {
return value !== undefined && value !== null && value !== ''
? `${value} g/kg/d`
: '— g/kg/d';
}
function buildCoefficientParts(value) {
return {
value: value !== undefined && value !== null && value !== '' ? String(value) : '--',
unit: 'g/kg/d'
};
}
function buildNonZeroStats(stats = []) {
return stats.filter((stat) => {
if (!stat) return false;
const rawValue = String(stat.value || '').trim();
if (!rawValue) return false;
const numeric = Number(rawValue.split(' ')[0]);
return Number.isNaN(numeric) ? true : numeric !== 0;
});
}
function buildDataRecordsSummaryPreview(input = {}) {
const intakeOverview = input.intakeOverview || {};
const milkOverview = intakeOverview.milk || {};
const normalMilk = milkOverview.normal || {};
const specialMilk = milkOverview.special || {};
const foodOverview = intakeOverview.food || {};
const treatmentOverview = intakeOverview.treatment || {};
const macroRatios = input.macroRatios || {};
const goalRangeValue = buildRangeValue(input.calorieGoalPerKgRange);
const goalRangeDailyValue = buildDailyRangeValue(input.calorieGoalPerKgRange);
const totalMilkVolume = toNumber(normalMilk.volume) + toNumber(specialMilk.volume);
const totalMilkCalories = toNumber(normalMilk.calories) + toNumber(specialMilk.calories);
const foodFat = toNumber(foodOverview.fat);
const treatmentFat = toNumber(treatmentOverview.fat);
const normalMilkLabel = input.naturalMilkType === 'breast' ? '母' : '普';
const normalMilkColumnLabel = input.naturalMilkType === 'breast' ? '母乳' : '普奶';
const naturalProteinTotal = toNumber(input.proteinSummaryDisplay?.natural);
const specialProteinTotal = toNumber(input.proteinSummaryDisplay?.special);
const naturalMilkProtein = Math.min(naturalProteinTotal, toNumber(normalMilk.protein));
const naturalFoodProtein = foodOverview.naturalProtein !== undefined
? toNumber(foodOverview.naturalProtein)
: Math.max(naturalProteinTotal - naturalMilkProtein, 0);
const specialFoodProtein = foodOverview.specialProtein !== undefined
? toNumber(foodOverview.specialProtein)
: 0;
const specialMilkProtein = Math.max(specialProteinTotal - specialFoodProtein, 0);
return {
displayDate: normalizeValue(input.formattedSelectedDate, '--'),
heroBadges: [
{ label: '体重', value: normalizeValue(input.weight, '--'), unit: 'kg', field: 'weight' },
{ label: '身高', value: normalizeValue(input.height, '--'), unit: 'cm', field: 'height' }
],
topMetrics: [
{
...createMetric('总热量', input.dailyCaloriesTotal || 0, 'kcal'),
detail: buildSourceBreakdownLine([
{ label: '奶', value: totalMilkCalories },
{ label: '食物', value: foodOverview.totalCalories || 0 },
{ label: '治疗', value: treatmentOverview.totalCalories || 0 }
])
},
{
...createMetric('热卡系数', input.caloriePerKg === '' ? '--' : normalizeValue(input.caloriePerKg, '--'), 'kcal/kg/d'),
detail: `推荐：${goalRangeDailyValue}`,
infoTitle: '目标热卡系数',
infoLines: input.calorieGoalPerKgRange?.label ? [goalRangeValue, input.calorieGoalPerKgRange.label] : [goalRangeValue]
},
{
...createMetric('总蛋白', input.proteinSummaryDisplay?.total || 0, 'g'),
detail: buildProteinBreakdownLine([
{ label: '天然', value: input.proteinSummaryDisplay?.natural || 0 },
{ label: '特殊', value: input.proteinSummaryDisplay?.special || 0 }
])
},
{
...createMetric('总奶量', input.totalMilk || 0, 'ml'),
detail: `${normalMilkLabel}：${normalizeValue(normalMilk.volume || 0)}ml · 特：${normalizeValue(specialMilk.volume || 0)}ml`
}
],
nutritionStrip: [
{
label: '天然蛋白',
value: normalizeValue(input.proteinSummaryDisplay?.natural || 0),
unit: 'g',
source: buildProteinBreakdownLine([
{ label: '奶', value: naturalMilkProtein },
{ label: '食物', value: naturalFoodProtein }
]),
premiumRatio: input.proteinSummaryDisplay?.premiumRatio || 0,
premiumValue: normalizeValue(input.proteinSummaryDisplay?.premium || 0),
detailLabel: '天然蛋白系数',
detailValue: buildCoefficientParts(input.naturalProteinCoefficient).value,
detailUnit: buildCoefficientParts(input.naturalProteinCoefficient).unit,
detail: input.naturalProteinCoefficient ? `${input.naturalProteinCoefficient} g/kg/d` : '--'
},
{
label: '特殊蛋白',
value: normalizeValue(input.proteinSummaryDisplay?.special || 0),
unit: 'g',
source: buildProteinBreakdownLine([
{ label: '特奶', value: specialMilkProtein }
]),
detailLabel: '特殊蛋白系数',
detailValue: buildCoefficientParts(input.specialProteinCoefficient).value,
detailUnit: buildCoefficientParts(input.specialProteinCoefficient).unit,
detail: input.specialProteinCoefficient ? `${input.specialProteinCoefficient} g/kg/d` : '--'
}
],
sourceSections: [
{
label: '喂奶',
type: 'milk',
summaryText: `${normalMilkColumnLabel} ${normalizeValue(normalMilk.volume || 0)}ml ${normalizeValue(normalMilk.calories || 0)}kcal ${formatTwoDecimals(normalMilk.protein || 0)}g蛋白 · 特奶 ${normalizeValue(specialMilk.volume || 0)}ml ${normalizeValue(specialMilk.calories || 0)}kcal ${formatTwoDecimals(specialMilk.protein || 0)}g蛋白`,
columns: [
{
label: normalMilkColumnLabel,
stats: [
{ label: '体积', value: buildStatValue(normalMilk.volume || 0, 'ml') },
{ label: '热量', value: buildStatValue(normalMilk.calories || 0, 'kcal') },
{ label: '蛋白', value: buildStatValue(normalMilk.protein || 0, 'g') },
{ label: '蛋白系数', value: buildCoefficientValue(normalMilk.coefficient) },
{ label: '碳水', value: buildStatValue(normalMilk.carbs || 0, 'g') },
{ label: '脂肪', value: buildStatValue(normalMilk.fat || 0, 'g') }
]
},
{
label: '特奶',
stats: [
{ label: '体积', value: buildStatValue(specialMilk.volume || 0, 'ml') },
{ label: '热量', value: buildStatValue(specialMilk.calories || 0, 'kcal') },
{ label: '蛋白', value: buildStatValue(specialMilk.protein || 0, 'g') },
{ label: '蛋白系数', value: buildCoefficientValue(specialMilk.coefficient) },
{ label: '碳水', value: buildStatValue(specialMilk.carbs || 0, 'g') },
{ label: '脂肪', value: buildStatValue(specialMilk.fat || 0, 'g') }
]
}
]
},
{
label: '食物',
type: 'stats',
meta: `${normalizeValue(foodOverview.count || 0)}条记录`,
summaryText: `热量 ${normalizeValue(foodOverview.totalCalories || 0)} kcal · 蛋白 ${normalizeValue(getFoodProtein(foodOverview))} g`,
stats: buildNonZeroStats([
{ label: '热量', value: buildStatValue(foodOverview.totalCalories || 0, 'kcal') },
{ label: '蛋白', value: buildStatValue(getFoodProtein(foodOverview), 'g') },
{ label: '碳水', value: buildStatValue(foodOverview.carbs || 0, 'g') },
{ label: '脂肪', value: buildStatValue(foodFat, 'g') }
])
},
{
label: '治疗',
type: 'stats',
meta: `${normalizeValue(treatmentOverview.count || 0)}条记录`,
summaryText: `热量 ${normalizeValue(treatmentOverview.totalCalories || 0)} kcal · 碳水 ${normalizeValue(treatmentOverview.carbs || 0)} g`,
stats: buildNonZeroStats([
{ label: '热量', value: buildStatValue(treatmentOverview.totalCalories || 0, 'kcal') },
{ label: '蛋白', value: buildStatValue(treatmentOverview.protein || 0, 'g') },
{ label: '碳水', value: buildStatValue(treatmentOverview.carbs || 0, 'g') },
{ label: '脂肪', value: buildStatValue(treatmentFat, 'g') }
])
}
],
coefficientRows: [
{
label: '目标热卡系数',
value: goalRangeValue,
hint: normalizeValue(input.calorieGoalPerKgRange?.label, '')
},
{
label: '天然蛋白系数',
value: input.naturalProteinCoefficient ? `${input.naturalProteinCoefficient} g/kg/d` : '--'
},
{
label: '特殊蛋白系数',
value: input.specialProteinCoefficient ? `${input.specialProteinCoefficient} g/kg/d` : '--'
}
],
macroRows: [
{
label: '蛋白',
 value: `${normalizeValue(macroRatios.protein || 0)}%`,
 infoTitle: '蛋白供能占比参考',
 infoLines: ['参考 10%-15%']
},
{
label: '碳水',
 value: `${normalizeValue(macroRatios.carbs || 0)}%`,
 infoTitle: '碳水供能占比参考',
 infoLines: ['参考 55%-60%']
},
{
label: '脂肪',
 value: `${normalizeValue(macroRatios.fat || 0)}%`,
 infoTitle: '脂肪供能占比参考',
 infoLines: input.fatRatioPopupLines || []
}
]
};
}
module.exports = {
buildDataRecordsSummaryPreview
};
