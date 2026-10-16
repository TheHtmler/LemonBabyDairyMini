'use strict';
const crypto = require('crypto');
const { validateQueryPlan, resolvePeriod, businessDate, matchCandidate, rankCatalogCandidate, fail } = require('./lib/search');
const { hash, getDocument } = require('./access');
const repository = require('./repository');
const sessions = require('./querySessionRepository');
const { requireSecret, encodeCursor, decodeCursor } = require('./cursor');
const { attachAnswers } = require('./answerService');

function publicCandidate(candidate) { const { ref, deleted, searchText, aliases, ...value } = candidate; return value; }
function profileSummary(doc) { return { _id: doc._id, updatedAt: doc.updatedAt || null, createdAt: doc.createdAt || null, formulaPowders: (doc.formulaPowders || []).map(x => ({ status: x.status || 'active', deletedAt: x.deletedAt || null })) }; }
async function executeSearch({ db, accessContext, queryPlan, cursor: token, pageSize = 20, now = Date.now(), secret }) {
  requireSecret(secret);
  const query = validateQueryPlan(queryPlan);
  if (query.status !== 'ready') return { items: [], nextCursor: null, scanComplete: true, partial: false, warnings: [query.reasonCode], queryPlan: query, effectivePeriod: null, excludedScopes: [] };
  if (query.intent === 'navigate_feature') fail('INVALID_QUERY', '功能入口请使用功能分类');
  const queryHash = hash(query); const owner = hash([accessContext.openid, accessContext.babyUid]);
  const limit = Number.isInteger(pageSize) ? Math.min(20, Math.max(1, pageSize)) : 20;
  const cursor = token ? decodeCursor(token, { ...accessContext, queryHash, now }, secret) : {
    id: crypto.randomBytes(32).toString('hex'), owner, queryHash, version: '1:2:2', page: 0, expiresAt: now + 1800000 };
  const initial = token ? null : { kind: 'state', sessionId: cursor.id, owner, queryHash, query,
    period: resolvePeriod(query.period, now), expiresAt: new Date(cursor.expiresAt), nextPage: 0,
    positions: Object.fromEntries(repository.sourceNames(query).map(name => [name, { exhausted: false, frontier: '' }])), warnings: [] };
  const started = await sessions.beginPage(db, cursor, initial, now);
  if (started.cached) return started.cached;
  const state = started.state; const warnings = new Set((state.warnings || []).filter(x => x !== 'source_unavailable')); const history = query.intent !== 'search_catalog';
  let reads = 0; let processed = 0; const deadline = Date.now() + 15000;
  const cache = new Map(); const batches = new Map(); const unavailable = new Set();
  try {
    let running = true;
    while (running && reads < 160 && processed < 180 && Date.now() < deadline) {
      running = false;
      for (const [source, position] of Object.entries(state.positions)) {
        if (position.exhausted || unavailable.has(source) || reads >= 160 || processed >= 180 || Date.now() >= deadline) continue;
        running = true;
        let doc;
        try {
          if (position.headId) {
            const key = source + ':' + position.headId;
            if (cache.has(key)) doc = cache.get(key);
            else { reads++; doc = await getDocument(db, repository.SOURCES[source].collection, position.headId); cache.set(key, doc); }
            if (!doc) { position.headId = ''; position.offset = 0; warnings.add('record_changed'); continue; }
          } else {
            let documents = batches.get(source);
            if (!documents || !documents.length) {
              const batch = await repository.scanSource({ db, accessContext, query, period: state.period, source, position,
                readLimit: Math.min(40, 160 - reads) });
              reads += batch.readCount;
              documents = batch.documents;
              batches.set(source, documents);
              documents.forEach(value => cache.set(source + ':' + value._id, value));
            }
            if (!documents.length) {
              if (source === 'privatePowder' && position.profile && !position.profileExpanded) {
                position.profileExpanded = true; position.headId = position.profile._id; position.offset = 0; continue;
              }
              position.exhausted = true; continue;
            }
            doc = documents.shift();
            // 仅推进已处理文档的边界；预算用尽时，未处理的批量结果会在下一页重新读取。
            position.afterId = doc._id;
            if (repository.SOURCES[source].history) position.afterDate = doc.date instanceof Date ? doc.date.toISOString() : doc.date;
            if (source === 'privatePowder' && !position.profileExpanded) {
              const summary = profileSummary(doc);
              if (!position.profile || repository.compareProfile(summary, position.profile) > 0) position.profile = summary;
              continue;
            }
            position.headId = doc._id; position.offset = 0; position.frontier = history ? businessDate(doc.date) : 'catalog';
            cache.set(source + ':' + doc._id, doc);
          }
          const members = repository.members(doc, source);
          if (position.offset >= members.length) {
            position.headId = ''; position.offset = 0;
            if (source === 'privatePowder' && position.profileExpanded) position.exhausted = true;
            continue;
          }
          const member = members[position.offset];
          if (source.startsWith('legacy') && !member.legacyFeeding && (member.id || member._id)) {
            reads++;
            if (await repository.migratedLegacy(db, doc, member)) { position.offset++; processed++; continue; }
          }
          const candidate = repository.normalizeCandidate(doc, source, position.offset, accessContext.babyUid);
          if (candidate) {
            const matched = matchCandidate(candidate, query);
            if (matched.state === 'unknown') matched.reasons.forEach(x => warnings.add(x === 'recipe_density_unsupported' ? x : 'missing_comparable_nutrition'));
            if (matched.state === 'matched') await sessions.saveCandidate(db, cursor.id, candidate, rankCatalogCandidate(candidate, query.keyword), cursor.expiresAt);
          }
          position.offset++; processed++;
        } catch (error) {
          // 失败来源不能标记为结束；本页保留边界，下次继续读取。
          warnings.add('source_unavailable'); unavailable.add(source);
        }
      }
    }
    const rows = await sessions.pendingCandidates(db, state, history, Math.min(limit, 200 - reads), unavailable);
    const items = []; const consumed = [];
    for (const row of rows) {
      if (reads >= 200) break;
      reads++;
      const candidate = await repository.readCandidate(db, accessContext, row.ref);
      consumed.push(row);
      if (candidate && matchCandidate(candidate, query).state === 'matched') {
        items.push({ ...publicCandidate(candidate), matchRank: rankCatalogCandidate(candidate, query.keyword) });
      }
      else warnings.add('record_changed');
    }
    const sourcesDone = Object.values(state.positions).every(x => x.exhausted);
    // 此查询只统计临时候选，不扫描业务原始记录。
    const remaining = sourcesDone ? await db.collection(sessions.COLLECTION).where({ kind: 'candidate', sessionId: cursor.id, emitted: false }).count() : null;
    const complete = sourcesDone && Number(remaining.total) <= consumed.length;
    if (query.conditions.length && query.scope.includes('recipe')) warnings.add('recipe_density_unsupported');
    state.warnings = [...warnings];
    const answeredItems = await attachAnswers({ db, accessContext, items, query, period: state.period, now });
    const result = { items: answeredItems, nextCursor: complete ? null : encodeCursor({ ...cursor, page: cursor.page + 1 }, secret), scanComplete: complete,
      partial: !complete || warnings.has('source_unavailable'), warnings: [...warnings], queryPlan: query, effectivePeriod: state.period,
      excludedScopes: query.conditions.length && query.scope.includes('recipe') ? ['recipe'] : [] };
    return await sessions.finishPage(db, cursor, state, consumed, result, started.lease);
  } catch (error) {
    // 当前页没有提交，保留原游标；租约到期后可安全重放，候选 ID 保证幂等。
    throw error;
  }
}
module.exports = { executeSearch, publicCandidate };
