const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const FOOD_COLLECTION = 'food_catalog';

// 优质蛋白关键字：肉、禽、鱼虾蟹贝水产、蛋、乳奶、豆
const PREMIUM_KEYWORDS = ['肉', '禽', '鱼', '虾', '蟹', '贝', '水产', '蛋', '乳', '奶', '豆'];

/**
 * 根据食物分类推断蛋白质量
 * @param {string} category - 食物分类名称
 * @returns {'premium'|'regular'}
 */
function inferProteinQuality(category) {
  const c = (category || '').toLowerCase();
  return PREMIUM_KEYWORDS.some(k => c.includes(k)) ? 'premium' : 'regular';
}

/**
 * 分页遍历集合
 */
async function paginate(collection, handler, pageSize = 100) {
  let skip = 0;
  while (true) {
    const res = await collection.skip(skip).limit(pageSize).get();
    const batch = res.data || [];
    if (batch.length === 0) break;
    await handler(batch);
    skip += batch.length;
  }
}

/**
 * 入口函数
 * @param {Object} event
 * @param {string} event.mode - 'preview' | 'execute' | 'rollback'
 */
exports.main = async (event = {}) => {
  const mode = event.mode || 'preview';

  if (mode === 'rollback') {
    return await rollback();
  }

  return await migrate(mode === 'execute');
};

/**
 * 迁移：为 food_catalog 中 proteinSource=natural 的食物添加 proteinQuality
 * @param {boolean} execute - true 则实际写入，false 则仅预览
 */
async function migrate(execute) {
  const summary = {
    ok: true,
    mode: execute ? 'execute' : 'preview',
    scanned: 0,
    skipped: 0,
    toPremium: 0,
    toRegular: 0,
    specialCleared: 0,
    details: []
  };

  const collection = db.collection(FOOD_COLLECTION);

  await paginate(collection, async (batch) => {
    for (const doc of batch) {
      summary.scanned += 1;

      // 已有 proteinQuality 的跳过
      if (doc.proteinQuality !== undefined && doc.proteinQuality !== null) {
        summary.skipped += 1;
        continue;
      }

      const source = doc.proteinSource || 'natural';

      // 特殊蛋白不区分质量
      if (source === 'special') {
        summary.specialCleared += 1;
        if (execute) {
          await collection.doc(doc._id).update({
            data: { proteinQuality: '' }
          });
        }
        summary.details.push({
          _id: doc._id,
          name: doc.name,
          category: doc.category || doc.categoryLevel1 || '',
          proteinSource: source,
          proteinQuality: ''
        });
        continue;
      }

      // 天然蛋白：根据分类推断
      const category = doc.category || doc.categoryLevel1 || '';
      const quality = inferProteinQuality(category);

      if (quality === 'premium') {
        summary.toPremium += 1;
      } else {
        summary.toRegular += 1;
      }

      if (execute) {
        await collection.doc(doc._id).update({
          data: { proteinQuality: quality }
        });
      }

      summary.details.push({
        _id: doc._id,
        name: doc.name,
        category,
        proteinSource: source,
        proteinQuality: quality
      });
    }
  });

  return summary;
}

/**
 * 回滚：移除所有 food_catalog 文档的 proteinQuality 字段
 */
async function rollback() {
  const summary = {
    ok: true,
    mode: 'rollback',
    scanned: 0,
    cleared: 0
  };

  const collection = db.collection(FOOD_COLLECTION);

  await paginate(collection, async (batch) => {
    for (const doc of batch) {
      summary.scanned += 1;

      if (doc.proteinQuality === undefined || doc.proteinQuality === null) {
        continue;
      }

      summary.cleared += 1;
      await collection.doc(doc._id).update({
        data: { proteinQuality: _.remove() }
      });
    }
  });

  return summary;
}
