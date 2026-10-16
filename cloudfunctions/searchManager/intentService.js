'use strict';
const { normalizeModelPlan, shanghaiDate, fail } = require('./lib/search');
const { hash } = require('./access');
const { requireAiPolicy, reserveInvocation, markDispatched, completeInvocation } = require('./lib/ai');
const { callIntentModel, configFor } = require('./modelClient');
async function interpretQuery({ db, accessContext, query, requestId, now = Date.now(), env = process.env, modelClient = callIntentModel }) {
  if (typeof query !== 'string' || !query.trim() || query.length > 300) fail('INVALID_QUERY', '请输入 1 至 300 字的搜索内容');
  const text = query.trim(); const policy = requireAiPolicy({ scene: 'search', env });
  configFor(env, policy);
  const reservation = await reserveInvocation({ db, ...accessContext, scene: 'search', requestId, requestHash: hash([text, 1, shanghaiDate(now)]), now, dailyLimit: policy.dailyLimit });
  if (reservation.state === 'cached') return reservation.result;
  let dispatched = false; let model;
  try {
    await markDispatched(db, reservation); dispatched = true;
    model = await modelClient({ query: text, policy, env, deadline: now + 10000 });
    let queryPlan;
    try { queryPlan = normalizeModelPlan(model.plan); }
    catch (_) { fail('INVALID_MODEL_RESULT', '暂时没理解这句话，请缩短描述或调整筛选条件'); }
    const result = { ok: true, queryPlan, model: model.model };
    await completeInvocation({ db, reservation, result, dispatched, usage: model.usage });
    return result;
  } catch (error) {
    await completeInvocation({ db, reservation, error, dispatched, usage: model && model.usage || error.usage || null }).catch(() => {});
    throw error;
  }
}
module.exports = { interpretQuery };
