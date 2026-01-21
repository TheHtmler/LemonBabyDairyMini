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
    }
  },
  data: {
    timeText: '--:--',
    milkItems: [],
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
      const nutrition = record.nutritionDisplay || {};

      const milkItems = [
        { text: `${naturalLabel} ${naturalVolume}ml` },
        { text: `特奶 ${specialVolume}ml` }
      ];

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
        milkItems,
        metricItems
      });
    }
  }
});
