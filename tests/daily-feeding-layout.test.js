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
  assert.match(js, /toggleMetricInfo\(e\)/);
  assert.match(js, /hideMetricInfo\(\)/);

  assert.match(wxml, /metric-info-overlay/);
  assert.match(wxml, /wx:for="\{\{summaryMacroRows\}\}"/);
  assert.match(wxml, /class="ratio-inline-list macro-strip"/);
  assert.match(wxml, /class="metric-info-bubble"/);

  assert.match(wxss, /\.ratio-inline-list\s*\{/);
  assert.match(wxss, /\.metric-info-bubble\s*\{/);
  assert.match(wxss, /\.metric-info-icon\s*\{/);
});
