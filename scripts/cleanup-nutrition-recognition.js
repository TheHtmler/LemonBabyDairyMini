'use strict';
const fs = require('fs');
const { hash } = require('../packages/nutrition-recognition-core/server');

function isOwnedFile(session, id) {
  try {
    const url = new URL(id); const path = decodeURIComponent(url.pathname.slice(1));
    return url.protocol === 'cloud:' && session.env && (url.hostname === session.env || url.hostname.startsWith(session.env + '.')) &&
      !url.search && !url.hash && (session.filePaths || []).includes(path) &&
      path.startsWith('nutrition_recognition/' + session.ownerOpenid + '/' + session.babyUid + '/');
  } catch (_) { return false; }
}

function buildRecognitionCleanupPlan(sessions, now = Date.now()) {
  const incomplete = []; const compact = [];
  const expired = sessions.filter(x => {
    const isExpired = x._id === hash(x.ownerOpenid + ':' + x.babyUid + ':' + x.requestId) &&
      Number.isFinite(new Date(x.expiresAt).getTime()) && new Date(x.expiresAt).getTime() <= now;
    if (!isExpired || x.confirmation && x.confirmation.state === 'processing' && x.confirmation.leaseUntil > now) return false;
    if ((x.filePaths || []).length !== (x.fileIDs || []).length || (x.fileIDs || []).some(id => !isOwnedFile(x, id))) {
      incomplete.push(x._id); return false;
    }
    if (x.receiptExpiresAt && new Date(x.receiptExpiresAt).getTime() > now) { if (!x.compactedAt) compact.push(x); return false; }
    return true;
  });
  const fileIDs = expired.concat(compact).flatMap(session => (session.fileIDs || []).filter(id => isOwnedFile(session, id)));
  return { compactSessionIds: compact.map(x => x._id), expiredSessionIds: expired.map(x => x._id), recognitionFileIds: [...new Set(fileIDs)],
    incompleteSessionIds: incomplete,
    retainedSessionIds: sessions.filter(x => !expired.includes(x)).map(x => x._id) };
}

async function main(argv) {
  const input = argv[argv.indexOf('--input') + 1];
  if (!argv.includes('--input') || !input || input.startsWith('--')) throw new Error('请提供本地草稿导出JSON：--input；默认仅预览');
  const sessions = JSON.parse(fs.readFileSync(input, 'utf8'));
  if (!Array.isArray(sessions)) throw new Error('草稿导出必须为数组');
  const plan = buildRecognitionCleanupPlan(sessions);
  process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
  if (!argv.includes('--apply')) return;
  const env = argv[argv.indexOf('--env') + 1];
  if (!argv.includes('--env') || !env || env.startsWith('--')) throw new Error('实际清理需明确 --env');
  const app = require('@cloudbase/node-sdk').init({ env });
  const db = app.database();
  for (const id of [...plan.expiredSessionIds, ...plan.compactSessionIds]) {
    const result = await db.collection('nutrition_recognition_sessions').doc(id).get();
    const actual = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!actual) continue;
    const current = buildRecognitionCleanupPlan([actual]);
    if (!current.expiredSessionIds.length && !current.compactSessionIds.length) continue;
    if (actual.env !== env) throw new Error('草稿不属于指定环境，停止清理');
    if (current.recognitionFileIds.length) {
      const removed = await app.deleteFile({ fileList: current.recognitionFileIds });
      if (removed.code || !removed.fileList || removed.fileList.length !== current.recognitionFileIds.length ||
          removed.fileList.some(x => x.code !== 'SUCCESS')) throw new Error('图片清理未完成，保留草稿以便再次清理');
    }
    await db.runTransaction(async tx => {
      const response = await tx.collection('nutrition_recognition_sessions').doc(id).get();
      const latest = Array.isArray(response.data) ? response.data[0] : response.data;
      const rechecked = latest && buildRecognitionCleanupPlan([latest]);
      if (!rechecked) return;
      if (rechecked.compactSessionIds.length) {
        const receipt = { compactedAt: new Date() };
        ['ownerOpenid', 'babyUid', 'requestId', 'env', 'expiresAt', 'receiptExpiresAt', 'status', 'operationId', 'savedResult', 'confirmation'].forEach(key => { if (latest[key] !== undefined) receipt[key] = latest[key]; });
        if (receipt.savedResult) receipt.savedResult = Object.fromEntries(['targetType', 'itemId', 'profileId', 'version'].filter(key => receipt.savedResult[key] !== undefined).map(key => [key, receipt.savedResult[key]]));
        await tx.collection('nutrition_recognition_sessions').doc(id).set(receipt);
      } else if (rechecked.expiredSessionIds.length) await tx.collection('nutrition_recognition_sessions').doc(id).remove();
    });
  }
}
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  process.stderr.write(error.message + '\n'); process.exitCode = 1;
});
module.exports = { buildRecognitionCleanupPlan };
