'use strict';
const crypto = require('crypto');
const { fail } = require('./lib/search');
const { hash, getDocument } = require('./access');
const { requireSecret } = require('./cursor');
const COLLECTION = 'search_query_sessions';
function signature(body, secret) { return crypto.createHmac('sha256', secret).update('search-context-v2:' + body).digest('hex'); }
function createContextRepository({ db, accessContext, secret, now }) {
  requireSecret(secret); const owner = hash([accessContext.openid, accessContext.babyUid]);
  async function load(token) {
    if (typeof token !== 'string' || token.length > 1024) fail('INVALID_CONTEXT', '搜索上下文无效，请重新输入问题');
    const parts = token.split('.'); const [id, sign] = parts;
    if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(sign) || !crypto.timingSafeEqual(Buffer.from(sign), Buffer.from(signature(id + ':' + owner, secret)))) fail('INVALID_CONTEXT', '宝宝或账号已变化，请重新输入问题');
    const context = await getDocument(db, COLLECTION, id);
    if (!context || context.kind !== 'context' || context.owner !== owner || new Date(context.expiresAt).getTime() <= now) fail('EXPIRED_CONTEXT', '上次搜索已过期，请重新说明要查的对象');
    return context;
  }
  async function save(value, previous) {
    const id = crypto.randomBytes(32).toString('hex');
    const history = [...(previous && previous.history || []), { operation: value.draft.operation, domain: value.draft.domain, entityMentions: value.draft.entityMentions, measure: value.draft.measure, periods: value.draft.periods }].slice(-6);
    await db.collection(COLLECTION).doc(id).set({ ...value, kind: 'context', owner, history, expiresAt: new Date(now + 1800000) });
    return id + '.' + signature(id + ':' + owner, secret);
  }
  function challenge(slot, message, options = [], input = null) {
    return { id: crypto.randomBytes(16).toString('hex'), slot, message,
      options: options.map(option => ({ id: crypto.randomBytes(12).toString('hex'), label: option.label, value: option.value })), ...(input ? { input } : {}) };
  }
  function selection(context, value) {
    const question = context.question;
    if (!question || !value || value.challengeId !== question.id) fail('INVALID_CONTEXT', '这个选择已失效，请重新搜索');
    if (question.input && value.value !== undefined) {
      if (question.slot !== 'threshold' || typeof value.value !== 'number' || !Number.isFinite(value.value) || value.value < 0 || value.value > 1000000) fail('INVALID_QUERY', '请输入有效的营养数值');
      return { slot: question.slot, value: value.value };
    }
    const choice = question.options.find(option => option.id === value.choiceId);
    if (!choice) fail('INVALID_CONTEXT', '请选择当前问题提供的选项');
    return { slot: question.slot, value: choice.value };
  }
  async function cached(requestId, requestHash) {
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) fail('INVALID_QUERY', '搜索请求标识无效');
    const id = hash(['search-v2-request', owner, requestId]);
    const row = await getDocument(db, COLLECTION, id);
    if (row && new Date(row.expiresAt).getTime() > now) {
      if (row.requestHash !== requestHash) fail('REQUEST_CONFLICT', '请重新提交本次搜索');
      return row.result;
    }
    return null;
  }
  async function remember(requestId, requestHash, result) {
    await db.collection(COLLECTION).doc(hash(['search-v2-request', owner, requestId])).set({ kind: 'search_response_v2', owner, requestHash, result, expiresAt: new Date(now + 1800000) });
  }
  function pageToken(contextToken, planId, offset) {
    const body = Buffer.from(JSON.stringify({ context: hash(contextToken), planId, offset, expiresAt: now + 1800000 })).toString('base64url');
    return body + '.' + signature('page:' + body + ':' + owner, secret);
  }
  function pageOffset(token, contextToken, planId) {
    if (typeof token !== 'string' || token.length > 2048) fail('INVALID_CURSOR', '搜索分页无效');
    const [body, sign, extra] = token.split('.');
    if (extra || !/^[a-f0-9]{64}$/.test(sign || '') || !crypto.timingSafeEqual(Buffer.from(sign), Buffer.from(signature('page:' + body + ':' + owner, secret)))) fail('INVALID_CURSOR', '搜索分页无效');
    let value; try { value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (_) { fail('INVALID_CURSOR', '搜索分页无效'); }
    if (value.context !== hash(contextToken) || value.planId !== planId || !Number.isInteger(value.offset) || value.offset < 0 || value.offset > 50000 || value.expiresAt <= now) fail('STALE_CURSOR', '搜索条件已变化，请重新查询');
    return value.offset;
  }
  return { load, save, challenge, selection, cached, remember, pageToken, pageOffset };
}
module.exports = { createContextRepository };
