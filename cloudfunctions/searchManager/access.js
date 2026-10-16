'use strict';
const { fail } = require('./lib/search');
const crypto = require('crypto');
function hash(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
async function getDocument(db, collection, id) {
  try { const r = await db.collection(collection).doc(id).get(); return Array.isArray(r.data) ? r.data[0] || null : r.data || null; }
  catch (e) { if (/DOCUMENT_NOT_FOUND|DOCUMENT_NOT_EXIST/.test(String(e.code)) || /document.*not.*exist|document.*not.*found/i.test(e.message || '')) return null; throw e; }
}
async function transaction(db, action) { return db.runTransaction(action); }
async function assertSearchAccess(db, openid, babyUid) {
  if (!openid || typeof babyUid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(babyUid)) fail('FORBIDDEN', '请先选择有权限访问的宝宝');
  for (const name of ['baby_creators', 'baby_participants']) {
    const r = await db.collection(name).where({ _openid: openid, babyUid }).limit(1).get();
    if ((r.data || []).length) return { openid, babyUid, role: name === 'baby_creators' ? 'creator' : 'participant' };
  }
  fail('FORBIDDEN', '已无权访问该宝宝，请重新选择');
}
function visibleFood(doc, babyUid) { return doc.sourceType === 'system' || doc.ownerType === 'system' || doc.isSystem === true || doc.babyUid === babyUid || (Array.isArray(doc.sharedBabyUids) && doc.sharedBabyUids.includes(babyUid)); }
function active(doc) { return !!doc && (!doc.status || doc.status === 'active') && !doc.deletedAt; }
module.exports = { hash, getDocument, transaction, assertSearchAccess, visibleFood, active };
