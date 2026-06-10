const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('data records page shows diaper records as a peer record tab with icon-rich layout', () => {
  const wxml = fs.readFileSync('miniprogram/pages/data-records-v2/index.wxml', 'utf8');
  const js = fs.readFileSync('miniprogram/pages/data-records-v2/index.js', 'utf8');
  const wxss = fs.readFileSync('miniprogram/pages/data-records-v2/index.wxss', 'utf8');
  const appJson = fs.readFileSync('miniprogram/app.json', 'utf8');

  assert.match(wxml, /data-tab="bowel" bindtap="switchTab"/);
  assert.match(wxml, /<scroll-view class="tabs-scroll" scroll-x="true" enhanced="true" show-scrollbar="false">/);
  assert.match(wxml, /<text>尿布记录<\/text>/);
  assert.match(wxml, /<block wx:elif="\{\{activeTab === 'bowel'\}\}">/);
  assert.match(wxml, /class="card bowel-card"/);
  assert.match(wxml, /<view class="card-title actions-only bowel-actions-title">/);
  assert.doesNotMatch(wxml, /class="bowel-title-main"/);
  assert.doesNotMatch(wxml, /<text class="bowel-title">/);
  assert.match(wxml, /class="add-btn" bindtap="navigateToBowelRecord"/);
  assert.match(wxml, /<image class="add-icon" src="\/images\/icons\/add\.svg" mode="aspectFit"><\/image>/);
  assert.match(wxml, /<text>补充记录<\/text>/);
  assert.match(wxml, /bindtap="openEditBowelRecord"/);
  assert.doesNotMatch(wxml, /class="card" wx:if="\{\{bowelRecords\.length > 0\}\}"/);
  assert.doesNotMatch(wxml, /showAddBowelModal/);
  assert.doesNotMatch(wxml, /showEditBowelModal/);
  assert.doesNotMatch(wxml, /class="modal-content bowel-sheet"/);
  assert.doesNotMatch(wxml, /class="bowel-title-icon"/);
  assert.doesNotMatch(wxml, /class="bowel-subtitle"/);
  assert.match(wxml, /bowelStats\.stool/);
  assert.match(wxml, /bowelStats\.urine/);
  assert.match(wxml, /bowelStats\.mixed/);
  assert.match(wxml, /class="bowel-record-icon \{\{record\.type\}\}"/);
  assert.match(wxml, /\{\{record\.typeIcon\}\}/);
  assert.match(wxml, /class="bowel-record-main"/);
  assert.match(wxml, /class="bowel-record-title"/);
  assert.match(wxml, /class="bowel-record-time inline"/);
  assert.match(wxml, /class="bowel-record-chip"/);
  assert.match(wxml, /record\.smellText/);
  assert.match(wxml, /record\.smellIcon/);
  assert.match(wxml, /record\.urineAmountText/);
  assert.match(wxml, /record\.urineColorText/);
  assert.match(wxml, /class="bowel-empty-state" wx:if="\{\{!bowelRecords\.length\}\}"/);
  assert.match(wxml, /今天还没有尿布记录/);

  assert.match(js, /function createEmptyBowelStats\(\)/);
  assert.match(js, /function buildBowelStats\(records = \[\]\)/);
  assert.match(js, /function getBowelTypeIcon\(type\)/);
  assert.match(js, /function getBowelConsistencyIcon\(consistency\)/);
  assert.match(js, /function getBowelSmellIcon\(smell\)/);
  assert.match(js, /function getUrineAmountText\(amount\)/);
  assert.match(js, /function getUrineColorText\(color\)/);
  assert.match(js, /navigateToBowelRecord\(\)/);
  assert.match(js, /\/pkg-records\/bowel-record\/index\?date=\$\{selectedDate\}/);
  assert.match(js, /openEditBowelRecord\(e\)/);
  assert.match(js, /id=\$\{encodeURIComponent\(recordId\)\}&date=\$\{selectedDate\}/);
  assert.match(js, /bowelStats:\s*createEmptyBowelStats\(\)/);
  assert.match(js, /bowelStats:\s*createEmptyBowelStats\(\)/);
  assert.match(js, /bowelStats:\s*buildBowelStats\(processedRecords\)/);
  assert.match(js, /typeIcon:\s*getBowelTypeIcon\(record\.type\)/);
  assert.match(js, /consistencyIcon:\s*getBowelConsistencyIcon\(record\.consistency\)/);
  assert.match(js, /smellIcon:\s*getBowelSmellIcon\(record\.smell\)/);
  assert.match(js, /urineAmountText:\s*getUrineAmountText\(record\.urineAmount\)/);
  assert.match(js, /urineColorText:\s*getUrineColorText\(record\.urineColor\)/);
  assert.match(appJson, /"bowel-record\/index"/);

  assert.match(wxss, /\.bowel-card\s*\{/);
  assert.match(wxss, /\.tabs-scroll\s*\{/);
  assert.match(wxss, /\.tab\s*\{[^}]*white-space: nowrap;/s);
  assert.match(wxss, /\.tab\s*\{[^}]*box-sizing: border-box;/s);
  assert.match(wxss, /\.tab\s*\{[^}]*font-weight: 600;/s);
  assert.doesNotMatch(wxss, /\.tab\s*\{[^}]*transition: all/s);
  assert.doesNotMatch(wxss, /\.tab\.active\s*\{[^}]*font-weight/s);
  assert.match(wxss, /\.tab\.active\s*\{[^}]*box-shadow: inset 0 0 0 2rpx/s);
  assert.match(wxss, /\.tab\.active::after\s*\{[^}]*display: none;/s);
  assert.match(wxss, /\.bowel-stats-row\s*\{/);
  assert.match(wxss, /\.bowel-record-item\s*\{[^}]*align-items: flex-start;/s);
  assert.match(wxss, /\.bowel-record-icon\s*\{/);
  assert.match(wxss, /\.bowel-record-icon\s*\{[^}]*width: 66rpx;[^}]*height: 66rpx;/s);
  assert.doesNotMatch(wxss, /align-self: stretch/);
  assert.doesNotMatch(wxss, /height: auto/);
  assert.match(wxss, /\.bowel-record-chip\s*\{/);
  assert.match(wxss, /\.bowel-empty-state\s*\{/);
});

test('bowel record editor page is page-level and uses icons while adding', () => {
  const pagePaths = [
    'miniprogram/pkg-records/bowel-record/index.js',
    'miniprogram/pkg-records/bowel-record/index.wxml',
    'miniprogram/pkg-records/bowel-record/index.wxss',
    'miniprogram/pkg-records/bowel-record/index.json'
  ];
  pagePaths.forEach(path => assert.ok(fs.existsSync(path), `${path} should exist`));

  const wxml = fs.readFileSync('miniprogram/pkg-records/bowel-record/index.wxml', 'utf8');
  const js = fs.readFileSync('miniprogram/pkg-records/bowel-record/index.js', 'utf8');
  const wxss = fs.readFileSync('miniprogram/pkg-records/bowel-record/index.wxss', 'utf8');
  const json = fs.readFileSync('miniprogram/pkg-records/bowel-record/index.json', 'utf8');

  assert.match(json, /"navigationBarTitleText": "尿布记录"/);
  assert.match(wxml, /class="page bowel-page"/);
  assert.match(wxml, /<view class="hero-title">尿布记录<\/view>/);
  assert.match(wxml, /form\.typeIcon/);
  assert.match(wxml, /class="compact-value fixed-date"/);
  assert.doesNotMatch(wxml, /picker mode="date"/);
  assert.doesNotMatch(js, /onDateChange/);
  assert.match(wxml, /class="bowel-type-btn \{\{form\.type === 'stool' \? 'active' : ''\}\}"/);
  assert.match(wxml, /<text class="type-icon">💩<\/text>/);
  assert.match(wxml, /<text class="type-icon">💧<\/text>/);
  assert.match(wxml, /<text class="type-icon">🌈<\/text>/);
  assert.match(wxml, /小便细节/);
  assert.match(wxml, /urineAmountOptions/);
  assert.match(wxml, /urineColorOptions/);
  assert.match(js, /const URINE_AMOUNT_OPTIONS =/);
  assert.match(js, /const URINE_COLOR_OPTIONS =/);
  assert.match(js, /urineAmount: overrides\.urineAmount/);
  assert.match(js, /urineColor: overrides\.urineColor/);
  assert.match(js, /payload\.urineAmount = form\.urineAmount/);
  assert.match(js, /payload\.urineColor = form\.urineColor/);
  assert.match(js, /const currentValue = this\.data\.form\?\.\[field\];/);
  assert.match(js, /\[`form\.\$\{field\}`\]: currentValue === value \? '' : value/);
  assert.match(js, /\{ value: 'liquid', label: '水样', icon: '💧' \}/);
  assert.match(js, /\{ value: 'loose', label: '稀便', icon: '🌊' \}/);
  assert.match(js, /\{ value: 'soft', label: '糊状', icon: '🥣' \}/);
  assert.match(js, /\{ value: 'normal', label: '正常', icon: '💩' \}/);
  assert.match(wxss, /\.footer-actions\s*\{[^}]*left: 0;[^}]*right: 0;/s);
  assert.match(wxss, /\.save-btn\s*\{[^}]*margin: 0;[^}]*padding: 0;[^}]*box-sizing: border-box;/s);
  assert.match(wxml, /saveBowelRecord/);
  assert.doesNotMatch(wxml, /modal/);

  assert.match(js, /Page\(\{/);
  assert.match(js, /isEdit/);
  assert.match(js, /loadRecord\(recordId\)/);
  assert.match(js, /saveBowelRecord\(\)/);
  assert.match(js, /DailySummaryV2Model\.markDirty/);
  assert.match(js, /function getCurrentOpenid\(\)/);
  assert.match(js, /getApp\(\)\.globalData\.openid \|\| wx\.getStorageSync\('openid'\) \|\| ''/);
  assert.match(js, /updatedBy: openid/);
  assert.match(js, /createdBy: openid/);
});

test('daily home exposes bowel record quick entry', () => {
  const wxml = fs.readFileSync('miniprogram/pages/daily-feeding/index.wxml', 'utf8');
  const js = fs.readFileSync('miniprogram/pages/daily-feeding/index.js', 'utf8');
  const wxss = fs.readFileSync('miniprogram/pages/daily-feeding/index.wxss', 'utf8');

  assert.match(wxml, /bindtap="navigateToBowelRecord"/);
  assert.match(wxml, /<view class="qa-ic bowel">/);
  assert.match(wxml, /<text class="qa-nm">记尿布<\/text>/);
  assert.match(js, /navigateToBowelRecord\(\)/);
  assert.match(js, /\/pkg-records\/bowel-record\/index\?date=\$\{todayKey\(\)\}/);
  assert.match(wxss, /\.qa-ic\.bowel/);
});
