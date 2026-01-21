const cloud = require('wx-server-sdk');
const fs = require('fs');
const path = require('path');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const collection = db.collection('food_catalog');

function loadFoods() {
  const candidates = [
    path.resolve(__dirname, '../../miniprogram/data/foods.json'),
    path.resolve(__dirname, 'foods.json')
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  }
  throw new Error('foods.json 未找到，请将 miniprogram/data/foods.json 拷贝到云函数目录或保持相对路径可访问');
}

function normalizeFood(item) {
  const nutrition = item.nutritionPerUnit || {};
  return {
    name: item.name,
    category: item.category || '',
    categoryLevel1: item.categoryLevel1 || item.category || '',
    categoryLevel2: item.categoryLevel2 || '',
    alias: item.alias || [],
    aliasText: item.aliasText || '',
    baseQuantity: Number(item.baseQuantity) || 100,
    baseUnit: item.baseUnit || 'g',
    defaultQuantity: Number(item.defaultQuantity) || Number(item.baseQuantity) || 100,
    image: item.image || '',
    isLiquid: !!item.isLiquid,
    isSystem: true,
    nutritionSource: item.nutritionSource || 'system',
    nutritionPerUnit: {
      calories: Number(nutrition.calories) || 0,
      carbs: Number(nutrition.carbs) || 0,
      fat: Number(nutrition.fat) || 0,
      fiber: Number(nutrition.fiber) || 0,
      protein: Number(nutrition.protein) || 0,
      sodium: Number(nutrition.sodium) || 0
    },
    sharedBabyUids: [],
    babyUid: '',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  };
}

exports.main = async () => {
  const foods = loadFoods();
  let created = 0;
  let updated = 0;
  const logs = [];

  for (const item of foods) {
    const payload = normalizeFood(item);
    const existing = await collection
      .where({
        name: payload.name,
        category: payload.category,
        isSystem: true
      })
      .limit(1)
      .get();

    if (existing.data && existing.data.length > 0) {
      const id = existing.data[0]._id;
      await collection.doc(id).update({
        data: {
          ...payload,
          createdAt: existing.data[0].createdAt || db.serverDate()
        }
      });
      updated++;
      logs.push(`update: ${payload.name} (${payload.category})`);
    } else {
      await collection.add({ data: payload });
      created++;
      logs.push(`create: ${payload.name} (${payload.category})`);
    }
  }

  return {
    ok: true,
    total: foods.length,
    created,
    updated,
    logs
  };
};
