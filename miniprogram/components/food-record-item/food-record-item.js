const {
  resolveFoodIntakePremiumProteinSplit
} = require('../../utils/recipeNutritionUtils');

function resolveSourceTag(record = {}) {
  const recipeSource = record.recipeSource;
  const hasRecipeSource = !!(
    recipeSource
    && typeof recipeSource === 'object'
    && String(recipeSource.recipeId || '').trim()
  );
  if (record.isRecipe || record.sourceType === 'recipe' || hasRecipeSource) {
    return { sourceTag: '食谱', sourceTagClass: 'recipe' };
  }
  const label = String(record.sourceLabel || '').trim();
  if (label === '我的') {
    return { sourceTag: '我的', sourceTagClass: 'mine' };
  }
  if (label === '系统') {
    return { sourceTag: '系统', sourceTagClass: 'system' };
  }
  return { sourceTag: '', sourceTagClass: '' };
}

function resolveNaturalProtein(record = {}) {
  if (record.naturalProtein !== undefined && record.naturalProtein !== null && record.naturalProtein !== '') {
    return Number(record.naturalProtein) || 0;
  }
  return Number(record.nutrition?.naturalProtein) || 0;
}

Component({
  properties: {
    record: {
      type: Object,
      value: null
    },
    // 分组头已展示餐次时间时，展开项可隐藏食物级时间
    showTime: {
      type: Boolean,
      value: true
    },
    headerAction: {
      type: String,
      value: ''
    },
    actionGroupId: {
      type: String,
      value: ''
    },
    actionItemId: {
      type: String,
      value: ''
    },
    // default | meal（本顿展开列表更轻量）
    variant: {
      type: String,
      value: 'default'
    }
  },
  data: {
    timeText: '--:--',
    nameText: '',
    quantityText: '',
    metricItems: [],
    sourceTag: '',
    sourceTagClass: ''
  },
  observers: {
    record: function(record) {
      this.updateDisplay(record || {});
    }
  },
  methods: {
    formatProteinText(value) {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        return '0.00';
      }
      return (Math.round((num + Number.EPSILON) * 100) / 100).toFixed(2);
    },

    updateDisplay(record) {
      const timeText = record.recordedAt || record.time || '--:--';
      const nameText = record.nameSnapshot || record.name || '';
      const quantity = record.quantity || 0;
      const unit = record.unit || 'g';
      const nutrition = record.nutrition || {};
      const { sourceTag, sourceTagClass } = resolveSourceTag(record);
      const naturalProtein = resolveNaturalProtein(record);
      const qualitySplit = resolveFoodIntakePremiumProteinSplit(record, naturalProtein);
      const premiumProtein = Number(qualitySplit.premiumProtein) || 0;
      const premiumRatio = Number(qualitySplit.premiumRatio) || 0;

      const proteinText = `蛋白 ${this.formatProteinText(nutrition.protein)}g`;
      const metricItems = [
        `${nutrition.calories || 0} kcal`,
        premiumProtein > 0
          ? `${proteinText}（含优质蛋白 ${this.formatProteinText(premiumProtein)}g · ${premiumRatio}%）`
          : proteinText,
        `碳水 ${nutrition.carbs || 0}g`,
        `脂肪 ${nutrition.fat || 0}g`
      ];

      this.setData({
        timeText,
        nameText,
        quantityText: `${quantity}${unit}`,
        metricItems,
        sourceTag,
        sourceTagClass
      });
    },

    onHeaderActionTap() {
      this.triggerEvent('headeraction', {
        groupId: this.properties.actionGroupId || '',
        itemId: this.properties.actionItemId || ''
      });
    }
  }
});
