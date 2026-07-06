const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('featureFlagManager stores report OCR access with whitelist and all scopes', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../cloudfunctions/featureFlagManager/index.js'),
    'utf8'
  );

  assert.match(js, /FEATURE_FLAG_COLLECTION\s*=\s*'feature_flags'/);
  assert.match(js, /REPORT_OCR_ACCESS_KEY\s*=\s*'report_ocr_access'/);
  assert.match(js, /updateReportOcrAccessConfig/);
  assert.match(js, /scope === 'all'/);
  assert.match(js, /allowOpenids/);
  assert.match(js, /isDeveloperOpenid/);
});

test('recognizeReportCustom checks OCR access before recognition', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../cloudfunctions/recognizeReportCustom/index.js'),
    'utf8'
  );

  assert.match(js, /action === 'checkAccess'/);
  assert.match(js, /resolveReportOcrAccess/);
  assert.match(js, /scope === 'all'/);
  assert.match(js, /OCR_NOT_ALLOWED/);
  assert.match(js, /feature_flags/);
});

test('OCR access settings page is wired to featureFlagManager', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-misc/ocr-access-settings/index.js'),
    'utf8'
  );
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-misc/ocr-access-settings/index.wxml'),
    'utf8'
  );

  assert.match(js, /featureFlagManager/);
  assert.match(js, /require\('\.\.\/\.\.\/utils\/index'\)/);
  assert.match(js, /require\('\.\.\/\.\.\/config\/developer'\)/);
  assert.doesNotMatch(js, /require\('\.\.\/\.\.\/\.\.\//);
  assert.match(js, /getReportOcrAccessConfig/);
  assert.match(js, /updateReportOcrAccessConfig/);
  assert.match(wxml, /data-scope="whitelist"/);
  assert.match(wxml, /data-scope="all"/);
  assert.match(wxml, /allowOpenidsText/);
});
