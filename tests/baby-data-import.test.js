const test = require('node:test');
const assert = require('node:assert/strict');

// 宝宝数据导入（utils/babyDataImport.js）测试：
// 一次性把来源宝宝的库数据复制到目标宝宝，复制后两边隔离；
// 按业务 key 幂等去重，重复执行不产生重复数据。

function installWxMock(seed = {}) {
  const previousWx = global.wx;
  const previousGetApp = global.getApp;
  const stores = {
    food_catalog: [...(seed.food_catalog || [])],
    recipe_catalog: [...(seed.recipe_catalog || [])],
    food_categories: [...(seed.food_categories || [])],
    milk_nutrition_profiles: [...(seed.milk_nutrition_profiles || [])],
    baby_info: [...(seed.baby_info || [])]
  };
  const storage = {};
  let idSeq = 0;

  const command = {
    eq: (value) => ({ $eq: value }),
    in: (value) => ({ $in: value }),
    or: (conditions) => ({ $or: conditions }),
    addToSet: (value) => ({ $addToSet: value }),
    remove: () => ({ $remove: true })
  };

  function matchesCondition(doc, condition = {}) {
    return Object.entries(condition).every(([key, expected]) => {
      const actual = doc[key];
      if (expected && Object.prototype.hasOwnProperty.call(expected, '$eq')) {
        return actual === expected.$eq;
      }
      if (expected && Object.prototype.hasOwnProperty.call(expected, '$in')) {
        return Array.isArray(actual)
          ? expected.$in.some((value) => actual.includes(value))
          : expected.$in.includes(actual);
      }
      return actual === expected;
    });
  }

  function applyQuery(docs, query) {
    if (!query) return docs;
    if (query.$or) {
      return docs.filter((doc) => query.$or.some((condition) => matchesCondition(doc, condition)));
    }
    return docs.filter((doc) => matchesCondition(doc, query));
  }

  function applyUpdateData(doc, data) {
    Object.entries(data || {}).forEach(([key, value]) => {
      if (value && Object.prototype.hasOwnProperty.call(value, '$addToSet')) {
        const list = Array.isArray(doc[key]) ? [...doc[key]] : [];
        const additions = Array.isArray(value.$addToSet) ? value.$addToSet : [value.$addToSet];
        additions.forEach((item) => {
          if (!list.includes(item)) list.push(item);
        });
        doc[key] = list;
        return;
      }
      if (value && Object.prototype.hasOwnProperty.call(value, '$remove')) {
        delete doc[key];
        return;
      }
      doc[key] = value;
    });
  }

  function createQuery(docs, initialQuery) {
    let query = initialQuery || null;
    let offset = 0;
    let limitCount = 20;
    let sortField = '';
    let sortOrder = 'asc';
    const api = {
      where(nextQuery) { query = nextQuery; return api; },
      skip(nextOffset) { offset = nextOffset; return api; },
      limit(nextLimit) { limitCount = nextLimit; return api; },
      orderBy(field, order) { sortField = field; sortOrder = order; return api; },
      async get() {
        let matched = applyQuery(docs, query);
        if (sortField) {
          matched = [...matched].sort((a, b) => {
            const left = String(a[sortField] || '');
            const right = String(b[sortField] || '');
            return sortOrder === 'desc' ? right.localeCompare(left) : left.localeCompare(right);
          });
        }
        return { data: matched.slice(offset, offset + limitCount) };
      },
      async update({ data }) {
        const matched = applyQuery(docs, query);
        matched.forEach((doc) => applyUpdateData(doc, data));
        return { stats: { updated: matched.length } };
      },
      async remove() {
        const matched = applyQuery(docs, query);
        matched.forEach((doc) => docs.splice(docs.indexOf(doc), 1));
        return { stats: { removed: matched.length } };
      }
    };
    return api;
  }

  global.wx = {
    getStorageSync(key) { return storage[key]; },
    setStorageSync(key, value) { storage[key] = value; },
    removeStorageSync(key) { delete storage[key]; },
    cloud: {
      database() {
        return {
          command,
          serverDate: () => 'SERVER_DATE',
          collection(name) {
            const docs = stores[name] || (stores[name] = []);
            return {
              where: (query) => createQuery(docs, query),
              doc(id) {
                return {
                  async get() {
                    return { data: docs.find((doc) => doc._id === id) || null };
                  },
                  async update({ data }) {
                    const doc = docs.find((item) => item._id === id);
                    if (doc) applyUpdateData(doc, data);
                    return { stats: { updated: doc ? 1 : 0 } };
                  }
                };
              },
              async add({ data }) {
                idSeq += 1;
                const doc = { ...data, _id: data._id || `new-id-${idSeq}` };
                docs.push(doc);
                return { _id: doc._id };
              }
            };
          }
        };
      }
    }
  };
  global.getApp = () => ({ globalData: { openid: 'openid-1', cloudEnvId: '' } });

  return {
    stores,
    storage,
    restore() {
      global.wx = previousWx;
      global.getApp = previousGetApp;
    }
  };
}

function loadImportModule(mock) {
  const paths = [
    '../miniprogram/utils/babyDataImport.js',
    '../miniprogram/models/food.js',
    '../miniprogram/models/nutritionProfile.js',
    '../miniprogram/pkg-records/models/recipe.js',
    '../miniprogram/pkg-milk/models/foodCategory.js'
  ].map((id) => require.resolve(id));
  paths.forEach((modulePath) => delete require.cache[modulePath]);
  return require('../miniprogram/utils/babyDataImport.js');
}

const SOURCE_FOODS = [
  {
    _id: 'food-1',
    babyUid: 'baby-a',
    sharedBabyUids: ['baby-a'],
    name: '蛋黄泥',
    category: '蛋类',
    nutritionBasis: { quantity: 100, unit: 'g' },
    nutritionPerBasis: { calories: 300, protein: 13, fat: 26, carbs: 2, fiber: 0, sodium: 100 }
  },
  {
    _id: 'food-2',
    babyUid: 'baby-a',
    sharedBabyUids: ['baby-a'],
    name: '小麦-家庭修订',
    category: '谷类及制品',
    isSystemSnapshot: true,
    sourceSystemFoodId: 'sys-1',
    nutritionBasis: { quantity: 100, unit: 'g' },
    nutritionPerBasis: { calories: 340, protein: 12, fat: 1.3, carbs: 75, fiber: 10, sodium: 1 }
  }
];

test('import copies foods, recipes, categories, powders and nutrition into an empty baby', async () => {
  const mock = installWxMock({
    food_catalog: SOURCE_FOODS.map((food) => ({ ...food })),
    recipe_catalog: [
      {
        _id: 'recipe-1',
        babyUid: 'baby-a',
        recordType: 'recipe',
        status: 'active',
        name: '蛋黄小麦糊',
        ingredients: [
          { foodId: 'food-1', foodName: '蛋黄泥', quantity: 30, unit: 'g', foodSnapshot: { name: '蛋黄泥' } },
          { foodId: 'food-2', foodName: '小麦-家庭修订', quantity: 20, unit: 'g', foodSnapshot: { name: '小麦-家庭修订' } }
        ]
      },
      {
        _id: 'recipe-archived',
        babyUid: 'baby-a',
        recordType: 'recipe',
        status: 'archived',
        name: '已归档食谱',
        ingredients: []
      }
    ],
    food_categories: [
      { _id: 'cat-1', babyUid: 'baby-a', name: '自制辅食', normalizedName: '自制辅食' }
    ],
    milk_nutrition_profiles: [
      {
        _id: 'profile-a',
        babyUid: 'baby-a',
        breastMilk: { nutritionPer100ml: { protein: 1.3, calories: 70, fat: 4.2, carbs: 7, fiber: 0 } },
        formulaPowders: [
          { id: 'powder-1', name: '纽迪希亚一段', category: 'special_formula', status: 'active', sourceSystemPowderId: 'SYS_P1' },
          { id: 'powder-2', name: '旧奶粉', category: 'regular_formula', status: 'archived' }
        ]
      }
    ]
  });
  const { importBabyData } = loadImportModule(mock);

  try {
    const summary = await importBabyData('baby-a', 'baby-b', {
      foods: true, recipes: true, powders: true, categories: true, nutrition: true
    });

    assert.deepEqual(summary.foods, { imported: 2, skipped: 0, failed: 0 });
    assert.deepEqual(summary.recipes, { imported: 1, skipped: 1, failed: 0 }, '归档食谱不导入');
    assert.deepEqual(summary.categories, { imported: 1, skipped: 0, failed: 0 });
    assert.deepEqual(summary.powders, { imported: 1, skipped: 0, failed: 0 }, '归档奶粉不导入');
    assert.deepEqual(summary.nutrition, { imported: 1 });

    // 食物归属目标宝宝且相互隔离
    const targetFoods = mock.stores.food_catalog.filter((food) => food.babyUid === 'baby-b');
    assert.equal(targetFoods.length, 2);
    assert.ok(targetFoods.every((food) => (food.sharedBabyUids || []).join() === 'baby-b'));
    assert.ok(targetFoods.every((food) => !SOURCE_FOODS.some((source) => source._id === food._id)), '新文档必须有新 _id');
    // 系统快照食物的业务 key 保留，供幂等去重
    assert.ok(targetFoods.find((food) => food.sourceSystemFoodId === 'sys-1'));

    // 食谱复制且原料 foodId 重连到目标宝宝的新食物
    const targetRecipes = mock.stores.recipe_catalog.filter((recipe) => recipe.babyUid === 'baby-b');
    assert.equal(targetRecipes.length, 1);
    const copied = targetRecipes[0];
    assert.equal(copied.name, '蛋黄小麦糊');
    const targetFoodIds = targetFoods.map((food) => food._id);
    assert.ok(copied.ingredients.every((ingredient) => targetFoodIds.includes(ingredient.foodId)),
      '原料 foodId 应重连到目标宝宝的新食物，而不是残留来源宝宝的 _id');

    // 奶粉与营养参数写入目标宝宝的配奶档案
    const targetProfile = mock.stores.milk_nutrition_profiles.find((profile) => profile.babyUid === 'baby-b');
    assert.ok(targetProfile);
    assert.equal(targetProfile.formulaPowders.length, 1);
    assert.equal(targetProfile.formulaPowders[0].name, '纽迪希亚一段');
    assert.notEqual(targetProfile.formulaPowders[0].id, 'powder-1', '导入的奶粉使用新 id 避免主键冲突');
    assert.equal(targetProfile.breastMilk.nutritionPer100ml.protein, 1.3);

    // 来源宝宝数据未被改动
    assert.equal(mock.stores.food_catalog.filter((food) => food.babyUid === 'baby-a').length, 2);
    assert.equal(mock.stores.recipe_catalog.filter((recipe) => recipe.babyUid === 'baby-a').length, 2);
  } finally {
    mock.restore();
  }
});

test('import is idempotent: a second run skips everything already imported', async () => {
  const mock = installWxMock({
    food_catalog: SOURCE_FOODS.map((food) => ({ ...food })),
    recipe_catalog: [
      {
        _id: 'recipe-1',
        babyUid: 'baby-a',
        recordType: 'recipe',
        status: 'active',
        name: '蛋黄小麦糊',
        ingredients: [
          { foodId: 'food-1', foodName: '蛋黄泥', quantity: 30, unit: 'g', foodSnapshot: { name: '蛋黄泥' } }
        ]
      }
    ],
    food_categories: [
      { _id: 'cat-1', babyUid: 'baby-a', name: '自制辅食', normalizedName: '自制辅食' }
    ],
    milk_nutrition_profiles: [
      {
        _id: 'profile-a',
        babyUid: 'baby-a',
        breastMilk: { nutritionPer100ml: { protein: 1.3 } },
        formulaPowders: [
          { id: 'powder-1', name: '纽迪希亚一段', status: 'active', sourceSystemPowderId: 'SYS_P1' }
        ]
      }
    ]
  });
  const { importBabyData } = loadImportModule(mock);

  try {
    const types = { foods: true, recipes: true, powders: true, categories: true, nutrition: true };
    await importBabyData('baby-a', 'baby-b', types);
    const second = await importBabyData('baby-a', 'baby-b', types);

    assert.equal(second.foods.imported, 0);
    assert.equal(second.foods.skipped, 2);
    assert.equal(second.recipes.imported, 0);
    assert.equal(second.recipes.skipped, 1);
    assert.equal(second.categories.imported, 0);
    assert.equal(second.categories.skipped, 1);
    assert.equal(second.powders.imported, 0);
    assert.equal(second.powders.skipped, 1, '按 sourceSystemPowderId 命中已导入奶粉');

    assert.equal(mock.stores.food_catalog.filter((food) => food.babyUid === 'baby-b').length, 2);
    assert.equal(mock.stores.recipe_catalog.filter((recipe) => recipe.babyUid === 'baby-b').length, 1);
    assert.equal(mock.stores.food_categories.filter((cat) => cat.babyUid === 'baby-b').length, 1);
    const targetProfile = mock.stores.milk_nutrition_profiles.find((profile) => profile.babyUid === 'baby-b');
    assert.equal(targetProfile.formulaPowders.length, 1);
  } finally {
    mock.restore();
  }
});

test('import only runs the selected data types', async () => {
  const mock = installWxMock({
    food_catalog: SOURCE_FOODS.map((food) => ({ ...food })),
    recipe_catalog: [
      {
        _id: 'recipe-1',
        babyUid: 'baby-a',
        recordType: 'recipe',
        status: 'active',
        name: '蛋黄小麦糊',
        ingredients: [
          { foodId: 'food-1', foodName: '蛋黄泥', quantity: 30, unit: 'g', foodSnapshot: { name: '蛋黄泥' } }
        ]
      }
    ]
  });
  const { importBabyData } = loadImportModule(mock);

  try {
    const summary = await importBabyData('baby-a', 'baby-b', {
      foods: false, recipes: true, powders: false, categories: false, nutrition: false
    });

    assert.equal(summary.foods, undefined);
    assert.equal(summary.recipes.imported, 1);
    assert.equal(mock.stores.food_catalog.filter((food) => food.babyUid === 'baby-b').length, 0);
  } finally {
    mock.restore();
  }
});

test('import rejects invalid source/target combinations', async () => {
  const mock = installWxMock({});
  const { importBabyData } = loadImportModule(mock);

  try {
    await assert.rejects(() => importBabyData('baby-a', 'baby-a', {}), /无效/);
    await assert.rejects(() => importBabyData('', 'baby-b', {}), /无效/);
  } finally {
    mock.restore();
  }
});

test('formatImportSummary renders per-type counts', async () => {
  const mock = installWxMock({});
  const { formatImportSummary } = loadImportModule(mock);

  try {
    const text = formatImportSummary({
      foods: { imported: 3, skipped: 1, failed: 0 },
      recipes: { imported: 0, skipped: 2, failed: 1 },
      nutrition: { imported: 1 }
    });
    assert.match(text, /食物库 3 项/);
    assert.match(text, /跳过重复 1/);
    assert.match(text, /食谱 0 项，跳过重复 2，失败 1/);
    assert.match(text, /配奶营养参数已导入/);
    assert.equal(formatImportSummary({}), '没有需要导入的数据');
  } finally {
    mock.restore();
  }
});
