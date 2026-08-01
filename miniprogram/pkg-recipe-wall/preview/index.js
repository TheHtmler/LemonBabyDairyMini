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

  async onPublish() {
    if (this.data.submitting || !this.data.draft?.validated) return;
    const checked = validatePublishPayload(this.data.draft.validated);
    if (!checked.ok) {
      wx.showToast({ title: checked.message, icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'recipeWallManager',
        data: { action: 'publish', ...checked.data }
      });
      const result = res.result || {};
      if (!result.ok) throw new Error(result.message || '发布失败');

      try {
        wx.removeStorageSync(RECIPE_WALL_DRAFT_KEY);
      } catch (e) {}

      wx.showToast({ title: '发布成功', icon: 'success' });
      setTimeout(() => {
        if (result.postId) {
          wx.redirectTo({ url: `/pkg-recipe-wall/detail/index?id=${result.postId}` });
        } else {
          wx.navigateBack({ delta: 2 });
        }
      }, 400);
    } catch (error) {
      wx.showToast({ title: error.message || '发布失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
