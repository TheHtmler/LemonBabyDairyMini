'use strict';
const crypto = require('crypto');
const { fail } = require('./lib/search');
const { hash } = require('./access');
function requireSecret(secret) { if (typeof secret !== 'string' || secret.length < 32) fail('CONFIG_MISSING', '搜索服务尚未配置，请稍后再试'); }
function sign(body, secret) { return crypto.createHmac('sha256', secret).update(body).digest('hex'); }
function encodeCursor(state, secret) {
  requireSecret(secret);
  const body = Buffer.from(JSON.stringify(state)).toString('base64url'); return body + '.' + sign(body, secret);
}
function decodeCursor(token, expected, secret) {
  requireSecret(secret);
  if (typeof token !== 'string' || token.length > 4096) fail('INVALID_CURSOR', '搜索分页无效，请重新搜索');
  const [body, signature, extra] = token.split('.');
  if (extra || !/^[a-f0-9]{64}$/.test(signature || '') || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(body, secret)))) fail('INVALID_CURSOR', '搜索分页无效，请重新搜索');
  let value; try { value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (_) { fail('INVALID_CURSOR', '搜索分页无效，请重新搜索'); }
  if (!value || !/^[a-f0-9]{64}$/.test(value.id || '') || value.owner !== hash([expected.openid, expected.babyUid]) || value.queryHash !== expected.queryHash || value.version !== '1:2:2' || !Number.isInteger(value.page) || value.page < 0 || !Number.isFinite(value.expiresAt) || value.expiresAt <= expected.now) fail('STALE_CURSOR', '搜索已过期或条件已改变，请重新搜索');
  return value;
}
module.exports = { encodeCursor, decodeCursor, requireSecret };
