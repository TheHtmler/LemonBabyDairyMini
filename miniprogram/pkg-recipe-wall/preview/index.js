const {
  validatePublishPayload,
  formatRecipeWallAuthorLabel,
  formatDifficultyLabel
} = require('../../utils/recipeWallUtils');

const RECIPE_WALL_DRAFT_KEY = 'recipe_wall_publish_draft';

Page({
  data: {
    draft: null,
    authorLabel: '',
    difficultyLabel: '',
    cookingText: '',
    nutritionPreview: null,
    submitting: false
  },

  onShow() {
    const draft = wx.getStorageSync(RECIPE_WALL_DRAFT_KEY);
    if (!draft || !draft.validated) {
      wx.showToast({ title: '请先填写食谱', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 400);
      return;
    }

    const cookingMinutes = draft.validated.cookingMinutes;
    this.setData({
      draft,
      authorLabel: formatRecipeWallAuthorLabel(draft.validated),
      difficultyLabel: formatDifficultyLabel(draft.validated.difficulty),
      cookingText: cookingMinutes ? `${cookingMinutes} 分钟` : '',
      nutritionPreview: draft.nutritionPreview || {
        caloriesText: String(Math.round(draft.validated.totalNutrition?.calories || 0)),
        proteinText: Number(draft.validated.totalNutrition?.protein || 0).toFixed(2),
        carbsText: Number(draft.validated.totalNutrition?.carbs || 0).toFixed(2),
        fatText: Number(draft.validated.totalNutrition?.fat || 0).toFixed(2)
      }
    });
  },

  previewImage(e) {
    const url = e.currentTarget.dataset.url;
    if (!url || !this.data.draft) return;
    const urls = [
      this.data.draft.coverFileId,
      ...(this.data.draft.steps || []).map((step) => step.imageFileId).filter(Boolean)
    ];
    wx.previewImage({ current: url, urls });
  },

  buildPublishPayload(validated = {}) {
    // 只传必要字段；不传 foodSnapshot，避免包体过大/序列化失败
    return {
      title: validated.title || '',
      description: validated.description || '',
      coverFileId: validated.coverFileId || '',
      ingredients: (validated.ingredients || []).map((item) => ({
        foodId: item.foodId || '',
        foodName: item.foodName || item.name || '',
        name: item.foodName || item.name || '',
        quantity: Number(item.quantity) || 0,
        unit: item.unit || 'g',
        amount: item.amount || '',
        nutrition: item.nutrition
          ? {
            calories: Number(item.nutrition.calories) || 0,
            protein: Number(item.nutrition.protein) || 0,
            carbs: Number(item.nutrition.carbs) || 0,
            fat: Number(item.nutrition.fat) || 0,
            naturalProtein: Number(item.nutrition.naturalProtein) || 0,
            specialProtein: Number(item.nutrition.specialProtein) || 0,
            fiber: Number(item.nutrition.fiber) || 0,
            sodium: Number(item.nutrition.sodium) || 0
          }
          : null
      })),
      steps: (validated.steps || []).map((step) => ({
        text: step.text || '',
        imageFileId: step.imageFileId || ''
      })),
      tags: validated.tags || [],
      searchText: validated.searchText || '',
      cookingMinutes: validated.cookingMinutes == null ? null : validated.cookingMinutes,
      difficulty: validated.difficulty || '',
      totalNutrition: {
        calories: Number(validated.totalNutrition?.calories) || 0,
        protein: Number(validated.totalNutrition?.protein) || 0,
        carbs: Number(validated.totalNutrition?.carbs) || 0,
        fat: Number(validated.totalNutrition?.fat) || 0
      },
      babyName: validated.babyName || '',
      authorDisplayName: validated.authorDisplayName || '',
      babyUid: validated.babyUid || '',
      authorAvatar: validated.authorAvatar || ''
    };
  },

  showPublishError(error) {
    const raw = String(error.errMsg || error.message || '发布失败');
    console.error('publish failed', error);
    let content = raw;
    if (/FUNCTION_NOT_FOUND|-501000/i.test(raw)) {
      content = '未找到云函数 recipeWallManager，请在开发者工具上传并部署';
    } else if (/timeout|TIMED_OUT|-504002/i.test(raw)) {
      content = '云函数超时。请重新部署（已把超时调到 60s），并尽量压缩图片后重试';
    } else if (/cloud\.function|callFunction:fail/i.test(raw)) {
      content = `云函数调用失败：${raw.slice(0, 160)}\n\n请确认：\n1. 已上传部署 recipeWallManager\n2. 已创建集合 recipe_wall_posts\n3. 云函数已开通内容安全权限`;
    }
    wx.showModal({
      title: '发布失败',
      content: content.slice(0, 300),
      showCancel: false
    });
  },

  async onPublish() {
    if (this.data.submitting || !this.data.draft?.validated) return;
    const checked = validatePublishPayload(this.data.draft.validated);
    if (!checked.ok) {
      wx.showToast({ title: checked.message, icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '发布中', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'recipeWallManager',
        data: {
          action: 'publish',
          postId: this.data.draft.postId || '',
          ...this.buildPublishPayload(checked.data)
        }
      });
      const result = res.result;
      if (!result) {
        throw new Error('云函数无响应，请重新上传部署 recipeWallManager');
      }
      if (!result.ok) throw new Error(result.message || '发布失败');

      try {
        wx.removeStorageSync(RECIPE_WALL_DRAFT_KEY);
      } catch (e) {}

      const isEdit = !!this.data.draft.postId;
      wx.showToast({ title: isEdit ? '已保存' : '发布成功', icon: 'success' });
      setTimeout(() => {
        wx.redirectTo({ url: '/pkg-recipe-wall/list/index' });
      }, 400);
    } catch (error) {
      this.showPublishError(error);
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  }
});
