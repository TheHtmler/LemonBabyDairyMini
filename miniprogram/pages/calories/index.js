Page({
  data: {
    ageOptions: ['0–6月', '7–12月', '1–3岁'],
    // 对应 MMA 稳定期能量范围（kcal/kg·d）
    energyRange: ['72–109', '64–97', '66–99'],
    ageIndex: 1, // 默认 7–12月
    keyword: '',
    foods: [
      // 下面是示例值，建议后续用你自己的表（可从国家食物成分表或临床用表录入）
      { name: '母乳', kcal100: 67, prot100: 1.0 },
      { name: '配方特奶（冲好）', kcal100: 69.9, prot100: 1.965 },
      { name: '米粉（干粉）', kcal100: 380, prot100: 7.5 },
      { name: '南瓜（蒸熟）', kcal100: 26, prot100: 1.0 },
      { name: '苹果（去皮）', kcal100: 52, prot100: 0.3 },
      { name: '鸡胸肉（熟）', kcal100: 165, prot100: 31 },
      { name: '鸡蛋黄', kcal100: 322, prot100: 15.8 },
      { name: '藜麦（熟）', kcal100: 120, prot100: 4.4 }
    ],
    filteredFoods: []
  },
  onLoad() {
    this.applyFilter();
  },
  onAgeChange(e) {
    this.setData({ ageIndex: Number(e.detail.value) });
  },
  onSearch(e) {
    this.setData({ keyword: e.detail.value || '' }, this.applyFilter);
  },
  applyFilter() {
    const kw = (this.data.keyword || '').trim().toLowerCase();
    const list = !kw ? this.data.foods :
      this.data.foods.filter(f => f.name.toLowerCase().includes(kw));
    this.setData({ filteredFoods: list });
  }
});