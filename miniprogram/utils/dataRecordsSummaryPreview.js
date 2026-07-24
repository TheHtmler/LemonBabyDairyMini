const {
POWDER_CATEGORY_META,
buildCategoryBadgeStyle
} = require('./formulaPowderUtils');

function normalizeValue(value, fallback = '0') {
if (value === undefined || value === null || value === '') {
return fallback;
}
if (typeof value === 'number' && Number.isFinite(value)) {
return String(Number(value.toFixed(2)));
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
function buildCalorieGoalInfoLines(range, ageRangeLines = []) {
if (!Array.isArray(ageRangeLines) || ageRangeLines.length === 0) {
return range && range.label ? [`${range.label} ${buildDailyRangeValue(range)}`] : [buildDailyRangeValue(range)];
}
const currentLabel = range && range.label ? range.label : '';
return ageRangeLines.map((line) => (
currentLabel && line.indexOf(currentLabel) === 0 ? `▸ ${line}` : line
));
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
function buildCompactVolumeBreakdownLine(parts = []) {
return parts.map(({ label, value }) => `${label} ${roundDisplayInteger(value)}`).join(' · ');
}
function buildLiquidSummaryLine({ milk = 0, water = 0, other = 0 } = {}) {
const parts = [
{ label: '奶', value: milk },
{ label: '喝水', value: water }
];
if (toNumber(other) > 0) {
parts.push({ label: '其他', value: other });
}
return buildCompactVolumeBreakdownLine(parts);
}
function buildVolumeInfoLines(parts = []) {
return parts.map(({ label, value }) => `${label} ${roundDisplayInteger(value)}ml`);
}
function buildNormalMilkVolumeInfoParts(feedings = [], normalMilk = {}, naturalMilkType = 'formula') {
const totals = { breast: 0, formula: 0 };
(Array.isArray(feedings) ? feedings : []).forEach((feeding = {}) => {
if (feeding.isV2FeedingRecord && Array.isArray(feeding.formulaComponents)) {
feeding.formulaComponents.forEach((component = {}) => {
if (component.kind === 'breast_milk') {
totals.breast += toNumber(component.volume);
return;
}
if (component.kind !== 'formula_powder') return;
const isSpecial = component.proteinRole === 'special' || component.category === 'special_formula';
if (!isSpecial) {
totals.formula += toNumber(component.waterVolume);
}
});
return;
}
const volume = toNumber(feeding.naturalMilkVolume);
if (volume <= 0) return;
if (feeding.naturalMilkType === 'formula') {
totals.formula += volume;
} else {
totals.breast += volume;
}
});
if (totals.breast > 0 || totals.formula > 0) {
return [
...(totals.breast > 0 ? [{ label: '母乳', value: totals.breast }] : []),
...(totals.formula > 0 ? [{ label: '普奶', value: totals.formula }] : [])
];
}
return naturalMilkType === 'breast'
? [{ label: '母乳', value: normalMilk.volume || 0 }]
: [{ label: '普奶', value: normalMilk.volume || 0 }];
}
function buildProteinBreakdownLine(parts = []) {
return parts.map(({ label, value }) => `${label} ${formatTwoDecimals(value)}g`).join(' · ');
}
function buildStatValue(value, unit) {
return `${normalizeValue(value)} ${unit}`;
}
function buildProteinStatValue(value) {
return `${formatTwoDecimals(value)} g`;
}
function roundDisplayNumber(value, precision = 2) {
const num = Number(value || 0);
const rounded = Number(num.toFixed(precision));
return normalizeValue(rounded);
}
function roundDisplayInteger(value) {
const num = Number(value || 0);
return normalizeValue(Math.round(num));
}
function formatAmount(value) {
const num = Number(value || 0);
if (!num) return '';
return roundDisplayNumber(num);
}
function formatVolume(value) {
const num = Number(value || 0);
if (!num) return '';
return roundDisplayInteger(num);
}
function buildAmountText(parts = []) {
return parts.filter(Boolean).join(' / ');
}
function getComponentKey(component = {}) {
if (component.kind === 'breast_milk') return 'breast_milk';
return [
component.kind || '',
component.powderId || '',
component.powderName || '',
component.category || ''
].join(':');
}
function getComponentBase(component = {}) {
if (component.kind === 'breast_milk') {
return {
badge: '母',
badgeClass: 'breast',
badgeStyle: '',
name: '母乳',
proteinRole: 'natural'
};
}
const categoryMeta = POWDER_CATEGORY_META[component.category] || {};
return {
badge: component.categoryShortLabel || categoryMeta.shortLabel || '奶',
badgeClass: component.categoryBadgeClass || categoryMeta.badgeClass || '',
badgeStyle: component.categoryBadgeStyle || (categoryMeta.shortLabel ? buildCategoryBadgeStyle(categoryMeta) : ''),
name: component.powderName || '配方粉',
proteinRole: component.proteinRole || 'natural'
};
}
function calculateComponentStats(component = {}) {
const nutrition = component.nutritionSnapshot || {};
const isBreast = component.kind === 'breast_milk';
const factor = isBreast
? Number(component.volume || 0) / 100
: Number(component.powderWeight || 0) / 100;
return {
volume: isBreast ? Number(component.volume || 0) : Number(component.waterVolume || 0),
powderWeight: isBreast ? 0 : Number(component.powderWeight || 0),
calories: Number(nutrition.calories || 0) * factor,
protein: Number(nutrition.protein || 0) * factor,
carbs: Number(nutrition.carbs || 0) * factor,
fat: Number(nutrition.fat || 0) * factor
};
}
function buildProteinBreakdownText(row = {}) {
const parts = [];
if (row.naturalProtein > 0) {
parts.push(`天然${formatTwoDecimals(row.naturalProtein)}g`);
}
if (row.specialProtein > 0) {
parts.push(`特殊${formatTwoDecimals(row.specialProtein)}g`);
}
if (parts.length) return parts.join('/');
if (row.hasZeroProtein) return '无蛋白热量';
const fallbackLabel = row.proteinRole === 'special' ? '特殊' : '天然';
return `${fallbackLabel}${formatTwoDecimals(row.protein)}g`;
}
function buildProteinMetricText(row = {}) {
if (row.naturalProtein > 0 && row.specialProtein <= 0) {
return {
label: '天然蛋白',
value: `${formatTwoDecimals(row.naturalProtein)}g`
};
}
if (row.specialProtein > 0 && row.naturalProtein <= 0) {
return {
label: '特殊蛋白',
value: `${formatTwoDecimals(row.specialProtein)}g`
};
}
if (row.protein > 0) {
return {
label: '蛋白',
value: `${formatTwoDecimals(row.protein)}g`
};
}
return {
label: '蛋白',
value: '0.00g'
};
}
function buildMilkComponentRows(feedings = []) {
const rowMap = new Map();
(feedings || [])
.filter((feeding) => feeding?.isV2FeedingRecord && Array.isArray(feeding.formulaComponents))
.forEach((feeding = {}) => {
const countedKeys = new Set();
(feeding.formulaComponents || []).forEach((component = {}) => {
if (component.kind !== 'breast_milk' && component.kind !== 'formula_powder') return;
const key = getComponentKey(component);
const stats = calculateComponentStats(component);
const base = getComponentBase(component);
const current = rowMap.get(key) || {
...base,
recordCount: 0,
volume: 0,
powderWeight: 0,
calories: 0,
protein: 0,
naturalProtein: 0,
specialProtein: 0,
carbs: 0,
fat: 0,
hasZeroProtein: false
};
current.volume += stats.volume;
current.powderWeight += stats.powderWeight;
current.calories += stats.calories;
current.protein += stats.protein;
if (component.proteinRole === 'special') {
current.specialProtein += stats.protein;
} else if (component.proteinRole === 'none') {
current.hasZeroProtein = true;
} else {
current.naturalProtein += stats.protein;
}
current.carbs += stats.carbs;
current.fat += stats.fat;
if (!countedKeys.has(key)) {
current.recordCount += 1;
countedKeys.add(key);
}
rowMap.set(key, current);
});
});
return Array.from(rowMap.values()).map((row) => {
const isZeroProtein = row.proteinRole === 'none';
const isSpecial = row.proteinRole === 'special';
const proteinRoleText = isZeroProtein ? '无蛋白热量' : (isSpecial ? '特殊' : '天然');
const proteinValueText = isZeroProtein ? '' : `${formatTwoDecimals(row.protein)}g`;
const proteinBreakdownText = buildProteinBreakdownText(row);
const proteinMetricText = buildProteinMetricText(row);
return {
badge: row.badge,
badgeClass: row.badgeClass,
badgeStyle: row.badgeStyle,
name: row.name,
recordCount: row.recordCount,
sourceCountText: row.recordCount > 0 ? `${row.recordCount}次记录` : '',
amountText: buildAmountText([
row.volume > 0 ? `${formatVolume(row.volume)}ml` : '',
row.powderWeight > 0 ? `粉${formatAmount(row.powderWeight)}g` : ''
]),
primaryText: `${roundDisplayInteger(row.calories)} kcal`,
secondaryText: proteinBreakdownText,
proteinRoleText,
proteinValueText,
proteinBreakdownText,
proteinLabelText: proteinMetricText.label,
proteinAmountText: proteinMetricText.value,
carbsText: `${roundDisplayNumber(row.carbs)}g`,
fatText: `${roundDisplayNumber(row.fat)}g`,
macroText: `碳水 ${roundDisplayNumber(row.carbs)}g · 脂肪 ${roundDisplayNumber(row.fat)}g`,
calories: Number(row.calories.toFixed(2)),
protein: Number(row.protein.toFixed(2)),
naturalProtein: Number(row.naturalProtein.toFixed(2)),
specialProtein: Number(row.specialProtein.toFixed(2)),
carbs: Number(row.carbs.toFixed(2)),
fat: Number(row.fat.toFixed(2))
};
});
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
const waterOverview = intakeOverview.water || intakeOverview.drinkingWater || {};
const foodOverview = intakeOverview.food || {};
const treatmentOverview = intakeOverview.treatment || {};
const macroRatios = input.macroRatios || {};
const goalRangeValue = buildRangeValue(input.calorieGoalPerKgRange);
const goalRangeDailyValue = buildDailyRangeValue(input.calorieGoalPerKgRange);
const totalMilkVolume = toNumber(normalMilk.volume) + toNumber(specialMilk.volume);
const foodFluidVolume = toNumber(input.foodFluidVolume ?? foodOverview.fluidVolume);
const drinkingWaterVolume = toNumber(input.drinkingWaterVolume ?? input.waterVolume ?? waterOverview.volume);
const treatmentFluidVolume = toNumber(input.treatmentFluidVolume ?? treatmentOverview.fluidVolume);
const totalLiquidVolume = toNumber(input.totalLiquidVolume ?? input.totalFluidVolume ?? (totalMilkVolume + foodFluidVolume + drinkingWaterVolume + treatmentFluidVolume));
const liquidInfoMilkParts = buildNormalMilkVolumeInfoParts(input.feedings || [], normalMilk, input.naturalMilkType);
const totalMilkCalories = toNumber(normalMilk.calories) + toNumber(specialMilk.calories);
const foodFat = toNumber(foodOverview.fat);
const treatmentFat = toNumber(treatmentOverview.fat);
const normalMilkLabel = input.naturalMilkType === 'breast' ? '母' : '普';
const normalMilkColumnLabel = input.naturalMilkType === 'breast' ? '母乳' : '普奶';
const feedingRecordCount = Array.isArray(input.feedings) ? input.feedings.length : 0;
const milkComponentRows = buildMilkComponentRows(input.feedings || []);
const hasMilkComponentRows = milkComponentRows.length > 0;
const useComponentMilkSection = input.isV2RecordsPage || hasMilkComponentRows;
const componentCalories = milkComponentRows.reduce((total, row) => total + (row.calories || 0), 0);
const componentProtein = milkComponentRows.reduce((total, row) => total + (row.protein || 0), 0);
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
infoTitle: '目标热卡系数（kcal/kg/d）',
infoLines: buildCalorieGoalInfoLines(input.calorieGoalPerKgRange, input.calorieGoalPerKgRangeLines)
},
{
...createMetric('总蛋白', formatTwoDecimals(input.proteinSummaryDisplay?.total || 0), 'g'),
detail: buildProteinBreakdownLine([
{ label: '天然', value: input.proteinSummaryDisplay?.natural || 0 },
{ label: '特殊', value: input.proteinSummaryDisplay?.special || 0 }
])
},
{
...createMetric('总液体量', roundDisplayInteger(totalLiquidVolume), 'ml'),
detail: buildLiquidSummaryLine({
milk: totalMilkVolume,
water: drinkingWaterVolume,
other: foodFluidVolume + treatmentFluidVolume
}),
infoTitle: '总液体量明细',
infoIcon: '!',
infoLines: buildVolumeInfoLines([
...liquidInfoMilkParts,
{ label: '特奶', value: specialMilk.volume || 0 },
{ label: '喝水', value: drinkingWaterVolume },
{ label: '食物', value: foodFluidVolume },
{ label: '治疗', value: treatmentFluidVolume }
])
}
],
nutritionStrip: [
{
label: '天然蛋白',
value: formatTwoDecimals(input.proteinSummaryDisplay?.natural || 0),
unit: 'g',
source: buildProteinBreakdownLine([
{ label: '奶', value: naturalMilkProtein },
{ label: '食物', value: naturalFoodProtein }
]),
premiumRatio: input.proteinSummaryDisplay?.premiumRatio || 0,
premiumValue: formatTwoDecimals(input.proteinSummaryDisplay?.premium || 0),
detailLabel: '天然蛋白系数',
detailValue: buildCoefficientParts(input.naturalProteinCoefficient).value,
detailUnit: buildCoefficientParts(input.naturalProteinCoefficient).unit,
detail: input.naturalProteinCoefficient ? `${input.naturalProteinCoefficient} g/kg/d` : '--'
},
{
label: '特殊蛋白',
value: formatTwoDecimals(input.proteinSummaryDisplay?.special || 0),
unit: 'g',
source: buildProteinBreakdownLine([
{ label: '特奶', value: specialMilkProtein },
...(specialFoodProtein > 0 ? [{ label: '食物', value: specialFoodProtein }] : [])
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
...(useComponentMilkSection ? {
variant: 'components',
componentRows: milkComponentRows,
meta: `${feedingRecordCount}条记录${milkComponentRows.length > 0 ? ` · ${milkComponentRows.length}类奶品` : ''}`
} : {}),
summaryText: useComponentMilkSection
? `奶量 ${normalizeValue(input.totalMilk || totalMilkVolume)}ml · 热量 ${roundDisplayNumber(componentCalories)}kcal · 蛋白 ${formatTwoDecimals(componentProtein)}g`
: `${normalMilkColumnLabel} ${normalizeValue(normalMilk.volume || 0)}ml ${normalizeValue(normalMilk.calories || 0)}kcal ${formatTwoDecimals(normalMilk.protein || 0)}g蛋白 · 特奶 ${normalizeValue(specialMilk.volume || 0)}ml ${normalizeValue(specialMilk.calories || 0)}kcal ${formatTwoDecimals(specialMilk.protein || 0)}g蛋白`,
columns: [
{
label: normalMilkColumnLabel,
stats: [
{ label: '体积', value: buildStatValue(normalMilk.volume || 0, 'ml') },
{ label: '热量', value: buildStatValue(normalMilk.calories || 0, 'kcal') },
{ label: '蛋白', value: buildProteinStatValue(normalMilk.protein || 0) },
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
{ label: '蛋白', value: buildProteinStatValue(specialMilk.protein || 0) },
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
summaryText: `热量 ${normalizeValue(foodOverview.totalCalories || 0)} kcal · 蛋白 ${formatTwoDecimals(getFoodProtein(foodOverview))} g`,
// 液体已在上方「总液体量」展示，食物分区不再重复
stats: buildNonZeroStats([
{ label: '热量', value: buildStatValue(foodOverview.totalCalories || 0, 'kcal') },
{ label: '蛋白', value: buildProteinStatValue(getFoodProtein(foodOverview)) },
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
{ label: '蛋白', value: buildProteinStatValue(treatmentOverview.protein || 0) },
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
