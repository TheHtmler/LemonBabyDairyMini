'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const fullDirectory = path.join(root, 'assets/food-illustrations/full');
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

async function main() {
  if (args.includes('--help')) {
    console.log('仅核对清单，不访问云端：node scripts/upload-food-illustrations.js --dry-run');
    console.log('确认上传后执行：node scripts/upload-food-illustrations.js --upload --env 环境ID');
    console.log('上传凭证从 CLOUDBASE_SECRET_ID / CLOUDBASE_SECRET_KEY 环境变量读取，不能放进代码或聊天。');
    return;
  }
  const upload = args.includes('--upload');
  if (upload && args.includes('--dry-run')) throw new Error('--upload 和 --dry-run 不能同时使用');
  const env = option('--env');
  if (upload && (!env || env.startsWith('--'))) throw new Error('上传必须显式指定 --env 环境ID');
  process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, 'prepare-full-food-illustrations.js')], { encoding: 'utf8' }));
  const manifest = JSON.parse(fs.readFileSync(path.join(fullDirectory, 'catalog.json'), 'utf8'));
  const prefix = 'food-illustrations/' + manifest.assetVersion + '/';
  console.log('待上传：' + manifest.totalAssets + ' 张 JPEG，合计 ' + manifest.totalBytes + ' 字节；路径 ' + prefix);
  console.log('目标环境：' + (env || '未指定，仅可核对本地清单'));
  if (!upload) { console.log('本次仅核对清单，没有调用云接口或修改云配置。'); return; }

  const secretId = process.env.CLOUDBASE_SECRET_ID;
  const secretKey = process.env.CLOUDBASE_SECRET_KEY;
  if (!secretId || !secretKey) throw new Error('上传凭证尚未在本机配置，请设置 CLOUDBASE_SECRET_ID 和 CLOUDBASE_SECRET_KEY 后重试');
  const cloudbase = require('@cloudbase/node-sdk');
  const app = cloudbase.init({ env, secretId, secretKey, timeout: 30000 });
  const receiptPath = path.join(fullDirectory, 'upload-receipt.json');
  let receipt = { schemaVersion: 1, env, assetVersion: manifest.assetVersion, files: {} };
  if (fs.existsSync(receiptPath)) {
    const previous = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (previous.env === env && previous.assetVersion === manifest.assetVersion) receipt = previous;
    else throw new Error('已有上传回执属于其他环境或素材版本，请先保留回执并明确处理版本切换');
  }
  let completed = 0;
  for (const asset of manifest.assets) {
    if (!asset.cloudPath.startsWith(prefix) || asset.cloudPath !== prefix + asset.key + '.jpg') throw new Error('上传路径与审核清单不一致：' + asset.key);
    const absolute = path.resolve(root, asset.localPath);
    if (!absolute.startsWith(root + path.sep)) throw new Error('上传文件超出仓库：' + asset.key);
    const content = fs.readFileSync(absolute);
    if (crypto.createHash('sha256').update(content).digest('hex') !== asset.sha256) throw new Error('图片内容已变化，请重新核对清单：' + asset.key);
    if (!receipt.files[asset.key]) {
      let result;
      try { result = await app.uploadFile({ cloudPath: asset.cloudPath, fileContent: content }); }
      catch (error) { throw new Error('上传 ' + asset.key + ' 失败；已完成的文件保留在上传回执，可在排查后继续'); }
      if (typeof result.fileID !== 'string' || !result.fileID.startsWith('cloud://') || !result.fileID.endsWith('/' + asset.cloudPath)) throw new Error('云接口未返回预期文件 ID，未修改小程序云配置：' + asset.key);
      receipt.files[asset.key] = result.fileID;
      // 不记录凭证；逐个保存实际返回的文件 ID，失败时不需要重新上传全部素材。
      fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    }
    completed++;
    if (completed % 25 === 0 || completed === manifest.assets.length) console.log('已上传/核对 ' + completed + '/' + manifest.assets.length + ' 张');
  }
  const first = manifest.assets[0];
  const firstId = receipt.files[first.key];
  const cloudRoot = firstId.slice(0, -first.key.length - '.jpg'.length);
  if (!manifest.assets.every(asset => receipt.files[asset.key] === cloudRoot + asset.key + '.jpg')) throw new Error('云端文件目录不一致，所有上传回执已保存，未修改小程序云配置');
  const config = { schemaVersion: 2, assetVersion: manifest.assetVersion, root: cloudRoot, files: {} };
  fs.writeFileSync(path.join(root, 'miniprogram/data/food-illustrations-cloud.js'),
    '// 全部素材上传成功后写入的真实云目录；单张特殊配置可放入 files。\nmodule.exports = ' + JSON.stringify(config, null, 2) + ';\n');
  console.log('全部素材上传完成，已写入真实云目录；重新编译小程序后生效。');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
