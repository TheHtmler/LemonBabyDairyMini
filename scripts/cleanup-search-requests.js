'use strict';
const fs = require('fs');
const COLLECTIONS = ['ai_search_requests', 'ai_usage_counters', 'search_query_sessions'];
function buildSearchCleanupPlan(exported, now = Date.now()) {
  const result = {};
  for (const collection of COLLECTIONS) {
    const rows = exported[collection] || [];
    if (!Array.isArray(rows)) throw new Error('集合导出必须为数组：' + collection);
    result[collection] = rows.filter(x => /^[a-f0-9]{64}$/.test(x._id || '') && new Date(x.expiresAt).getTime() <= now && !(x.leaseUntil > now)).map(x => x._id);
  }
  return result;
}
async function main(argv) {
  const input = argv[argv.indexOf('--input') + 1];
  if (!argv.includes('--input') || !input || input.startsWith('--')) throw new Error('请用 --input 指定本地集合导出 JSON，默认仅预览');
  const plan = buildSearchCleanupPlan(JSON.parse(fs.readFileSync(input, 'utf8')));
  process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
  if (!argv.includes('--apply')) return;
  const env = argv[argv.indexOf('--env') + 1];
  if (!argv.includes('--env') || !env || env.startsWith('--')) throw new Error('实际清理必须明确 --env');
  const db = require('@cloudbase/node-sdk').init({ env }).database();
  for (const collection of COLLECTIONS) for (const id of plan[collection]) {
    await db.runTransaction(async tx => {
      const response = await tx.collection(collection).doc(id).get();
      const actual = Array.isArray(response.data) ? response.data[0] : response.data;
      if (actual && buildSearchCleanupPlan({ [collection]: [actual] })[collection].includes(id)) await tx.collection(collection).doc(id).remove();
    });
  }
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
module.exports = { buildSearchCleanupPlan };
