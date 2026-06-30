const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('data-analysis page uses grouped dashboard layout', () => {
  const wxml = fs.readFileSync(
    require.resolve('../miniprogram/pkg-report/data-analysis/index.wxml'),
    'utf8'
  );
  const wxss = fs.readFileSync(
    require.resolve('../miniprogram/pkg-report/data-analysis/index.wxss'),
    'utf8'
  );
  const chartJs = fs.readFileSync(
    require.resolve('../miniprogram/pkg-report/components/ec-canvas/ec-canvas.js'),
    'utf8'
  );
  const chartWxss = fs.readFileSync(
    require.resolve('../miniprogram/pkg-report/components/ec-canvas/ec-canvas.wxss'),
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
  assert.match(wxml, /stat-section-title">蛋白结构/);
  assert.match(wxml, /天然蛋白目标：\{\{referenceRanges\.naturalProteinCoefficient\}\}/);
  assert.match(wxml, /stat-section-title">营养供能比例/);
  assert.match(wxml, /\{\{referenceRanges\.proteinEnergy\}\}/);
  assert.match(wxml, /\{\{referenceRanges\.carbsEnergy\}\}/);
  assert.match(wxml, /\{\{referenceRanges\.fatEnergy\}\}/);
  assert.match(wxml, /analysis-data-shell/);
  assert.match(wxml, /analysis-refresh-overlay/);
  assert.match(wxml, /刷新所选日期的数据/);
  assert.match(wxml, /range-preset-list/);
  assert.match(wxml, /近一周/);
  assert.match(wxml, /近两周/);
  assert.match(wxml, /近一个月/);
  assert.match(wxml, /自定义/);
  assert.match(wxml, /picker-hero/);
  assert.match(wxml, /picker-mode-hint/);
  assert.doesNotMatch(wxml, /◀|▶/);
  assert.match(wxml, /chart-card-meta/);
  assert.match(wxml, /chart-title">奶量趋势/);
  assert.match(wxml, /chart-title">蛋白摄入结构/);
  assert.match(wxml, /chart-title">热量与热量系数/);
  assert.equal(
    (wxml.match(/实线代表左边轴，虚线代表右边轴/g) || []).length,
    2
  );
  assert.equal((wxml.match(/chart-axis-hint/g) || []).length, 2);
  assert.doesNotMatch(wxml, /占比 · 实线代表左边轴/);
  assert.doesNotMatch(wxml, /变化 · 实线代表左边轴/);
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
  assert.doesNotMatch(wxml, /dimension-tabs/);
  assert.doesNotMatch(wxml, /tab-item/);
  assert.doesNotMatch(wxml, /date-navigation/);
  assert.doesNotMatch(wxml, /period-nav-button/);
  assert.doesNotMatch(wxml, /周维度分析|月维度分析/);
  assert.doesNotMatch(wxml, /range-status-pill/);
  assert.doesNotMatch(wxml, /选择任意日期范围/);
  assert.doesNotMatch(wxml, /picker-mode-tabs/);
  assert.doesNotMatch(wxml, /picker-year-switcher/);

  assert.match(wxss, /\.content[\s\S]*width:\s*100%/);
  assert.match(wxss, /\.content[\s\S]*box-sizing:\s*border-box/);
  assert.match(wxss, /\.analysis-control-panel\s*\{/);
  assert.match(wxss, /\.analysis-period-label[\s\S]*white-space:\s*nowrap/);
  assert.match(wxss, /\.range-preset-list\s*\{/);
  assert.match(wxss, /\.range-preset-item\.active[\s\S]*linear-gradient/);
  assert.match(wxss, /\.stat-section\s*\{/);
  assert.match(wxss, /\.stat-summary-strip\s*\{/);
  assert.match(wxss, /\.calorie-source-card\s*\{/);
  assert.match(wxss, /\.calorie-source-bar\s*\{/);
  assert.match(wxss, /\.stat-range\s*\{/);
  assert.match(wxss, /\.period-nav-button\s*\{/);
  assert.match(wxss, /\.analysis-data-shell\s*\{/);
  assert.match(wxss, /\.analysis-refresh-overlay\s*\{/);
  assert.match(wxss, /\.picker-hero\s*\{/);
  assert.match(wxss, /\.stat-mini-grid\s*\{/);
  assert.match(wxss, /\.chart-card-meta\s*\{/);
  assert.match(wxss, /\.chart-axis-hint\s*\{/);
  assert.match(wxss, /\.chart-section[\s\S]*padding:\s*24rpx 18rpx 18rpx/);
  assert.match(wxss, /\.chart-header[\s\S]*margin-bottom:\s*12rpx/);

  assert.match(chartWxss, /\.crosshair-handle[\s\S]*bottom:\s*-18rpx/);
  assert.match(chartWxss, /\.crosshair-handle[\s\S]*width:\s*28rpx/);
  assert.doesNotMatch(chartWxss, /\.crosshair-handle[\s\S]*top:\s*-8rpx/);
  assert.match(chartJs, /bottomHandleTouchExtra/);
  assert.match(chartJs, /let tooltipX = guideX - tooltipWidth \/ 2/);
  assert.match(chartJs, /let tooltipY = padding\.top \+ tooltipTopOffset/);
  assert.doesNotMatch(chartJs, /touchX !== undefined \? options\.touchX/);
  assert.doesNotMatch(chartJs, /touchY !== undefined \? options\.touchY/);
});
