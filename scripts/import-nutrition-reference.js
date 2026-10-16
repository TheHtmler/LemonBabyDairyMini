'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { normalizeReferenceRecord } = require('../packages/nutrition-recognition-core/reference');
const { REQUIRED } = require('../packages/nutrition-recognition-core/contracts');
const { adaptChinaFoodTable } = require('./nutrition-reference-adapters/china-food-table');
const { adaptUsdaFdc } = require('./nutrition-reference-adapters/usda-fdc');
const { adaptVerifiedCatalog } = require('./nutrition-reference-adapters/verified-catalog');
const { getDocument, transaction } = require('../packages/nutrition-recognition-core/server');

function buildReferenceImport(rawRecords, options) {
  const adapters = { usda_fdc: adaptUsdaFdc, china_food_table: adaptChinaFoodTable,
    manufacturer: adaptVerifiedCatalog, verified_catalog: adaptVerifiedCatalog };
  const adapter = adapters[options.provider];
  if (!adapter) throw new Error('参考数据提供方无效');
  const records = []; const rejected = []; const seen = new Set();
  for (const raw of rawRecords) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      rejected.push({ recordId: '', name: '', reasons: ['记录不是有效对象'] });
      continue;
    }
    const id = String(raw.fdcId || raw.foodCode || raw.sourceFoodCode || raw.recordId || (raw.origin || {}).foodCode || '');
    const adapted = adapter(raw, (options.identityMap || {})[id] || {});
    const record = normalizeReferenceRecord(adapted, options);
    const reasons = [];
    if (!id || !record.identity.name) reasons.push('缺少记录ID或名称');
    if (!record.source.verified) reasons.push('未确认来源及使用范围');
    if (!(record.basis.quantity > 0) || !['g', 'ml'].includes(record.basis.unit)) reasons.push('计量基准未核验');
    if (['unknown', 'other'].includes(record.identity.preparation)) reasons.push('制备状态未确认');
    if (!['food', 'dry_powder', 'prepared_formula'].includes(record.basis.material)) reasons.push('物料口径未核验');
    if (record.basis.material === 'dry_powder' && record.identity.preparation !== 'dry_powder') reasons.push('奶粉状态与口径不一致');
    if (record.basis.material === 'prepared_formula' && record.identity.preparation !== 'prepared_formula') reasons.push('冲调状态与口径不一致');
    if (REQUIRED.some(field => record.nutrients[field].state !== 'present')) reasons.push('必需营养字段缺失或未核验');
    if (seen.has(record.referenceId)) reasons.push('同来源及版本出现重复记录');
    if (reasons.length) rejected.push({ recordId: id, name: record.identity.name, reasons });
    else {
      seen.add(record.referenceId);
      records.push({ ...record, _id: crypto.createHash('sha256').update(record.referenceId).digest('hex'),
        normalizedName: record.identity.name.toLowerCase().replace(/\s/g, ''),
        searchTerms: [record.identity.name].concat(record.identity.aliases).map(x => x.toLowerCase().replace(/\s/g, '')),
        status: 'active' });
    }
  }
  return { records, rejected, report: { input: rawRecords.length, accepted: records.length, rejected: rejected.length,
    provider: options.provider, version: options.version, generatedAt: new Date().toISOString() } };
}

function args(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (['--publish', '--usage-verified'].includes(key)) result[key.slice(2)] = true;
    else if (key.startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) result[key.slice(2)] = argv[++i];
    else throw new Error('命令参数无效：' + key);
  }
  return result;
}

async function main(argv) {
  const config = args(argv);
  if (!['china_food_table', 'usda_fdc', 'manufacturer', 'verified_catalog'].includes(config.provider) || !config.input || !config.version ||
      !config['source-url'] || !config.output) {
    throw new Error('请提供 --provider china_food_table|usda_fdc|manufacturer|verified_catalog --input --version --source-url --output；默认仅生成预览');
  }
  const url = new URL(config['source-url']);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('参考来源必须是不含凭证的可追溯HTTPS地址');
  const source = JSON.parse(fs.readFileSync(config.input, 'utf8'));
  const rows = Array.isArray(source) ? source :
    source.FoundationFoods || source.SRLegacyFoods || source.BrandedFoods || source.foods;
  if (!Array.isArray(rows)) throw new Error('输入必须是记录数组或USDA下载JSON');
  const identityMap = config['identity-map'] ? JSON.parse(fs.readFileSync(config['identity-map'], 'utf8')) : {};
  const output = buildReferenceImport(rows, { provider: config.provider, version: config.version,
    sourceUrl: url.href, usageVerified: config['usage-verified'] === true, identityMap });
  fs.writeFileSync(config.output, JSON.stringify(output, null, 2) + '\n');
  process.stdout.write(JSON.stringify(output.report) + '\n');
  if (config.publish) {
    if (!config.env || !config['usage-verified'] || !output.records.length || output.rejected.length) {
      throw new Error('发布要求明确环境、已核验使用范围、有效记录且无拒绝项；质量报告已保存');
    }
    const app = require('@cloudbase/node-sdk').init({ env: config.env });
    const db = app.database();
    for (const record of output.records) {
      await transaction(db, async tx => {
        const stored = await getDocument(tx, 'nutrition_reference', record._id);
        if (stored) {
          if (['nutrients', 'identity', 'basis', 'source'].some(key => JSON.stringify(stored[key]) !== JSON.stringify(record[key]))) {
            throw new Error('已发布版本不可覆盖，请更换版本：' + record.referenceId);
          }
        } else {
          const { _id, ...data } = record;
          await tx.collection('nutrition_reference').doc(_id).set(data);
        }
      });
    }
    process.stdout.write('参考版本已发布：' + output.records.length + '条\n');
  }
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
  process.stderr.write(error.message + '\n'); process.exitCode = 1;
});
module.exports = { buildReferenceImport, main };
