const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const POWDER_COLLECTION = 'powder_catalog';
const META_COLLECTION = 'system_powder_catalog_meta';
const META_KEY = 'system_powder_index';

const VALID_CATEGORIES = ['regular_formula', 'special_formula', 'energy_supplement'];

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

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getDefaultProteinRole(category) {
  if (category === 'special_formula') return 'special';
  if (category === 'energy_supplement') return 'none';
  return 'natural';
}

function normalizeAlias(alias) {
  if (Array.isArray(alias)) {
    return alias.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(alias || '')
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePowderPayload(item = {}) {
  const category = VALID_CATEGORIES.includes(item.category) ? item.category : 'regular_formula';
  const nutrition = item.nutritionPer100g || {};
  const ratio = item.mixRatio || {};

  return {
    powderCode: String(item.powderCode || '').trim(),
    name: String(item.name || '').trim(),
    category,
    proteinRole: item.proteinRole || getDefaultProteinRole(category),
    brand: String(item.brand || '').trim(),
    stage: String(item.stage || '').trim(),
    image: String(item.image || '').trim(),
    nutritionPer100g: {
      protein: toNumber(nutrition.protein),
      calories: toNumber(nutrition.calories),
      fat: toNumber(nutrition.fat),
      carbs: toNumber(nutrition.carbs),
      fiber: toNumber(nutrition.fiber)
    },
    mixRatio: {
      powder: toNumber(ratio.powder),
      water: toNumber(ratio.water)
    },
    alias: normalizeAlias(item.alias),
    description: String(item.description || '').trim(),
    schemaVersion: toNumber(item.schemaVersion, 1) || 1,
    recordType: 'powder_catalog_item',
    status: item.status === 'inactive' ? 'inactive' : 'active',
    sourceType: 'system',
    ownerType: 'system',
    isSystem: true,
    babyUid: '',
    updatedAt: db.serverDate()
  };
}

async function refreshMeta() {
  const countRes = await db.collection(POWDER_COLLECTION)
    .where({ sourceType: 'system', status: 'active' })
    .count();
  const total = countRes.total || 0;
  const version = `v_${Date.now()}`;
  const existing = await db.collection(META_COLLECTION).where({ key: META_KEY }).limit(1).get();
  const data = { key: META_KEY, version, total, status: 'active', updatedAt: db.serverDate() };

  if (existing.data && existing.data[0]) {
    await db.collection(META_COLLECTION).doc(existing.data[0]._id).update({ data });
  } else {
    await db.collection(META_COLLECTION).add({ data });
  }
  return { version, total };
}

async function listPowders() {
  const pageSize = 100;
  let offset = 0;
  let hasMore = true;
  const items = [];

  while (hasMore) {
    const res = await db.collection(POWDER_COLLECTION)
      .where({ sourceType: 'system' })
      .orderBy('powderCode', 'asc')
      .skip(offset)
      .limit(pageSize)
      .get();
    const batch = res.data || [];
    items.push(...batch);
    offset += batch.length;
    hasMore = batch.length === pageSize;
  }

  return items;
}

async function findByPowderCode(powderCode) {
  if (!powderCode) return null;
  const res = await db.collection(POWDER_COLLECTION)
    .where({ powderCode, sourceType: 'system' })
    .limit(1)
    .get();
  return res.data && res.data.length > 0 ? res.data[0] : null;
}

async function savePowder(event = {}) {
  const payload = normalizePowderPayload(event.powder || {});
  if (!payload.powderCode) {
    throw new Error('缺少奶粉编码 powderCode');
  }
  if (!payload.name) {
    throw new Error('缺少奶粉名称');
  }

  const targetId = String(event.id || '').trim();
  const codeOwner = await findByPowderCode(payload.powderCode);

  if (targetId) {
    if (codeOwner && codeOwner._id !== targetId) {
      throw new Error(`奶粉编码 ${payload.powderCode} 已被「${codeOwner.name}」使用`);
    }
    await db.collection(POWDER_COLLECTION).doc(targetId).update({ data: payload });
    const meta = await refreshMeta();
    return { id: targetId, created: false, meta };
  }

  if (codeOwner) {
    throw new Error(`奶粉编码 ${payload.powderCode} 已存在，请直接编辑该条目`);
  }

  const addRes = await db.collection(POWDER_COLLECTION).add({
    data: { ...payload, createdAt: db.serverDate() }
  });
  const meta = await refreshMeta();
  return { id: addRes._id, created: true, meta };
}

async function removePowder(event = {}) {
  const targetId = String(event.id || '').trim();
  if (!targetId) {
    throw new Error('缺少要删除的奶粉标识');
  }
  await db.collection(POWDER_COLLECTION).doc(targetId).remove();
  const meta = await refreshMeta();
  return { id: targetId, meta };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'list';

  if (!OPENID) {
    return { ok: false, code: 'MISSING_OPENID', message: '缺少用户身份' };
  }
  if (!isDeveloperOpenid(OPENID)) {
    return { ok: false, code: 'NO_PERMISSION', message: '无权限管理系统奶粉库' };
  }

  try {
    if (action === 'list') {
      const items = await listPowders();
      const metaRes = await db.collection(META_COLLECTION).where({ key: META_KEY }).limit(1).get();
      const meta = metaRes.data && metaRes.data[0]
        ? { version: metaRes.data[0].version || '', total: metaRes.data[0].total || 0 }
        : { version: '', total: 0 };
      return { ok: true, items, meta };
    }
    if (action === 'save') {
      const result = await savePowder(event);
      return { ok: true, ...result };
    }
    if (action === 'remove') {
      const result = await removePowder(event);
      return { ok: true, ...result };
    }
    if (action === 'refreshMeta') {
      const meta = await refreshMeta();
      return { ok: true, meta };
    }

    return { ok: false, code: 'UNKNOWN_ACTION', message: '不支持的操作' };
  } catch (error) {
    console.error('[systemPowderManager] failed', error);
    return {
      ok: false,
      code: 'SYSTEM_POWDER_MANAGER_FAILED',
      message: error?.message || '系统奶粉库操作失败'
    };
  }
};
