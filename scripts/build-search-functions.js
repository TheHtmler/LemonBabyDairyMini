'use strict';
const fs = require('fs');
const path = require('path');
const { staticJsDependencies } = require('./lib/static-js-dependencies');
const root = path.resolve(__dirname, '..');
const check = process.argv.includes('--check');
const outputs = new Map();
function writeGenerated(relative, body) {
  const target = path.join(root, relative);
  outputs.set(target, Buffer.from(body));
}
function copy(source, destinations) {
  const directory = path.join(root, source);
  for (const name of fs.readdirSync(directory).filter(x => x.endsWith('.js'))) {
    const body = fs.readFileSync(path.join(directory, name));
    for (const relative of destinations) {
      writeGenerated(relative + '/' + name, body);
    }
  }
}
// 普通分包复用主包的搜索模块；云函数仍各自携带独立部署所需的副本。
copy('packages/search-core', ['cloudfunctions/searchManager/lib/search', 'miniprogram/utils/search-core', 'cloudfunctions/getSystemFoodIndex/lib/search', 'cloudfunctions/getSystemPowderIndex/lib/search']);
// 服务端复用页面现有的纯计算源，不复制另一套营养和剩奶算法。
for (const file of ['dailySummaryV2Utils.js', 'feedingRecordV2Utils.js', 'formulaPowderUtils.js', 'nutritionProvenance.js', 'growthChartUtils.js']) {
  const body = fs.readFileSync(path.join(root, 'miniprogram/utils', file), 'utf8').replace(/require\('\.\/search-core\//g, "require('../search/");
  writeGenerated('cloudfunctions/searchManager/lib/intake/' + file, body);
}
writeGenerated('cloudfunctions/rebuildDailySummaryV2/lib/nutritionProvenance.js', fs.readFileSync(path.join(root, 'miniprogram/utils/nutritionProvenance.js'), 'utf8'));
writeGenerated('cloudfunctions/searchManager/lib/config/milkCategoryTags.js', fs.readFileSync(path.join(root, 'miniprogram/config/milkCategoryTags.js'), 'utf8'));
if (fs.existsSync(path.join(root, 'packages/ai-access-core'))) copy('packages/ai-access-core', ['cloudfunctions/searchManager/lib/ai', 'cloudfunctions/recognizeNutritionLabel/lib/ai', 'cloudfunctions/featureFlagManager/lib/ai']);
// 全部生成内容先校验；依赖优先落盘，避免调用方先更新而依赖尚未生成。
const ordered = [];
const visited = new Set();
const visiting = new Set();
function visit(target) {
  if (visited.has(target)) return;
  if (visiting.has(target)) throw new Error('生成模块存在循环依赖：' + path.relative(root, target));
  visiting.add(target);
  const body = outputs.get(target).toString('utf8');
  let dependencies;
  try { dependencies = staticJsDependencies(body); }
  catch (error) { throw new Error(path.relative(root, target) + '：' + error.message); }
  for (const { specifier } of dependencies) {
    if (!specifier.startsWith('.')) continue;
    const base = path.resolve(path.dirname(target), specifier);
    const dependency = path.extname(base) ? base : base + '.js';
    if (outputs.has(dependency)) visit(dependency);
    else if (!fs.existsSync(dependency)) throw new Error('生成模块缺少依赖：' + path.relative(root, target) + ' → ' + specifier);
  }
  visiting.delete(target);
  visited.add(target);
  ordered.push(target);
}
outputs.forEach((body, target) => visit(target));
let changed = 0;
for (const target of ordered) {
  const body = outputs.get(target);
  if (fs.existsSync(target) && body.equals(fs.readFileSync(target))) continue;
  if (check) throw new Error('共享模块尚未同步：' + path.relative(root, target));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // 同目录原子替换，文件监听器不会读到 writeFileSync 截断后的半个模块。
  const temporary = target + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, body, { flag: 'wx' });
  fs.renameSync(temporary, target);
  changed++;
}
// 构建和检查使用同一全入口门禁，不能只用 Node 加载成功代替小程序依赖检查。
const result = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'check-miniprogram-imports.js')], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
process.stdout.write(check ? '搜索共享源与构建产物一致。\n' : '搜索共享模块已同步：更新 ' + changed + ' 个文件，其余文件保持不变。\n');
