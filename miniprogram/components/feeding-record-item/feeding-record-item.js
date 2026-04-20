function normalizeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatAmount(value) {
  const normalized = normalizeNumber(value);
  if (!normalized) {
    return '0';
  }

  return normalized.toFixed(2).replace(/\.?0+$/, '');
}

function buildMilkSummarySegment(label, volume, powder) {
  const parts = [];
  const normalizedVolume = normalizeNumber(volume);
  const normalizedPowder = normalizeNumber(powder);

  if (normalizedVolume > 0) {
    parts.push(`${formatAmount(normalizedVolume)}ml`);
  }

  if (normalizedPowder > 0) {
    parts.push(`粉 ${formatAmount(normalizedPowder)}g`);
  }

  if (!parts.length) {
    return null;
  }

  if (parts.length === 2) {
    return `${label} ${parts[0]}（${parts[1]}）`;
  }

  return `${label} ${parts[0]}`;
}

Component({
  properties: {
    record: {
      type: Object,
      value: null
    },
    label: {
      type: String,
      value: '喂奶'
    },
    showLabel: {
      type: Boolean,
      value: true
    },
    showHeader: {
      type: Boolean,
      value: true
    }
  },
  data: {
    timeText: '--:--',
    milkSummaryText: '',
    metricItems: []
  },
  observers: {
    record: function(record) {
      this.updateDisplay(record || {});
    }
  },
  methods: {
    handleTap() {
      this.triggerEvent('recordtap', { record: this.data.record });
    },
    updateDisplay(record) {
      const timeText = record.formattedStartTime || record.startTime || '--:--';
      const naturalLabel = record.naturalMilkType === 'formula' ? '普奶' : '母乳';
      const naturalVolume = record.naturalMilkVolume || 0;
      const specialVolume = record.specialMilkVolume || 0;
      const formulaPowderWeight = record.naturalMilkType === 'formula'
        ? normalizeNumber(record.formulaPowderWeight)
        : 0;
      const specialMilkPowder = normalizeNumber(record.specialMilkPowder);
      const nutrition = record.nutritionDisplay || {};
      const milkSegments = [];

      const naturalMilkSummary = buildMilkSummarySegment(
        naturalLabel,
        naturalVolume,
        record.naturalMilkType === 'formula' ? formulaPowderWeight : 0
      );
      if (naturalMilkSummary) {
        milkSegments.push(naturalMilkSummary);
      }

      const specialMilkSummary = buildMilkSummarySegment('特奶', specialVolume, specialMilkPowder);
      if (specialMilkSummary) {
        milkSegments.push(specialMilkSummary);
      }

      const metricItems = [
        { text: `热量 ${nutrition.calories || 0} kcal` },
        { text: `碳水 ${nutrition.carbs || 0} g` },
        { text: `脂肪 ${nutrition.fat || 0} g` }
      ];

      const naturalProtein = Number(nutrition.naturalProtein) || 0;
      const specialProtein = Number(nutrition.specialProtein) || 0;
      if (naturalProtein > 0) {
        metricItems.push({ text: `天然蛋白 ${naturalProtein} g` });
      }
      if (specialProtein > 0) {
        metricItems.push({ text: `特殊蛋白 ${specialProtein} g` });
      }

      this.setData({
        timeText,
        milkSummaryText: milkSegments.join(' · '),
        metricItems
      });
    }
  }
});
