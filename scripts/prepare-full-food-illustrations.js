'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'assets/food-illustrations/full');
const seedFoods = require('../cloudfunctions/migrateSystemFoods/foods.json');
const byCode = new Map(seedFoods.map(food => [food.sourceFoodCode, food]));
const groups = { plants: [1, 7], proteins: [8, 12], prepared: [13, 21] };
const foods = {};
const assetsByKey = new Map();
const digest = content => crypto.createHash('sha256').update(content).digest('hex');

function dimensions(content) {
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
  throw new Error('无法读取插画 JPEG 尺寸');
}

for (const [group, [minCategory, maxCategory]] of Object.entries(groups)) {
  const file = path.join(directory, group, 'manifest.json');
  if (!fs.existsSync(file)) throw new Error('食物素材组尚未完成：' + group);
  const part = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!part.foods || !Array.isArray(part.assets)) throw new Error('食物素材组清单格式不正确：' + group);
  const keys = new Set(part.assets.map(asset => asset.key));
  const expected = seedFoods.filter(food => Number(food.categoryLevel1Code) >= minCategory && Number(food.categoryLevel1Code) <= maxCategory);
  for (const food of expected) {
    const key = part.foods[food.sourceFoodCode];
    if (!key || !keys.has(key)) throw new Error('缺少专用插画映射：' + food.sourceFoodCode + ' ' + food.name);
  }
  for (const [code, key] of Object.entries(part.foods)) {
    const food = byCode.get(code);
    if (!food || Number(food.categoryLevel1Code) < minCategory || Number(food.categoryLevel1Code) > maxCategory) throw new Error('食物映射跨组或编码无效：' + code);
    if (foods[code]) throw new Error('食物编码重复：' + code);
    foods[code] = key;
  }
  for (const asset of part.assets) {
    if (typeof asset.key !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,159}$/.test(asset.key) || /^(category-|general$)/.test(asset.key)) throw new Error('专用插画键无效：' + asset.key);
    if (typeof asset.name !== 'string' || !asset.name.trim()) throw new Error('专用插画缺少可核对的食物名称：' + asset.key);
    const absolute = path.resolve(root, asset.localPath);
    if (!absolute.startsWith(root + path.sep)) throw new Error('插画路径超出仓库：' + asset.localPath);
    const content = fs.readFileSync(absolute);
    if (content.length <= 0 || content.length > 30 * 1024 || content[0] !== 0xff || content[1] !== 0xd8 || content.at(-2) !== 0xff || content.at(-1) !== 0xd9) throw new Error('插画格式或体积不正确：' + asset.key);
    const size = dimensions(content);
    if (size.width !== 192 || size.height !== 192) throw new Error('插画尺寸必须为 192×192：' + asset.key);
    const normalized = {
      key: asset.key, name: asset.name, description: asset.description || asset.name,
      localPath: path.relative(root, absolute).split(path.sep).join('/'),
      bytes: content.length, sha256: digest(content)
    };
    const previous = assetsByKey.get(asset.key);
    if (previous && previous.sha256 !== normalized.sha256) throw new Error('相同资源键对应了不同图片：' + asset.key);
    if (!previous) assetsByKey.set(asset.key, normalized);
  }
}

const sortedFoods = Object.fromEntries(Object.entries(foods).sort(([a], [b]) => a.localeCompare(b)));
const sourceCodes = new Map();
for (const [code, key] of Object.entries(sortedFoods)) {
  if (!assetsByKey.has(key)) throw new Error('配图资源不存在：' + code);
  if (!sourceCodes.has(key)) sourceCodes.set(key, []);
  sourceCodes.get(key).push(code);
}
if (Object.keys(sortedFoods).length !== seedFoods.length) throw new Error('全量食物映射数量不一致');
const usedAssets = [...assetsByKey.values()].filter(asset => sourceCodes.has(asset.key)).sort((a, b) => a.key.localeCompare(b.key));
const version = 'v2-' + digest(JSON.stringify(usedAssets.map(asset => [asset.key, asset.sha256]))).slice(0, 12);
const assets = usedAssets.map(asset => ({ ...asset, cloudPath: 'food-illustrations/' + version + '/' + asset.key + '.jpg', sourceCodes: sourceCodes.get(asset.key) }));
const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);
const manifest = { schemaVersion: 2, assetVersion: version, totalFoods: seedFoods.length, totalAssets: assets.length, totalBytes, foods: sortedFoods, assets };
const serialized = JSON.stringify(manifest, null, 2) + '\n';
const catalogPath = path.join(directory, 'catalog.json');
const runtimePath = path.join(root, 'miniprogram/data/food-illustrations.js');
const current = require(runtimePath);
const localFiles = { ...current.localFiles };
assets.filter(asset => asset.localPath.startsWith('miniprogram/')).forEach(asset => {
  localFiles[asset.key] = '/' + asset.localPath.slice('miniprogram/'.length);
});
const runtime = { schemaVersion: 2, assetVersion: version, foods: sortedFoods, localFiles };
const runtimeSource = '// 自动整理的具体食物配图映射；更新命令：npm run prepare:food-illustrations。\nmodule.exports = ' + JSON.stringify(runtime, null, 2) + ';\n';
const uploadDirectory = path.join(directory, 'upload');
const bundleDirectory = path.join(uploadDirectory, 'food-illustrations', version);
const archive = path.join(directory, '食物插画-' + version + '.zip');

if (process.argv.includes('--build')) {
  fs.writeFileSync(catalogPath, serialized);
  fs.writeFileSync(runtimePath, runtimeSource);
  const rows = [['食物编码', '食物名称', '专用插画', '图片文件', '云存储路径']];
  const assetMap = new Map(assets.map(asset => [asset.key, asset]));
  seedFoods.forEach(food => {
    const asset = assetMap.get(sortedFoods[food.sourceFoodCode]);
    rows.push([food.sourceFoodCode, food.name, asset.name, asset.localPath, asset.cloudPath]);
  });
  const csv = rows.map(row => row.map(value => '"' + String(value).replace(/"/g, '""') + '"').join(',')).join('\n');
  fs.writeFileSync(path.join(directory, '食物配图清单.csv'), '\ufeff' + csv + '\n');
  fs.mkdirSync(bundleDirectory, { recursive: true });
  assets.forEach(asset => fs.copyFileSync(path.resolve(root, asset.localPath), path.join(bundleDirectory, asset.key + '.jpg')));
  // 只打包审核清单中的 JPEG，不把目录内的其他文件带入上传压缩包。
  execFileSync('/usr/bin/zip', ['-q', '-FS', archive, '-@'], {
    cwd: uploadDirectory,
    input: assets.map(asset => 'food-illustrations/' + version + '/' + asset.key + '.jpg').join('\n') + '\n'
  });
} else {
  if (fs.readFileSync(catalogPath, 'utf8') !== serialized) throw new Error('全量图片清单与素材不一致，请重新整理');
  if (fs.readFileSync(runtimePath, 'utf8') !== runtimeSource) throw new Error('运行时食物映射与全量清单不一致，请重新整理');
}
for (const asset of assets) {
  if (digest(fs.readFileSync(path.join(bundleDirectory, asset.key + '.jpg'))) !== asset.sha256) throw new Error('上传资源包与审核图片不一致：' + asset.key);
}
if (!fs.existsSync(archive)) throw new Error('全量上传压缩包缺失，请重新整理');
execFileSync('/usr/bin/unzip', ['-t', '-qq', archive]);
const archivedFiles = execFileSync('/usr/bin/unzip', ['-Z', '-1', archive], { encoding: 'utf8' }).trim().split('\n').filter(file => !file.endsWith('/'));
const expectedFiles = new Set(assets.map(asset => 'food-illustrations/' + version + '/' + asset.key + '.jpg'));
if (archivedFiles.length !== expectedFiles.size || archivedFiles.some(file => !expectedFiles.has(file))) throw new Error('压缩包文件与审核清单不一致');
console.log('全量插画检查通过：' + seedFoods.length + ' 条食物、' + assets.length + ' 个具体食物素材、' + totalBytes + ' 字节；无分类图回退。');
console.log('版本目录：food-illustrations/' + version + '/；云上传尚需独立执行。');
console.log('上传压缩包：' + path.relative(root, archive));
