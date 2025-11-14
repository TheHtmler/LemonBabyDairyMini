/**
 * 系统默认可用的食物配置
 * 这些数据用于在用户尚未自定义食物前提供基础选项
 */
const DEFAULT_FOODS = [
  {
    _id: 'system_mother_milk',
    name: '母乳',
    category: '乳类及制品',
    categoryLevel1: '乳类及制品',
    categoryLevel2: '母乳',
    milkType: 'mother_milk',
    baseUnit: 'ml',
    baseQuantity: 100,
    isLiquid: true,
    nutritionPerUnit: {
      calories: 67,
      protein: 1.1,
      carbs: 7.0,
      fat: 4.0,
      fiber: 0,
      sodium: 0
    },
    proteinSource: 'natural',
    nutritionSource: 'babySettings',
    source: '中国食物成分表（第六版）',
    isSystem: true
  },
  {
    _id: 'system_special_formula',
    name: '婴幼儿配方奶（冲调）',
    category: '乳类及制品',
    categoryLevel1: '乳类及制品',
    categoryLevel2: '配方奶',
    milkType: 'special_formula',
    baseUnit: 'ml',
    baseQuantity: 100,
    isLiquid: true,
    nutritionPerUnit: {
      calories: 70,
      protein: 1.3,
      carbs: 7.5,
      fat: 3.5,
      fiber: 0,
      sodium: 25
    },
    proteinSource: 'special',
    nutritionSource: 'babySettings',
    source: '婴幼儿配方食品标签数据',
    isSystem: true
  },
  {
    _id: 'system_steamed_rice',
    name: '米饭（蒸）',
    category: '主食及谷薯',
    categoryLevel1: '主食及谷薯',
    categoryLevel2: '米制品',
    baseUnit: 'g',
    baseQuantity: 100,
    nutritionPerUnit: {
      calories: 116,
      protein: 2.6,
      carbs: 25.9,
      fat: 0.3,
      fiber: 0.4,
      sodium: 3
    },
    proteinSource: 'natural',
    nutritionSource: 'system',
    source: '中国食物成分表（第六版）',
    isSystem: true
  },
  {
    _id: 'system_steamed_bun',
    name: '馒头',
    category: '主食及谷薯',
    categoryLevel1: '主食及谷薯',
    categoryLevel2: '面制品',
    baseUnit: 'g',
    baseQuantity: 100,
    nutritionPerUnit: {
      calories: 221,
      protein: 7.6,
      carbs: 45.7,
      fat: 1.3,
      fiber: 1.2,
      sodium: 370
    },
    proteinSource: 'natural',
    nutritionSource: 'system',
    source: '中国食物成分表（第六版）',
    isSystem: true
  },
  {
    _id: 'system_banana',
    name: '香蕉',
    category: '水果类',
    categoryLevel1: '水果类',
    categoryLevel2: '热带水果',
    baseUnit: 'g',
    baseQuantity: 100,
    nutritionPerUnit: {
      calories: 89,
      protein: 1.1,
      carbs: 22.8,
      fat: 0.3,
      fiber: 2.6,
      sodium: 1
    },
    proteinSource: 'natural',
    nutritionSource: 'system',
    source: '中国食物成分表（第六版）',
    isSystem: true
  },
  {
    _id: 'system_apple',
    name: '苹果',
    category: '水果类',
    categoryLevel1: '水果类',
    categoryLevel2: '温带水果',
    baseUnit: 'g',
    baseQuantity: 100,
    nutritionPerUnit: {
      calories: 52,
      protein: 0.3,
      carbs: 13.8,
      fat: 0.2,
      fiber: 2.4,
      sodium: 1
    },
    proteinSource: 'natural',
    nutritionSource: 'system',
    source: '中国食物成分表（第六版）',
    isSystem: true
  },
  {
    _id: 'system_carrot_puree',
    name: '胡萝卜泥',
    category: '婴幼儿辅食',
    categoryLevel1: '婴幼儿辅食',
    categoryLevel2: '蔬菜泥',
    baseUnit: 'g',
    baseQuantity: 100,
    nutritionPerUnit: {
      calories: 40,
      protein: 0.8,
      carbs: 9.2,
      fat: 0.1,
      fiber: 2.8,
      sodium: 66
    },
    proteinSource: 'natural',
    nutritionSource: 'system',
    source: '中国食物成分表（第六版）',
    isSystem: true
  },
  {
    _id: 'system_pumpkin_puree',
    name: '南瓜泥',
    category: '婴幼儿辅食',
    categoryLevel1: '婴幼儿辅食',
    categoryLevel2: '蔬菜泥',
    baseUnit: 'g',
    baseQuantity: 100,
    nutritionPerUnit: {
      calories: 34,
      protein: 1.1,
      carbs: 8.2,
      fat: 0.1,
      fiber: 1.1,
      sodium: 1
    },
    proteinSource: 'natural',
    nutritionSource: 'system',
    source: '中国食物成分表（第六版）',
    isSystem: true
  },
  {
    _id: 'system_chicken_breast',
    name: '鸡胸肉（熟）',
    category: '肉禽类',
    categoryLevel1: '肉禽类',
    categoryLevel2: '禽肉',
    baseUnit: 'g',
    baseQuantity: 100,
    nutritionPerUnit: {
      calories: 165,
      protein: 31.0,
      carbs: 0,
      fat: 3.6,
      fiber: 0,
      sodium: 74
    },
    proteinSource: 'natural',
    nutritionSource: 'system',
    source: '中国食物成分表（第六版）',
    isSystem: true
  },
  {
    _id: 'system_salmon',
    name: '三文鱼（蒸）',
    category: '水产类',
    categoryLevel1: '水产类',
    categoryLevel2: '鱼类',
    baseUnit: 'g',
    baseQuantity: 100,
    nutritionPerUnit: {
      calories: 208,
      protein: 20.0,
      carbs: 0,
      fat: 13.0,
      fiber: 0,
      sodium: 59
    },
    proteinSource: 'natural',
    nutritionSource: 'system',
    source: '中国食物成分表（第六版）',
    isSystem: true
  },
  {
    _id: 'system_boiled_egg',
    name: '鸡蛋（煮）',
    category: '蛋类',
    categoryLevel1: '蛋类',
    categoryLevel2: '鸡蛋',
    baseUnit: 'g',
    baseQuantity: 100,
    nutritionPerUnit: {
      calories: 155,
      protein: 12.6,
      carbs: 1.1,
      fat: 10.6,
      fiber: 0,
      sodium: 124
    },
    proteinSource: 'natural',
    nutritionSource: 'system',
    source: '中国食物成分表（第六版）',
    isSystem: true
  },
  {
    _id: 'system_soft_tofu',
    name: '嫩豆腐',
    category: '豆制品',
    categoryLevel1: '豆制品',
    categoryLevel2: '豆腐',
    baseUnit: 'g',
    baseQuantity: 100,
    nutritionPerUnit: {
      calories: 62,
      protein: 6.6,
      carbs: 1.2,
      fat: 2.7,
      fiber: 0.2,
      sodium: 7
    },
    proteinSource: 'natural',
    nutritionSource: 'system',
    source: '中国食物成分表（第六版）',
    isSystem: true
  },
  {
    _id: 'system_apple_puree',
    name: '苹果泥',
    category: '婴幼儿辅食',
    categoryLevel1: '婴幼儿辅食',
    categoryLevel2: '水果泥',
    baseUnit: 'g',
    baseQuantity: 100,
    nutritionPerUnit: {
      calories: 51,
      protein: 0.3,
      carbs: 13.6,
      fat: 0.1,
      fiber: 1.3,
      sodium: 1
    },
    proteinSource: 'natural',
    nutritionSource: 'system',
    source: '中国食物成分表（第六版）',
    isSystem: true
  }
];

module.exports = {
  DEFAULT_FOODS
};
