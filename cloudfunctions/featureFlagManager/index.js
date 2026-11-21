const crypto = require('crypto');
const cloud = require('wx-server-sdk');
const { NUTRITION_QUOTA_KEY, REPORT_QUOTA_KEY, isDailyLimit, readNutritionQuota, readReportQuota } = require('./lib/ai/nutritionQuota');
const { getModelAdminView, readDocument, saveModelConfig } = require('./lib/ai/modelRegistry');
const { syncModelQuota } = require('./lib/ai/quotaSync');
const SEARCH_SCAN_KEYS = ['home_search_enabled', 'ai_search_enabled', 'nutrition_scan_enabled'];

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const FEATURE_FLAG_COLLECTION = 'feature_flags';
const REPORT_OCR_ACCESS_KEY = 'report_ocr_access';
const HOME_RELEASE_NOTICE_KEY = 'home_release_notice';
const NOTICE_ENTRY_PREFIX = 'home-notice-';
const NOTICE_ENTRY_ID = /^home-notice-\d{12}$/;
const NOTICE_PAGE_SIZE = 20;
const DEFAULT_MESSAGE = '拍照识别功能调试中，仅对白名单用户开放';
const DEFAULT_RELEASE_NOTICE_TEXT = '看板已升级：聚焦今日营养达成、喂养进度与用药打卡，明细请到「数据记录」查看。';
const DEVELOPER_OPENIDS = [
  'oYCao7fijm22dyl6C-tcYJo_G69A'
];

function normalizeOpenid(value = '') {
  return String(value || '').trim();
}

function parseDeveloperOpenids() {
  const fromEnv = String(process.env.DEVELOPER_OPENIDS || '')
    .split(',')
    .map(normalizeOpenid)
    .filter(Boolean);
  return Array.from(new Set([...DEVELOPER_OPENIDS, ...fromEnv]));
}

function isDeveloperOpenid(openid = '') {
  return parseDeveloperOpenids().includes(normalizeOpenid(openid));
}

function normalizeOpenids(openids = []) {
  const source = Array.isArray(openids)
    ? openids
    : String(openids || '').split(/[\n,，\s]+/);
  return Array.from(new Set(source.map(normalizeOpenid).filter(Boolean)));
}

function normalizeScope(scope = '') {
  return scope === 'all' ? 'all' : 'whitelist';
}

function normalizeReportOcrConfig(config = {}) {
  return {
    key: REPORT_OCR_ACCESS_KEY,
    scope: normalizeScope(config.scope),
    allowOpenids: normalizeOpenids(config.allowOpenids),
    message: String(config.message || DEFAULT_MESSAGE).trim() || DEFAULT_MESSAGE
  };
}

async function getReportOcrAccessConfig() {
  const res = await db.collection(FEATURE_FLAG_COLLECTION)
    .where({ key: REPORT_OCR_ACCESS_KEY })
    .limit(1)
    .get();
  const doc = res.data && res.data[0];
  return {
    ...normalizeReportOcrConfig(doc || {}),
    _id: doc?._id || '',
    updatedAt: doc?.updatedAt || null,
    updatedBy: doc?.updatedBy || ''
  };
}

function normalizeHomeReleaseNotice(config = {}) {
  return {
    key: HOME_RELEASE_NOTICE_KEY,
    visible: config.visible !== false,
    text: String(config.text || DEFAULT_RELEASE_NOTICE_TEXT).trim() || DEFAULT_RELEASE_NOTICE_TEXT
  };
}

async function getHomeReleaseNoticeConfig() {
  const res = await db.collection(FEATURE_FLAG_COLLECTION)
    .where({ key: HOME_RELEASE_NOTICE_KEY })
    .limit(1)
    .get();
  const doc = res.data && res.data[0];
  return doc || {};
}

function noticeDate(value) {
  const timestamp = value?.$date ?? value;
  if (timestamp == null || timestamp === '') return null;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function legacyNotice(config) {
  return noticeEntry({
    _id: 'legacy',
    title: config.legacyTitle,
    text: normalizeHomeReleaseNotice({ text: config.legacyText ?? config.text }).text,
    date: config.legacyDate,
    publishedAt: Object.hasOwn(config, 'legacyPublishedAt') ? config.legacyPublishedAt : config.updatedAt,
    revision: config.legacyRevision
  }, true);
}

function validNoticeDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && noticeDate(value)?.slice(0, 10) === value;
}

function noticeEntry(row, legacy = false) {
  const publishedAt = noticeDate(Object.hasOwn(row, 'publishedAt') ? row.publishedAt : row.updatedAt);
  // 旧公告只有保存时间，按中国本地日期归档。
  const localDay = publishedAt && new Date(Date.parse(publishedAt) + 8 * 3600000).toISOString().slice(0, 10);
  return {
    id: row._id, title: row.title || '', text: row.text, publishedAt,
    date: validNoticeDay(row.date) ? row.date : localDay || '',
    revision: Number.isSafeInteger(row.revision) && row.revision >= 0 ? row.revision : 0,
    ...(legacy ? { legacy: true } : {})
  };
}

function noticePosition(entry) {
  return (entry.date || '0000-00-00') + '|' + (entry.legacy ? '000000000000' : entry.id.slice(NOTICE_ENTRY_PREFIX.length));
}

function invalidNotice(message) {
  return Object.assign(new Error(message), { code: 'INVALID_INPUT' });
}

function announcementConflict() {
  return Object.assign(new Error('公告已被修改或删除，请刷新后再操作'), { code: 'CONFIG_CONFLICT' });
}

async function listNoticeEntries(config) {
  const entries = config.legacyDeletedAt ? [] : [legacyNotice(config)];
  const command = db.command;
  let upper = NOTICE_ENTRY_PREFIX + '~';
  // shortcut: 用主键分批读取后按公告日期排序，公告量明显增长时改用日期索引。
  for (;;) {
    const result = await db.collection(FEATURE_FLAG_COLLECTION).where({
      _id: command.gte(NOTICE_ENTRY_PREFIX).and(command.lt(upper))
    }).orderBy('_id', 'desc').limit(100).get();
    const rows = result.data || [];
    for (const row of rows) {
      if (NOTICE_ENTRY_ID.test(row._id) && !row.deletedAt) entries.push(noticeEntry(row));
    }
    if (rows.length < 100) break;
    upper = rows[rows.length - 1]._id;
  }
  return entries.sort((left, right) => {
    const a = noticePosition(left);
    const b = noticePosition(right);
    return a < b ? 1 : a > b ? -1 : 0;
  });
}

async function getHomeReleaseNotice(cursor, admin = false) {
  if (cursor != null && cursor !== '') {
    const date = typeof cursor === 'string' && /^(\d{4}-\d{2}-\d{2})\|\d{12}$/.exec(cursor)?.[1];
    const legacyCursor = typeof cursor === 'string' && NOTICE_ENTRY_ID.test(cursor);
    if (date !== '0000-00-00' && !validNoticeDay(date) && !legacyCursor) {
      throw invalidNotice('公告分页位置无效，请重新加载');
    }
  }
  const config = await getHomeReleaseNoticeConfig();
  const { visible } = normalizeHomeReleaseNotice(config);
  if (!visible && !admin) return { visible, text: '', entries: [], hasMore: false, nextCursor: null };

  const entries = await listNoticeEntries(config);
  if (cursor && NOTICE_ENTRY_ID.test(cursor)) {
    const previous = entries.find(entry => entry.id === cursor);
    if (!previous) throw invalidNotice('公告分页位置无效，请重新加载');
    cursor = noticePosition(previous);
  }
  const remaining = cursor ? entries.filter(entry => noticePosition(entry) < cursor) : entries;
  const page = remaining.slice(0, NOTICE_PAGE_SIZE);
  const nextCursor = remaining.length > NOTICE_PAGE_SIZE ? noticePosition(page[page.length - 1]) : null;
  return {
    visible: admin ? visible : visible && entries.length > 0,
    text: entries[0]?.text || '', entries: page, hasMore: !!nextCursor, nextCursor,
    ...(admin ? { entrySchemaVersion: 2, updatedAt: noticeDate(config.updatedAt), updatedBy: config.updatedBy || '' } : {})
  };
}

function noticeDraft(event) {
  const title = typeof event.title === 'string' ? event.title.trim() : '';
  const text = typeof event.text === 'string' ? event.text.trim() : '';
  if (!validNoticeDay(event.date)) throw invalidNotice('请选择有效公告日期');
  if (!title || !text) throw invalidNotice('请填写公告标题和正文');
  if (title.length > 40 || text.length > 2000) throw invalidNotice('标题最多 40 字，正文最多 2000 字');
  return { date: event.date, title, text };
}

async function updateHomeReleaseNotice(event, operatorOpenid, publish = false) {
  if (!publish && typeof event.visible !== 'boolean') throw invalidNotice('公告显示设置无效');
  const text = typeof event.text === 'string' ? event.text.trim() : '';
  const draft = publish ? noticeDraft(event) : null;
  if (text.length > 2000) throw invalidNotice('正文最多 2000 字');
  if (publish && (typeof event.requestId !== 'string' || !/^[\w-]{8,100}$/.test(event.requestId))) {
    throw invalidNotice('公告提交标识无效');
  }
  const receiptId = publish ? 'home_notice_receipt_' + crypto.createHash('sha256')
    .update(JSON.stringify([operatorOpenid, event.requestId])).digest('hex') : '';
  const fingerprint = receiptId ? crypto.createHash('sha256').update(JSON.stringify([draft.date, draft.title, draft.text])).digest('hex') : '';
  const existing = await getHomeReleaseNoticeConfig();
  const latestText = !publish && typeof event.text === 'string'
    ? (await listNoticeEntries(existing))[0]?.text : undefined;
  const configId = existing._id || HOME_RELEASE_NOTICE_KEY;
  await db.runTransaction(async transaction => {
    const config = await readDocument(transaction, configId);
    const receipt = receiptId ? await readDocument(transaction, receiptId) : null;
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) {
        throw Object.assign(new Error('发布内容已变化，请重新提交'), { code: 'CONFIG_CONFLICT' });
      }
      return;
    }

    const current = normalizeHomeReleaseNotice(config || {});
    const legacy = legacyNotice(config || {});
    const legacyClientText = text || DEFAULT_RELEASE_NOTICE_TEXT;
    const append = publish || (typeof event.text === 'string' && legacyClientText !== current.text && legacyClientText !== latestText);
    const data = {
      ...current, visible: publish ? current.visible : event.visible,
      legacyText: legacy.text, legacyPublishedAt: legacy.publishedAt,
      updatedAt: db.serverDate(), updatedBy: operatorOpenid
    };
    const collection = transaction.collection(FEATURE_FLAG_COLLECTION);
    if (append) {
      const sequence = (config?.noticeSequence ?? 0) + 1;
      if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence >= 1e12) {
        throw Object.assign(new Error('公告记录序号无效'), { code: 'CONFIG_MISSING' });
      }
      const id = NOTICE_ENTRY_PREFIX + String(sequence).padStart(12, '0');
      data.noticeSequence = sequence;
      const entry = draft || { title: '', text: legacyClientText };
      data.text = entry.text;
      await collection.doc(id).set({ data: { ...entry, revision: 0, publishedAt: db.serverDate() } });
      if (receiptId) await collection.doc(receiptId).set({ data: { fingerprint } });
    }
    const doc = collection.doc(configId);
    if (config) await doc.update({ data });
    else await doc.set({ data });
  });
  return getHomeReleaseNotice(null, true);
}

async function manageHomeReleaseNotice(event, operatorOpenid, remove = false) {
  const { id, expectedRevision } = event;
  const legacy = id === 'legacy';
  if ((!legacy && (typeof id !== 'string' || !NOTICE_ENTRY_ID.test(id)))
    || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw invalidNotice('公告管理参数无效，请刷新后再操作');
  }
  const draft = remove ? null : noticeDraft(event);
  const configId = (await getHomeReleaseNoticeConfig())._id || HOME_RELEASE_NOTICE_KEY;
  await db.runTransaction(async transaction => {
    const docId = legacy ? configId : id;
    const row = await readDocument(transaction, docId);
    if (!row && !legacy) throw announcementConflict();
    const entry = legacy ? legacyNotice(row || {}) : noticeEntry(row);
    const deletedAt = legacy ? row?.legacyDeletedAt : row.deletedAt;
    // 超时重试只认可同一版本已经落下的相同结果，不覆盖其他修改。
    if (entry.revision === expectedRevision + 1 && (remove ? deletedAt
      : !deletedAt && entry.date === draft.date && entry.title === draft.title && entry.text === draft.text)) return;
    if (deletedAt || entry.revision !== expectedRevision) throw announcementConflict();

    const revision = entry.revision + 1;
    const updatedAt = db.serverDate();
    const data = legacy ? {
      ...normalizeHomeReleaseNotice(row || {}),
      legacyPublishedAt: entry.publishedAt,
      legacyRevision: revision,
      ...(remove ? { legacyText: entry.text, legacyDeletedAt: updatedAt }
        : { legacyTitle: draft.title, legacyText: draft.text, legacyDate: draft.date }),
      updatedAt, updatedBy: operatorOpenid
    } : {
      ...(remove ? { deletedAt: updatedAt } : draft),
      revision, updatedAt, updatedBy: operatorOpenid
    };
    const doc = transaction.collection(FEATURE_FLAG_COLLECTION).doc(docId);
    if (row) await doc.update({ data });
    else await doc.set({ data });
  });
  return getHomeReleaseNotice(null, true);
}

async function updateReportOcrAccessConfig(event = {}, operatorOpenid = '') {
  const nextConfig = normalizeReportOcrConfig({
    scope: event.scope,
    allowOpenids: event.allowOpenids,
    message: event.message
  });
  const existing = await getReportOcrAccessConfig();
  const data = {
    ...nextConfig,
    updatedAt: db.serverDate(),
    updatedBy: operatorOpenid
  };

  if (existing._id) {
    await db.collection(FEATURE_FLAG_COLLECTION).doc(existing._id).update({ data });
  } else {
    await db.collection(FEATURE_FLAG_COLLECTION).add({ data });
  }

  return await getReportOcrAccessConfig();
}

async function updateDailyQuota(event, operatorOpenid, scene) {
  if (!isDailyLimit(event.dailyLimit) || !Number.isSafeInteger(event.expectedVersion) || event.expectedVersion < 0) {
    throw Object.assign(new Error('每日识别次数须为 0～10000 的整数'), { code: 'INVALID_INPUT' });
  }
  const { key, read } = scene === 'report'
    ? { key: REPORT_QUOTA_KEY, read: readReportQuota }
    : { key: NUTRITION_QUOTA_KEY, read: readNutritionQuota };
  return db.runTransaction(async transaction => {
    const current = await read(transaction);
    // 网络中断后再次保存相同目标值，可直接确认上次保存结果。
    if (current.configured && current.dailyLimit === event.dailyLimit) return current;
    if (current.version !== event.expectedVersion) {
      throw Object.assign(new Error('配置已被其他管理员更新，请重新加载后再保存'), { code: 'CONFIG_CONFLICT' });
    }
    const version = current.version + 1;
    await transaction.collection(FEATURE_FLAG_COLLECTION).doc(key).set({
      data: { key, dailyLimit: event.dailyLimit, version,
        updatedAt: db.serverDate(), updatedBy: operatorOpenid }
    });
    return { dailyLimit: event.dailyLimit, version, configured: true };
  });
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'getReportOcrAccessConfig';

  if (!OPENID) {
    return { ok: false, code: 'MISSING_OPENID', message: '缺少用户身份' };
  }
  try {
    if (action === 'getHomeReleaseNotice') {
      return { ok: true, notice: await getHomeReleaseNotice(event.cursor) };
    }

    if (!isDeveloperOpenid(OPENID)) {
      return { ok: false, code: 'NO_PERMISSION', message: '无权限配置实验功能' };
    }

    if (['getAiModelConfig', 'updateAiModelConfig', 'refreshAiModelQuota', 'refreshAiModelCatalog'].includes(action)) {
      // AI 共享模块统一使用 CloudBase 的直接文档接口，其他开关沿用微信 SDK。
      const env = cloud.getWXContext().ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE;
      if (!env) throw Object.assign(new Error('无法确定当前云环境'), { code: 'CONFIG_MISSING' });
      const modelDb = require('@cloudbase/node-sdk').init({ env }).database();
      const catalogSync = ['getAiModelConfig', 'refreshAiModelCatalog'].includes(action)
        ? await require('./lib/ai/modelCatalogSync').syncModelCatalog(modelDb, process.env, { force: action === 'refreshAiModelCatalog' }) : null;
      if (action === 'updateAiModelConfig') {
        await saveModelConfig(modelDb, event.config && { ...event.config, expectedVersion: event.expectedVersion }, OPENID);
      }
      const sync = action === 'refreshAiModelQuota' ? await syncModelQuota(modelDb, process.env, { force: true }) : null;
      return { ok: true, ...(sync ? { sync } : {}), ...(catalogSync ? { catalogSync } : {}), view: await getModelAdminView(modelDb) };
    }

    if (action === 'updateNutritionQuota' || action === 'updateReportQuota') {
      return { ok: true, config: await updateDailyQuota(event, OPENID, action === 'updateReportQuota' ? 'report' : 'scan') };
    }
    if (action === 'getReportOcrAccessConfig') {
      return {
        ok: true,
        config: await getReportOcrAccessConfig()
      };
    }
    if (action === 'getSearchScanConfig') {
      const configs = {};
      for (const key of SEARCH_SCAN_KEYS) {
        const result = await db.collection(FEATURE_FLAG_COLLECTION).where({ key }).limit(1).get();
        // 与业务端保持一致：没有配置记录时默认向所有授权用户开放。
        const doc = (result.data || [])[0] || { enabled: true, scope: 'all' };
        configs[key] = { enabled: doc.enabled === true, scope: normalizeScope(doc.scope), allowOpenids: normalizeOpenids(doc.allowOpenids) };
      }
      return { ok: true, configs };
    }
    if (action === 'updateSearchScanConfig') {
      if (!SEARCH_SCAN_KEYS.includes(event.key) || typeof event.enabled !== 'boolean' || !['all', 'whitelist'].includes(event.scope)) return { ok: false, code: 'INVALID_INPUT', message: '搜索或扫描开关配置无效' };
      const data = { key: event.key, enabled: event.enabled, scope: event.scope, allowOpenids: normalizeOpenids(event.allowOpenids), updatedBy: OPENID, updatedAt: db.serverDate() };
      const result = await db.collection(FEATURE_FLAG_COLLECTION).where({ key: event.key }).limit(1).get();
      const existing = (result.data || [])[0];
      if (existing) await db.collection(FEATURE_FLAG_COLLECTION).doc(existing._id).update({ data });
      else await db.collection(FEATURE_FLAG_COLLECTION).add({ data });
      return { ok: true };
    }
    if (action === 'updateReportOcrAccessConfig') {
      return {
        ok: true,
        config: await updateReportOcrAccessConfig(event, OPENID)
      };
    }
    if (action === 'getHomeReleaseNoticeConfig') {
      return {
        ok: true,
        notice: await getHomeReleaseNotice(event.cursor, true)
      };
    }
    if (action === 'updateHomeReleaseNotice') {
      return {
        ok: true,
        notice: await updateHomeReleaseNotice(event, OPENID)
      };
    }
    if (action === 'publishHomeReleaseNotice') {
      return { ok: true, notice: await updateHomeReleaseNotice(event, OPENID, true) };
    }
    if (action === 'editHomeReleaseNotice' || action === 'deleteHomeReleaseNotice') {
      return { ok: true, notice: await manageHomeReleaseNotice(event, OPENID, action === 'deleteHomeReleaseNotice') };
    }
    return { ok: false, code: 'UNKNOWN_ACTION', message: '不支持的配置操作' };
  } catch (error) {
    console.error('[featureFlagManager] failed', error);
    const transactionError = [error.code, error.errCode, error.message, error.errMsg].filter(Boolean).join(' ');
    if (action === 'updateAiModelConfig' && /TransactionBusy|DATABASE_TRANSACTION_CONFLICT/.test(transactionError)) {
      return { ok: false, code: 'AI_CONFIG_BUSY', message: '配置保存暂时繁忙，请稍后再次保存；当前修改已保留' };
    }
    return {
      ok: false,
      code: ['INVALID_INPUT', 'CONFIG_CONFLICT', 'CONFIG_MISSING', 'AI_CONFIG_NOT_READY'].includes(error.code) ? error.code : 'FEATURE_FLAG_FAILED',
      message: error?.message || '配置更新失败'
    };
  }
};
