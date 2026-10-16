'use strict';
const FEATURES = [
  { id: 'food', name: '食物管理', aliases: ['食物库', '添加食物', '辅食'], path: '/pkg-milk/food-management/index' },
  { id: 'powder', name: '奶粉管理', aliases: ['奶粉库', '配方粉', '添加奶粉'], path: '/pkg-milk/powder-management/index' },
  { id: 'recipe', name: '食谱管理', aliases: ['食谱', '配料', '菜谱'], path: '/pkg-records/recipe-management/index' },
  { id: 'medication', name: '用药管理', aliases: ['药物', '药品', '用药', '药物管理', '添加药物'], path: '/pkg-misc/medications/index' },
  { id: 'meal', name: '记录吃饭', aliases: ['吃饭', '餐次', '记录辅食'], path: '/pkg-records/meal-editor/index' },
  { id: 'milk', name: '记录喂奶', aliases: ['喂奶', '记录奶量'], path: '/pkg-milk/milk-feeding-editor-v2/index' },
  { id: 'water', name: '记录喝水', aliases: ['喝水', '饮水', '记录饮水', '记喝水'], path: '/pkg-records/water-record/index' },
  { id: 'records', name: '数据记录', aliases: ['历史记录', '饮食记录', '记录'], path: '/pages/data-records-v2/index', tab: true },
  { id: 'nutrition', name: '营养设置', aliases: ['营养档案', '配奶设置'], path: '/pkg-milk/nutrition-profile-settings/index' },
  { id: 'goals', name: '配奶计划', aliases: ['奶量计划', '喂奶计划'], path: '/pkg-milk/milk-goal-planner-v2/index' },
  { id: 'baby', name: '宝宝资料', aliases: ['宝宝信息', '生日'], path: '/pkg-misc/baby-info/index' }
];
module.exports = { FEATURES };
