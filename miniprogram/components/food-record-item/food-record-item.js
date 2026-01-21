Component({
  properties: {
    record: {
      type: Object,
      value: null
    }
  },
  data: {
    timeText: '--:--',
    nameText: '',
    quantityText: '',
    metricItems: []
  },
  observers: {
    record: function(record) {
      this.updateDisplay(record || {});
    }
  },
  methods: {
    updateDisplay(record) {
      const timeText = record.recordedAt || record.time || '--:--';
      const nameText = record.nameSnapshot || record.name || '';
      const quantity = record.quantity || 0;
      const unit = record.unit || 'g';
      const nutrition = record.nutrition || {};

      const metricItems = [
        `热量 ${nutrition.calories || 0} kcal`,
        `蛋白 ${nutrition.protein || 0} g`,
        `碳水 ${nutrition.carbs || 0} g`,
        `脂肪 ${nutrition.fat || 0} g`,
        `膳纤 ${nutrition.fiber || 0} g`,
        `钠 ${nutrition.sodium || 0} mg`
      ];

      this.setData({
        timeText,
        nameText,
        quantityText: `${quantity}${unit}`,
        metricItems
      });
    }
  }
});
