'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'miniprogram/images/food-illustrations');
const sourceDirectory = path.join(root, 'assets/food-illustrations');
const common = [
  'apple', 'broccoli', 'rice', 'egg', 'chicken', 'milk',
  'banana', 'orange', 'carrot', 'potato', 'tomato', 'pumpkin',
  'pear', 'corn', 'cucumber', 'spinach', 'tofu', 'noodles',
  'pork', 'beef', 'fish', 'shrimp', 'bread', 'soybeans'
];
const categories = [
  'category-grains', 'category-tubers', 'category-beans', 'category-vegetables', 'category-fungi', 'category-fruit',
  'category-nuts', 'category-meat', 'category-poultry', 'category-dairy', 'category-eggs', 'category-seafood',
  'category-baby-food', 'category-snacks', 'category-instant', 'category-drinks', 'category-alcohol', 'category-sweets',
  'category-oils', 'category-seasonings', 'category-other', 'general', 'egg-white', 'egg-yolk'
];

function jpegDimensions(content) {
  let offset = 2;
  while (offset + 4 < content.length && content[offset] === 0xff) {
    const marker = content[offset + 1];
    const length = content.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > content.length) break;
    if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 7) {
      return { width: content.readUInt16BE(offset + 7), height: content.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  throw new Error('无法读取 JPEG 图片尺寸');
}

if (process.argv.includes('--build')) {
  fs.mkdirSync(output, { recursive: true });
  for (const [file, names] of [['common-atlas.png', common], ['category-atlas.png', categories]]) {
    const source = path.join(sourceDirectory, file);
    const dimensions = execFileSync('magick', ['identify', '-format', '%w %h', source], { encoding: 'utf8' }).trim().split(' ').map(Number);
    if (dimensions[0] % 6 || dimensions[1] % 4) throw new Error('图集尺寸无法按六列四行等分：' + file);
    const width = dimensions[0] / 6;
    const height = dimensions[1] / 4;
    names.forEach((name, index) => {
      if (name.startsWith('category-') || name === 'general') return;
      const crop = `${width}x${height}+${index % 6 * width}+${Math.floor(index / 6) * height}`;
      execFileSync('magick', [source, '-crop', crop, '+repage', '-resize', '192x192', '-strip',
        '-sampling-factor', '4:2:0', '-quality', '82', path.join(output, name + '.jpg')]);
    });
  }
}

const catalog = require('../miniprogram/data/food-illustrations');
const cloudFiles = require('../miniprogram/data/food-illustrations-cloud');
const foods = require('../cloudfunctions/migrateSystemFoods/foods.json');
const names = [...common, 'egg-white', 'egg-yolk'];
const known = new Set(names);
const fullManifestPath = path.join(sourceDirectory, 'full/catalog.json');
if (fs.existsSync(fullManifestPath)) JSON.parse(fs.readFileSync(fullManifestPath, 'utf8')).assets.forEach(asset => known.add(asset.key));
const codes = new Set(foods.map(food => food.sourceFoodCode));
const assets = names.map(key => {
  const localPath = path.join(output, key + '.jpg');
  const content = fs.readFileSync(localPath);
  if (content.length > 30 * 1024) throw new Error('缩略图超过 30KB：' + key);
  if (content[0] !== 0xff || content[1] !== 0xd8) throw new Error('缩略图不是有效 JPEG：' + key);
  const size = jpegDimensions(content);
  if (size.width !== 192 || size.height !== 192) throw new Error('缩略图尺寸必须为 192×192：' + key);
  return { key, localPath: path.relative(root, localPath).split(path.sep).join('/'),
    cloudPath: 'food-illustrations/v1/' + key + '.jpg', bytes: content.length,
    sha256: crypto.createHash('sha256').update(content).digest('hex') };
});
Object.entries(catalog.foods).forEach(([code, key]) => {
  if (!codes.has(code) || !known.has(key)) throw new Error('无效的食物配图映射：' + code + ' → ' + key);
});
Object.entries(catalog.localFiles).forEach(([key, source]) => {
  if (!known.has(key) || !source.startsWith('/images/food-illustrations/') || !fs.existsSync(path.join(root, 'miniprogram', source.slice(1)))) throw new Error('随包插画路径无效：' + key);
});
Object.entries(cloudFiles.files).forEach(([key, source]) => {
  if (!known.has(key) || typeof source !== 'string' || !/^(cloud:\/\/|https:\/\/)/.test(source)) throw new Error('无效的云端图片配置：' + key);
});
if (cloudFiles.root && !/^(cloud:\/\/|https:\/\/).+\/$/.test(cloudFiles.root)) throw new Error('云端插画根路径不正确');
if (cloudFiles.root && catalog.assetVersion && cloudFiles.assetVersion !== catalog.assetVersion) throw new Error('云端插画版本与本地映射不一致，请先上传并确认新版本');
const project = require('../project.config.json');
if (!(project.packOptions?.include || []).some(rule => rule.type === 'folder' && rule.value === 'images/food-illustrations')) {
  throw new Error('动态插画路径必须显式加入 packOptions.include，避免被打包过滤');
}
const manifest = { schemaVersion: 1, assetVersion: 'v1', assets };
const manifestPath = path.join(sourceDirectory, 'upload-manifest.json');
if (process.argv.includes('--build')) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
else if (fs.readFileSync(manifestPath, 'utf8') !== JSON.stringify(manifest, null, 2) + '\n') throw new Error('上传清单与实际图片不一致，请重新构建');
const total = assets.reduce((sum, asset) => sum + asset.bytes, 0);
console.log('食物插画资源检查通过：' + assets.length + ' 张，合计 ' + total + ' 字节，最大单图 ' + Math.max(...assets.map(asset => asset.bytes)) + ' 字节。');
console.log('具体食物映射：' + Object.keys(catalog.foods).length + '/' + foods.length + ' 条；缺图时使用名称占位，不使用分类图。');
console.log('云端目录：' + (cloudFiles.root ? '已配置' : '未配置') + '；单图覆盖 ' + Object.keys(cloudFiles.files).length + ' 个；使用随包图或名称占位处理未配置的资源。');
if (fs.existsSync(fullManifestPath)) process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, 'prepare-full-food-illustrations.js')], { encoding: 'utf8' }));
