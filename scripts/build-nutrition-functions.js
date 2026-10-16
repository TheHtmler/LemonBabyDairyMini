'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'packages/nutrition-recognition-core');
const functions = ['recognizeNutritionLabel', 'lookupNutritionReference', 'confirmNutritionRecognition'];
const check = process.argv.includes('--check');
const files = fs.readdirSync(source).filter(name => name.endsWith('.js'));
const hashTarget = path.join(root, 'miniprogram/utils/nutritionHash.js');
const hashBody = fs.readFileSync(path.join(source, 'hash.js'));
if (check) {
  if (!fs.existsSync(hashTarget) || !hashBody.equals(fs.readFileSync(hashTarget))) throw new Error('业务幂等键模块需要重新构建');
} else fs.writeFileSync(hashTarget, hashBody);
const clientDestination = path.join(root, 'miniprogram/pkg-milk/components/nutrition-recognition/lib/core');
if (!check) fs.mkdirSync(clientDestination, { recursive: true });
for (const file of files.filter(name => name !== 'server.js')) {
  const body = fs.readFileSync(path.join(source, file));
  const target = path.join(clientDestination, file);
  if (check) {
    if (!fs.existsSync(target) || !body.equals(fs.readFileSync(target))) throw new Error('小程序公共模块需要重新构建：' + file);
  } else fs.writeFileSync(target, body);
}

for (const name of functions) {
  const destination = path.join(root, 'cloudfunctions', name, 'lib/core');
  if (!check) fs.mkdirSync(destination, { recursive: true });
  for (const file of files) {
    const body = fs.readFileSync(path.join(source, file));
    const target = path.join(destination, file);
    if (check) {
      if (!fs.existsSync(target) || !body.equals(fs.readFileSync(target))) {
        throw new Error('云函数公共模块需要重新构建：' + name + '/' + file);
      }
    } else fs.writeFileSync(target, body);
  }
  // 每个云函数的上传目录内包含完整公共模块，不依赖仓库根目录。
  require(path.join(destination, 'index.js'));
}
// 营养云函数也独立携带服务端额度策略，单独构建即可部署。
const aiSource = path.join(root, 'packages/ai-access-core');
const aiDestination = path.join(root, 'cloudfunctions/recognizeNutritionLabel/lib/ai');
if (!check) fs.mkdirSync(aiDestination, { recursive: true });
for (const name of fs.readdirSync(aiSource).filter(name => name.endsWith('.js'))) {
  const body = fs.readFileSync(path.join(aiSource, name)); const target = path.join(aiDestination, name);
  if (check) { if (!fs.existsSync(target) || !body.equals(fs.readFileSync(target))) throw new Error('营养额度策略需要重新构建：' + name); }
  else fs.writeFileSync(target, body);
}
process.stdout.write(check ? '公共模块与部署产物一致，独立加载通过。\n' : '三个营养云函数公共模块已构建。\n');
