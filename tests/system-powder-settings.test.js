const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('systemPowderManager cloud function guards developer access and manages powder_catalog', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../cloudfunctions/systemPowderManager/index.js'),
    'utf8'
  );

  assert.match(js, /POWDER_COLLECTION\s*=\s*'powder_catalog'/);
  assert.match(js, /META_COLLECTION\s*=\s*'system_powder_catalog_meta'/);
  assert.match(js, /isDeveloperOpenid\(OPENID\)/);
  assert.match(js, /NO_PERMISSION/);
  assert.match(js, /action === 'list'/);
  assert.match(js, /action === 'save'/);
  assert.match(js, /action === 'remove'/);
  assert.match(js, /action === 'refreshMeta'/);
  // 写入固定为系统条目，且每次增删改都会刷新索引版本
  assert.match(js, /sourceType:\s*'system'/);
  assert.match(js, /await refreshMeta\(\)/);
  // 编码唯一性校验，避免覆盖既有条目
  assert.match(js, /已被|已存在/);
});

test('system powder settings page is wired to systemPowderManager with developer gate', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-misc/system-powder-settings/index.js'),
    'utf8'
  );
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-misc/system-powder-settings/index.wxml'),
    'utf8'
  );

  assert.match(js, /systemPowderManager/);
  assert.match(js, /require\('\.\.\/\.\.\/config\/developer'\)/);
  assert.match(js, /action:\s*'list'/);
  assert.match(js, /action:\s*'save'/);
  assert.match(js, /action:\s*'remove'/);
  // 表单覆盖名称、分类、营养与冲配比；编码自动生成、仅编辑时只读展示
  assert.match(js, /generatePowderCode/);
  assert.match(js, /\|\|\s*generatePowderCode\(\)/);
  assert.match(wxml, /draft\.name/);
  assert.match(wxml, /categoryOptions/);
  assert.match(wxml, /nutritionPer100g\.protein/);
  assert.match(wxml, /mixRatio\.powder/);
  assert.match(wxml, /新增系统奶粉/);
  assert.match(wxml, /无权限访问/);
  assert.match(wxml, /wx:if="\{\{draft\.id\}\}"[\s\S]*?draft\.powderCode/);
  assert.doesNotMatch(wxml, /data-field="powderCode"/);
});

test('system powder form marks required fields and validates like my-powder editor', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-misc/system-powder-settings/index.js'),
    'utf8'
  );
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-misc/system-powder-settings/index.wxml'),
    'utf8'
  );
  const wxss = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-misc/system-powder-settings/index.wxss'),
    'utf8'
  );

  // 必填：名称、分类、蛋白/热量/脂肪/碳水、冲配比粉量/水量；纤维与其它字段选填
  assert.match(js, /validateDraftRequired/);
  assert.match(js, /请填写名称/);
  assert.match(js, /冲配比粉量/);
  const requiredLabels = [...wxml.matchAll(/form-label required">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(requiredLabels, [
    '名称',
    '分类',
    '蛋白 (g)',
    '热量 (kcal)',
    '脂肪 (g)',
    '碳水 (g)',
    '粉量 (g)',
    '水量 (ml)'
  ]);
  assert.match(wxss, /\.form-label\.required::before/);
  // 输入框与我的奶粉编辑弹窗同规格（80rpx 高、28rpx 字号）
  assert.match(wxss, /\.form-input,\s*\n\.form-picker\s*\{[^}]*height:\s*80rpx/);
  assert.match(wxss, /\.form-input,\s*\n\.form-picker\s*\{[^}]*font-size:\s*28rpx/);
});

test('system powder settings page supports packaging image upload to cloud storage', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-misc/system-powder-settings/index.js'),
    'utf8'
  );
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-misc/system-powder-settings/index.wxml'),
    'utf8'
  );

  assert.match(js, /chooseImage/);
  assert.match(js, /wx\.cloud\.uploadFile/);
  assert.match(js, /powder_catalog_images\//);
  assert.match(js, /getTempFileURL/);
  // 保存时把 fileID 写入 image 字段
  assert.match(js, /image:\s*draft\.image/);
  assert.match(wxml, /choosePowderImage/);
  assert.match(wxml, /removePowderImage/);
  assert.match(wxml, /imagePreviewUrl/);
});

test('system powder settings page is registered and linked from developer config hub', () => {
  const appConfig = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../miniprogram/app.json'), 'utf8')
  );
  const devConfigJs = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-misc/developer-config/index.js'),
    'utf8'
  );

  const miscPages = (appConfig.subPackages || []).find((item) => item.root === 'pkg-misc')?.pages || [];
  assert.ok(miscPages.includes('system-powder-settings/index'));
  assert.match(devConfigJs, /system-powder-settings\/index/);
  assert.match(devConfigJs, /系统奶粉库管理/);
});
