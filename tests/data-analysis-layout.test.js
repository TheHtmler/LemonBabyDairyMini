const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('data-analysis page uses grouped dashboard layout', () => {
  const wxml = fs.readFileSync(
    require.resolve('../miniprogram/pages/data-analysis/index.wxml'),
    'utf8'
  );
  const wxss = fs.readFileSync(
    require.resolve('../miniprogram/pages/data-analysis/index.wxss'),
    'utf8'
  );

  assert.match(wxml, /analysis-control-panel/);
  assert.match(wxml, /analysis-period-label/);
  assert.match(wxml, /记录天数：\{\{statistics\.totalDays\}\}\/\{\{statistics\.rangeDays\}\} 天/);
  assert.match(wxml, /stat-summary-strip/);
  assert.match(wxml, /calorie-source-card/);
  assert.match(wxml, /热量来源/);
  assert.match(wxml, /\{\{statistics\.milkCalorieRatio\}\}%/);
  assert.match(wxml, /\{\{statistics\.foodCalorieRatio\}\}%/);
  assert.match(wxml, /\{\{statistics\.treatmentCalorieRatio\}\}%/);
  assert.match(wxml, /period-nav-button/);
  assert.match(wxml, /stat-section-title">蛋白结构/);
  assert.match(wxml, /天然蛋白目标：\{\{referenceRanges\.naturalProteinCoefficient\}\}/);
  assert.match(wxml, /stat-section-title">营养供能比例/);
  assert.match(wxml, /\{\{referenceRanges\.proteinEnergy\}\}/);
  assert.match(wxml, /\{\{referenceRanges\.carbsEnergy\}\}/);
  assert.match(wxml, /\{\{referenceRanges\.fatEnergy\}\}/);
  assert.match(wxml, /局部刷新/);
  assert.match(wxml, /chart-card-meta/);
  assert.match(wxml, /chart-title">奶量趋势/);
  assert.match(wxml, /chart-title">蛋白摄入结构/);
  assert.match(wxml, /chart-title">热量与热量系数/);
  assert.doesNotMatch(wxml, /记录覆盖率/);
  assert.doesNotMatch(wxml, /\{\{statistics\.recordCoverage\}\}/);
  assert.doesNotMatch(wxml, /\{\{referenceRanges\.premiumProteinRatio\}\}/);
  assert.doesNotMatch(wxml, /奶量统计曲线/);
  assert.doesNotMatch(wxml, /蛋白质系数曲线/);
  assert.doesNotMatch(wxml, /🔥 热量曲线/);
  assert.doesNotMatch(wxml, /stat-section-title">热量指标/);
  assert.doesNotMatch(wxml, /stat-hero-card/);
  assert.doesNotMatch(wxml, /nav-icon/);
  assert.doesNotMatch(wxml, /date-picker-icon/);
  assert.doesNotMatch(wxml, /天然 \{\{statistics\.avgNaturalMilk\}\}ml/);
  assert.doesNotMatch(wxml, /特奶 \{\{statistics\.avgSpecialMilk\}\}ml/);
  assert.doesNotMatch(wxml, /dimension-selector/);
  assert.doesNotMatch(wxml, /date-navigation/);

  assert.match(wxss, /\.content[\s\S]*width:\s*100%/);
  assert.match(wxss, /\.content[\s\S]*box-sizing:\s*border-box/);
  assert.match(wxss, /\.analysis-control-panel\s*\{/);
  assert.match(wxss, /\.analysis-period-label[\s\S]*white-space:\s*nowrap/);
  assert.match(wxss, /\.stat-section\s*\{/);
  assert.match(wxss, /\.stat-summary-strip\s*\{/);
  assert.match(wxss, /\.calorie-source-card\s*\{/);
  assert.match(wxss, /\.calorie-source-bar\s*\{/);
  assert.match(wxss, /\.stat-range\s*\{/);
  assert.match(wxss, /\.period-nav-button\s*\{/);
  assert.match(wxss, /\.refresh-indicator\s*\{/);
  assert.match(wxss, /\.stat-mini-grid\s*\{/);
  assert.match(wxss, /\.chart-card-meta\s*\{/);
  assert.match(wxss, /\.chart-section[\s\S]*padding:\s*24rpx 18rpx 18rpx/);
  assert.match(wxss, /\.chart-header[\s\S]*margin-bottom:\s*12rpx/);
});
