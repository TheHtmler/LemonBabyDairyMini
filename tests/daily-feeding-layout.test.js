const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('daily-feeding uses shared macro ratio cards with info bubble interaction', () => {
  const js = fs.readFileSync('miniprogram/pages/daily-feeding/index.js', 'utf8');
  const wxml = fs.readFileSync('miniprogram/pages/daily-feeding/index.wxml', 'utf8');
  const wxss = fs.readFileSync('miniprogram/pages/daily-feeding/index.wxss', 'utf8');

  assert.match(js, /buildDataRecordsSummaryPreview/);
  assert.match(js, /summaryMacroRows:\s*buildDataRecordsSummaryPreview\(\{\}\)\.macroRows/);
  assert.match(js, /buildSummaryMacroRows\(overrides = \{\}\)/);
  assert.match(js, /overviewSourceSections:\s*buildDataRecordsSummaryPreview\(\{\}\)\.sourceSections/);
  assert.match(js, /buildOverviewSourceSections\(overrides = \{\}\)/);
  assert.match(js, /数据记录页已改版/);
  assert.match(js, /overviewSourceSections:\s*this\.buildOverviewSourceSections\(\{/);
  assert.match(js, /\},\s*\(\)\s*=>\s*\{\s*\/\/ setData 异步提交后再重算，避免概览继续读取旧 intakes。\s*this\.updateCalculations\(\);/);
  assert.match(js, /toggleMetricInfo\(e\)/);
  assert.match(js, /hideMetricInfo\(\)/);

  assert.match(wxml, /metric-info-overlay/);
  assert.match(wxml, /wx:for="\{\{summaryMacroRows\}\}"/);
  assert.match(wxml, /class="overview-card"/);
  assert.match(wxml, /wx:for="\{\{overviewSourceSections\}\}"/);
  assert.match(wxml, /class="overview-section-meta" wx:if="\{\{item\.meta\}\}"/);
  assert.match(wxml, /class="ratio-inline-list macro-strip"/);
  assert.match(wxml, /class="metric-info-bubble"/);
  assert.match(wxml, /class="summary-item-meta"/);
  assert.match(wxml, /macroSummary\.premiumRatio > 0/);
  assert.doesNotMatch(wxml, /class="summary-card food-card"/);
  assert.doesNotMatch(wxml, /class="card-meta" wx:if="\{\{foodIntakes\.length > 0\}\}"/);
  assert.doesNotMatch(wxml, /<view class="empty-record" wx:if="\{\{foodIntakes\.length === 0\}\}">/);
  assert.doesNotMatch(wxml, /<view class="empty-record" wx:if="\{\{treatmentRecords\.length === 0\}\}">/);
  assert.doesNotMatch(wxml, /item\.premiumRatio > 0/);

  assert.match(wxss, /\.ratio-inline-list\s*\{/);
  assert.match(wxss, /\.metric-info-bubble\s*\{/);
  assert.match(wxss, /\.metric-info-icon\s*\{/);
  assert.match(wxss, /\.summary-item-meta\s*\{/);
  assert.match(wxss, /\.overview-card\s*\{/);
  assert.match(wxss, /\.overview-section-meta\s*\{/);
});
