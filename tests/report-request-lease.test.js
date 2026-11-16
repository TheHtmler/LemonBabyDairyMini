const test = require('node:test');
const assert = require('node:assert/strict');
const { reserveInvocation } = require('../packages/ai-access-core/usage');

function memoryDatabase() {
  const documents = new Map();
  const db = {
    runTransaction: action => action(db),
    collection: name => ({ doc: id => ({
      get: async () => ({ data: documents.get(name + '/' + id) }),
      set: async data => { documents.set(name + '/' + id, data); }
    }) })
  };
  return { db, documents };
}

test('报告处理超过60秒仍为处理中，不重复扣取业务次数', async () => {
  const { db, documents } = memoryDatabase();
  const options = { db, openid: 'owner', babyUid: 'baby', scene: 'report', requestId: 'report_timeout_001',
    requestHash: 'same-images', dailyLimit: 5, now: 1000, leaseMs: 150000 };
  await reserveInvocation(options);
  await assert.rejects(reserveInvocation({ ...options, now: 62000 }), { code: 'AI_RUNNING' });
  const counter = [...documents].find(([key]) => key.startsWith('ai_usage_counters/'))[1];
  assert.equal(counter.count, 1);
});

test('未指定延长时间的其他场景保持原来的请求有效期', async () => {
  const { db } = memoryDatabase();
  const options = { db, openid: 'owner', babyUid: 'baby', scene: 'scan', requestId: 'scan_timeout_001',
    requestHash: 'same-images', dailyLimit: 5, now: 1000 };
  await reserveInvocation(options);
  await assert.rejects(reserveInvocation({ ...options, now: 62000 }), { code: 'AI_UNKNOWN' });
});
