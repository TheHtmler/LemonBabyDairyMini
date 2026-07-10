const cloud = require('wx-server-sdk');
const fs = require('fs');
const path = require('path');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const collection = db.collection('powder_catalog');
const META_COLLECTION = 'system_powder_catalog_meta';
const META_KEY = 'system_powder_index';
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;
const DEFAULT_LOG_LIMIT = 20;

const VALID_CATEGORIES = ['regular_formula', 'special_formula', 'energy_supplement'];

function loadCatalog() {
  const candidates = [
    path.resolve(__dirname, 'systemPowders.json'),
    path.resolve(__dirname, '../../miniprogram/data/systemPowders.json')
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.items)) {
        return parsed;
      }
    }
  }
  throw new Error('systemPowders.json 未找到或格式不正确（需包含 items 数组）');
}

function getDefaultProteinRole(category) {
  if (category === 'special_formula') return 'special';
  if (category === 'energy_supplement') return 'none';
  return 'natural';
}

function normalizePowder(item = {}) {
  const category = VALID_CATEGORIES.includes(item.category) ? item.category : 'regular_formula';
  const nutrition = item.nutritionPer100g || {};
  const ratio = item.mixRatio || {};

  return {
    powderCode: (item.powderCode || '').toString().trim(),
    name: item.name || '未命名奶粉',
    category,
    proteinRole: item.proteinRole || getDefaultProteinRole(category),
    brand: item.brand || '',
    stage: item.stage || '',
    image: item.image || '',
    nutritionPer100g: {
      protein: Number(nutrition.protein) || 0,
      calories: Number(nutrition.calories) || 0,
      fat: Number(nutrition.fat) || 0,
      carbs: Number(nutrition.carbs) || 0,
      fiber: Number(nutrition.fiber) || 0
    },
    mixRatio: {
      powder: Number(ratio.powder) || 0,
      water: Number(ratio.water) || 0
    },
    alias: Array.isArray(item.alias) ? item.alias : [],
    description: item.description || '',
    schemaVersion: Number(item.schemaVersion) || 1,
    recordType: 'powder_catalog_item',
    status: item.status || 'active',
    sourceType: 'system',
    ownerType: 'system',
    isSystem: true,
    babyUid: '',
    updatedAt: db.serverDate()
  };
}

async function findExistingSystemPowder(powderCode) {
  if (!powderCode) return null;
  const res = await collection
    .where({ powderCode, sourceType: 'system' })
    .limit(1)
    .get();
  return res.data && res.data.length > 0 ? res.data[0] : null;
}

function clampInteger(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(num), min), max);
}

async function countSystemPowders() {
  const res = await collection.where({ sourceType: 'system', status: 'active' }).count();
  return res.total || 0;
}

async function refreshMeta(catalogVersion) {
  const total = await countSystemPowders();
  const version = catalogVersion || `v_${Date.now()}`;
  const existing = await db.collection(META_COLLECTION).where({ key: META_KEY }).limit(1).get();
  if (existing.data && existing.data[0]) {
    await db.collection(META_COLLECTION).doc(existing.data[0]._id).update({
      data: { key: META_KEY, version, total, status: 'active', updatedAt: db.serverDate() }
    });
  } else {
    await db.collection(META_COLLECTION).add({
      data: { key: META_KEY, version, total, status: 'active', updatedAt: db.serverDate() }
    });
  }
  return { version, total };
}

async function cleanupStalePowders(catalog, event = {}) {
  const items = catalog.items || [];
  const seedCodes = new Set(items.map((item) => (item.powderCode || '').toString().trim()).filter(Boolean));
  const execute = event.execute === true;
  const res = await collection.where({ sourceType: 'system' }).get();
  const docs = res.data || [];
  const logs = [];
  let deleted = 0;

  for (const doc of docs) {
    if (seedCodes.has((doc.powderCode || '').toString().trim())) {
      continue;
    }
    logs.push(`stale: ${doc.name || doc._id} (${doc.powderCode || ''})`);
    if (execute) {
      await collection.doc(doc._id).remove();
      deleted += 1;
    }
  }

  const meta = execute ? await refreshMeta(catalog.catalogVersion) : null;
  return {
    ok: true,
    action: 'cleanupStale',
    dryRun: execute !== true,
    scanned: docs.length,
    stale: logs.length,
    deleted,
    meta,
    logs: logs.slice(0, DEFAULT_LOG_LIMIT)
  };
}

exports.main = async (event = {}) => {
  const catalog = loadCatalog();

  if (event.action === 'refreshMeta') {
    const meta = await refreshMeta(catalog.catalogVersion);
    return { ok: true, action: 'refreshMeta', meta };
  }

  if (event.action === 'cleanupStale') {
    return cleanupStalePowders(catalog, event);
  }

  const items = catalog.items || [];
  const startIndex = clampInteger(event.startIndex ?? event.start, 0, 0, items.length);
  const batchSize = clampInteger(event.batchSize ?? event.limit, DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const logLimit = clampInteger(event.logLimit, DEFAULT_LOG_LIMIT, 0, 200);
  const endIndex = Math.min(startIndex + batchSize, items.length);
  const batch = items.slice(startIndex, endIndex);
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const logs = [];

  for (const rawItem of batch) {
    const payload = normalizePowder(rawItem);
    if (!payload.powderCode) {
      skipped += 1;
      logs.push(`skip(no powderCode): ${payload.name}`);
      continue;
    }

    const existing = await findExistingSystemPowder(payload.powderCode);
    if (existing) {
      await collection.doc(existing._id).update({
        data: { ...payload, createdAt: existing.createdAt || db.serverDate() }
      });
      updated += 1;
      logs.push(`update: ${payload.name} (${payload.powderCode})`);
    } else {
      await collection.add({ data: { ...payload, createdAt: db.serverDate() } });
      created += 1;
      logs.push(`create: ${payload.name} (${payload.powderCode})`);
    }
  }

  const nextStart = endIndex < items.length ? endIndex : null;
  const meta = nextStart === null ? await refreshMeta(catalog.catalogVersion) : null;

  return {
    ok: true,
    total: items.length,
    startIndex,
    endIndex,
    batchSize,
    processed: batch.length,
    nextStart,
    hasMore: nextStart !== null,
    created,
    updated,
    skipped,
    meta,
    logs: logs.slice(0, logLimit),
    logCount: logs.length
  };
};
