const db = wx.cloud.database();
const _ = db.command;

function roundNumber(value, precision = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const multiplier = Math.pow(10, precision);
  return Math.round((num + Number.EPSILON) * multiplier) / multiplier;
}

class RecipeModel {
  constructor() {
    this.collection = db.collection('recipe_catalog');
  }

  normalizeRecipeItems(items = []) {
    return (items || []).map((item) => ({
      foodId: item.foodId || '',
      nameSnapshot: item.nameSnapshot || '',
      category: item.category || '',
      unit: item.unit || 'g',
      baseQuantity: roundNumber(Number(item.baseQuantity) || 0, 2),
      nutritionSnapshot: {
        calories: Math.round(Number(item?.nutritionSnapshot?.calories) || 0),
        protein: roundNumber(Number(item?.nutritionSnapshot?.protein) || 0, 2),
        carbs: roundNumber(Number(item?.nutritionSnapshot?.carbs) || 0, 2),
        fat: roundNumber(Number(item?.nutritionSnapshot?.fat) || 0, 2),
        fiber: roundNumber(Number(item?.nutritionSnapshot?.fiber) || 0, 2),
        sodium: roundNumber(Number(item?.nutritionSnapshot?.sodium) || 0, 2)
      },
      proteinSource: item.proteinSource || 'natural',
      proteinQuality: item.proteinQuality || '',
      naturalProtein: roundNumber(Number(item.naturalProtein) || 0, 2),
      specialProtein: roundNumber(Number(item.specialProtein) || 0, 2)
    })).filter((item) => item.foodId || item.nameSnapshot);
  }

  async listRecipes(babyUid) {
    if (!babyUid) return [];

    try {
      const res = await this.collection
        .where({
          babyUid: _.eq(babyUid)
        })
        .orderBy('updatedAt', 'desc')
        .get();

      return ((res && res.data) || []).filter((item) => item?.status !== 'deleted');
    } catch (error) {
      console.error('获取食谱列表失败:', error);
      return [];
    }
  }

  async createRecipe(recipeData = {}) {
    const babyUid = recipeData.babyUid || '';
    const name = String(recipeData.name || '').trim();
    const items = this.normalizeRecipeItems(recipeData.items || []);

    if (!babyUid) {
      throw new Error('缺少宝宝信息，无法创建食谱');
    }
    if (!name) {
      throw new Error('请输入食谱名称');
    }
    if (!items.length) {
      throw new Error('请至少添加一种食物');
    }

    const payload = {
      babyUid,
      name,
      note: String(recipeData.note || '').trim(),
      items,
      createdFrom: recipeData.createdFrom || null,
      useCount: 0,
      status: 'active',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    };

    const res = await this.collection.add({
      data: payload
    });

    return res._id;
  }

  async updateRecipe(recipeId, recipeData = {}, babyUid = '') {
    if (!recipeId) {
      throw new Error('缺少食谱ID');
    }
    if (!babyUid) {
      throw new Error('缺少宝宝信息，无法更新食谱');
    }

    const payload = {
      name: String(recipeData.name || '').trim(),
      note: String(recipeData.note || '').trim(),
      items: this.normalizeRecipeItems(recipeData.items || []),
      createdFrom: recipeData.createdFrom || null,
      updatedAt: db.serverDate()
    };

    if (!payload.name) {
      throw new Error('请输入食谱名称');
    }
    if (!payload.items.length) {
      throw new Error('请至少添加一种食物');
    }

    await this.collection.doc(recipeId).update({
      data: payload
    });

    return true;
  }

  async deleteRecipe(recipeId, babyUid = '') {
    if (!recipeId) {
      throw new Error('缺少食谱ID');
    }
    if (!babyUid) {
      throw new Error('缺少宝宝信息，无法删除食谱');
    }

    await this.collection.doc(recipeId).update({
      data: {
        status: 'deleted',
        updatedAt: db.serverDate()
      }
    });

    return true;
  }

  async touchRecipeUsage(recipeId, babyUid = '') {
    if (!recipeId || !babyUid) return false;

    await this.collection.doc(recipeId).update({
      data: {
        useCount: _.inc(1),
        lastUsedAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });

    return true;
  }
}

module.exports = new RecipeModel();
