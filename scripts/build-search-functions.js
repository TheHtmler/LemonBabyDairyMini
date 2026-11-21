'use strict';
const fs = require('fs');
const path = require('path');
const { staticJsDependencies } = require('./lib/static-js-dependencies');
const { AMINO_ACIDS } = require('../miniprogram/utils/aminoAcidIntake');
const root = path.resolve(__dirname, '..');
const check = process.argv.includes('--check');
const { REPORT_OCR_TIMING } = require('../miniprogram/constants/reportTypes');
if (REPORT_OCR_TIMING.modelMs + REPORT_OCR_TIMING.finalizeMs >= REPORT_OCR_TIMING.functionMs
  || REPORT_OCR_TIMING.functionMs >= REPORT_OCR_TIMING.clientMs
  || REPORT_OCR_TIMING.clientMs >= REPORT_OCR_TIMING.leaseMs) throw new Error('报告识别时间预算缺少收尾或前后端等待余量');
const reportFunctionConfig = JSON.parse(fs.readFileSync(path.join(root, 'cloudfunctions/recognizeReportCustom/config.json'), 'utf8'));
if (reportFunctionConfig.timeout * 1000 !== REPORT_OCR_TIMING.functionMs) throw new Error('报告云函数执行超时与共享识别预算不一致');
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
// 模拟器和云函数按同一套规则筛选，随包数据只压缩重复的字段名和来源信息。
const aminoCloudDir = 'cloudfunctions/searchAminoAcidReferences';
const aminoPageDir = 'miniprogram/pkg-milk/amino-acid-archive';
writeGenerated(aminoPageDir + '/referenceSearch.js', fs.readFileSync(path.join(root, aminoCloudDir, 'referenceSearch.js')));
const aminoReferences = require('../cloudfunctions/searchAminoAcidReferences/references.json');
const dictionaries = [new Map(), new Map(), new Map()];
function dictionaryIndex(dictionary, value) {
  if (!dictionary.has(value)) dictionary.set(value, dictionary.size);
  return dictionary.get(value);
}
const aminoSamples = aminoReferences.map(row => {
  const { id, name, category, states, profile, aliases, composition = {} } = row;
  const { recordId, version } = profile.source;
  const dataset = id.split(':')[0];
  const sample = dataset === 'USDA' ? Number(recordId) : recordId;
  if (!['USDA', 'TFDA'].includes(dataset) || id !== dataset + ':' + sample || profile.basis !== 'g'
    || (dataset === 'USDA' && !Number.isSafeInteger(sample))) {
    throw new Error('氨基酸参考资料的来源或单位无法随包保存：' + id);
  }
  const tail = [aliases.length ? aliases : null, row.simplifiedName, row.description, row.englishNames,
    row.localAliases, row.verifiedNames];
  while (tail.length && !tail[tail.length - 1]) tail.pop();
  return [
    sample, name,
    dictionaryIndex(dictionaries[0], category),
    dictionaryIndex(dictionaries[1], version),
    dictionaryIndex(dictionaries[2], states.join(',')),
    AMINO_ACIDS.map(({ key }) => profile.values[key]),
    [composition.protein, composition.fat, composition.water],
    ...tail
  ];
});
const aminoDictionaryRows = dictionaries.map(dictionary => JSON.stringify([...dictionary.keys()]));
writeGenerated(aminoPageDir + '/referenceSamples.js',
  '// 由 npm run build:search 生成。\nmodule.exports = [\n'
  + aminoDictionaryRows.join(',\n') + ',[\n' + aminoSamples.map(row => JSON.stringify(row)).join(',\n') + '\n]];\n');
// 服务端复用页面现有的纯计算源，不复制另一套营养和剩奶算法。
for (const file of ['dailySummaryV2Utils.js', 'feedingRecordV2Utils.js', 'formulaPowderUtils.js', 'nutritionProvenance.js', 'growthChartUtils.js']) {
  const body = fs.readFileSync(path.join(root, 'miniprogram/utils', file), 'utf8').replace(/require\('\.\/search-core\//g, "require('../search/");
  writeGenerated('cloudfunctions/searchManager/lib/intake/' + file, body);
}
for (const file of ['recipeProtein.js', 'proteinComposition.js']) {
  writeGenerated('cloudfunctions/rebuildDailySummaryV2/lib/search/' + file, fs.readFileSync(path.join(root, 'packages/search-core', file)));
}
writeGenerated('cloudfunctions/rebuildDailySummaryV2/lib/nutritionProvenance.js', fs.readFileSync(path.join(root, 'miniprogram/utils/nutritionProvenance.js'), 'utf8'));
writeGenerated('cloudfunctions/searchManager/lib/config/milkCategoryTags.js', fs.readFileSync(path.join(root, 'miniprogram/config/milkCategoryTags.js'), 'utf8'));
if (fs.existsSync(path.join(root, 'packages/ai-access-core'))) copy('packages/ai-access-core', ['cloudfunctions/searchManager/lib/ai', 'cloudfunctions/recognizeNutritionLabel/lib/ai', 'cloudfunctions/featureFlagManager/lib/ai', 'cloudfunctions/syncAiModelQuota/lib/ai', 'cloudfunctions/recognizeReportCustom/lib/ai']);
// 识别额度的用户文案与错误分类在前端、独立云函数之间保持同源。
writeGenerated('miniprogram/utils/recognitionErrors.js', fs.readFileSync(path.join(root, 'packages/ai-access-core/recognitionErrors.js')));
writeGenerated('cloudfunctions/recognizeReportCustom/lib/config/reportTypes.js', fs.readFileSync(path.join(root, 'miniprogram/constants/reportTypes.js')));
// 模型目标名单、云端名称校验与前端解析使用同一份纯规则，避免三处词典漂移。
writeGenerated('cloudfunctions/recognizeReportCustom/lib/report/reportNumeric.js', fs.readFileSync(path.join(root, 'miniprogram/utils/reportNumeric.js')));
writeGenerated('cloudfunctions/recognizeReportCustom/lib/report/reportUnits.js', fs.readFileSync(path.join(root, 'miniprogram/utils/reportUnits.js')));
writeGenerated('cloudfunctions/recognizeReportCustom/lib/report/reportReferenceRange.js', fs.readFileSync(path.join(root, 'miniprogram/utils/reportReferenceRange.js')));
writeGenerated('cloudfunctions/recognizeReportCustom/lib/report/reportModel.js', fs.readFileSync(path.join(root, 'miniprogram/models/report.js'), 'utf8')
  .replace(/require\('\.\.\/utils\/reportNumeric'\)/g, "require('./reportNumeric')"));
for (const file of ['reportIndicatorLexicon.js', 'reportRecognitionRules.js']) {
  const source = fs.readFileSync(path.join(root, 'miniprogram/pkg-report/utils', file), 'utf8')
    .replace(/require\('\.\.\/\.\.\/models\/report'\)/g, "require('./reportModel')")
    .replace(/require\('\.\.\/\.\.\/utils\/reportUnits'\)/g, "require('./reportUnits')");
  writeGenerated('cloudfunctions/recognizeReportCustom/lib/report/' + file, source);
}
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
