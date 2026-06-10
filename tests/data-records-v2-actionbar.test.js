const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('treatment record tab uses the same titleless icon action as feeding record', () => {
  const pageWxml = fs.readFileSync('miniprogram/pages/data-records-v2/index.wxml', 'utf8');
  const componentWxml = fs.readFileSync('miniprogram/components/treatment-record-list/treatment-record-list.wxml', 'utf8');
  const componentJs = fs.readFileSync('miniprogram/components/treatment-record-list/treatment-record-list.js', 'utf8');
  const componentWxss = fs.readFileSync('miniprogram/components/treatment-record-list/treatment-record-list.wxss', 'utf8');

  assert.match(pageWxml, /<treatment-record-list[\s\S]*show-title="\{\{false\}\}"[\s\S]*action-text="补充记录"/);
  assert.doesNotMatch(pageWxml, /<treatment-record-list[\s\S]*title="治疗记录"[\s\S]*action-text="补充记录"/);
  assert.match(componentJs, /showTitle:\s*\{[\s\S]*type:\s*Boolean,[\s\S]*value:\s*true/);
  assert.match(componentWxml, /wx:if="\{\{showTitle && title\}\}"/);
  assert.match(componentWxml, /<image class="treatment-panel-action-icon" src="\/images\/icons\/add\.svg" mode="aspectFit"><\/image>/);
  assert.match(componentWxml, /<text class="treatment-panel-action-text">\{\{actionText\}\}<\/text>/);
  assert.match(componentWxss, /\.treatment-panel-header\.actions-only\s*\{[^}]*justify-content: flex-end;/s);
  assert.match(componentWxss, /\.treatment-panel-action-icon\s*\{[^}]*width: 24rpx;[^}]*height: 24rpx;/s);
});
