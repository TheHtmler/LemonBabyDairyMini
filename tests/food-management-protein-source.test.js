const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadFoodManagementPage() {
  const pagePath = require.resolve('../miniprogram/pages/food-management/index.js');
  [
    pagePath,
    require.resolve('../miniprogram/models/food.js'),
    require.resolve('../miniprogram/models/foodCategory.js'),
    require.resolve('../miniprogram/utils/index.js')
  ].forEach((modulePath) => {
    delete require.cache[modulePath];
  });

  let pageConfig = null;
  const previousPage = global.Page;
  const previousWx = global.wx;
  const previousGetApp = global.getApp;

  global.wx = {
    cloud: {
      database() {
        return {
          command: {
            eq: (value) => ({ $eq: value }),
            in: (value) => ({ $in: value }),
            or: (value) => ({ $or: value }),
            addToSet: (value) => ({ $addToSet: value }),
            remove: () => ({ $remove: true })
          },
          collection() {
            return {};
          },
          serverDate() {
            return new Date();
          }
        };
      }
    },
    showToast() {}
  };
  global.getApp = () => ({ globalData: {} });
  global.Page = (config) => {
    pageConfig = config;
  };

  require(pagePath);

  global.Page = previousPage;
  global.wx = previousWx;
  global.getApp = previousGetApp;

  return pageConfig;
}

function createPageInstance(page, data = {}) {
  const instance = {
    ...page,
    data: {
      ...page.data,
      ...data
    },
    setData(updates, callback) {
      Object.entries(updates).forEach(([path, value]) => {
        const parts = path.split('.');
        let target = this.data;
        while (parts.length > 1) {
          const key = parts.shift();
          target[key] = target[key] || {};
          target = target[key];
        }
        target[parts[0]] = value;
      });
      if (callback) callback();
    }
  };
  return instance;
}

test('food management shows protein source in required section before fat and carbs', () => {
  const wxml = fs.readFileSync(
    require.resolve('../miniprogram/pages/food-management/index.wxml'),
    'utf8'
  );
  const requiredSection = wxml.slice(
    wxml.indexOf('<text class="form-section-title">必填信息</text>'),
    wxml.indexOf('<text class="form-section-title">扩展信息</text>')
  );

  assert.ok(requiredSection.indexOf('蛋白来源') > requiredSection.indexOf('蛋白 (g)'));
  assert.ok(requiredSection.indexOf('蛋白来源') < requiredSection.indexOf('脂肪 (g)'));
  assert.match(requiredSection, /请选择蛋白来源/);
  assert.doesNotMatch(wxml, /可补充图片、膳食纤维、钠和蛋白来源/);
});

test('food management requires explicit protein source and recommends premium for meat categories', () => {
  const page = loadFoodManagementPage();
  const instance = createPageInstance(page, {
    categorySuggestions: ['主食及谷薯', '肉禽类'],
    formData: {
      ...page.data.formData,
      name: '鸡肉泥',
      category: '',
      unit: 'g',
      baseQuantity: '100',
      calories: '120',
      protein: '8',
      fat: '2',
      carbs: '4'
    }
  });

  const previousWx = global.wx;
  global.wx = { showToast() {} };
  try {
    assert.equal(instance.validateForm(), false);

    instance.onCategoryPickerChange({ detail: { value: 1 } });

    assert.equal(instance.data.formData.category, '肉禽类');
    assert.equal(instance.data.formData.proteinTypeIndex, 0);
    assert.equal(instance.data.proteinTypeRecommendationText, '已根据分类推荐：天然蛋白（优质）');
    assert.equal(instance.validateForm(), true);
  } finally {
    global.wx = previousWx;
  }
});

test('food management recommends regular protein for grain categories without overriding manual choice', () => {
  const page = loadFoodManagementPage();
  const instance = createPageInstance(page, {
    categorySuggestions: ['主食及谷薯', '肉禽类'],
    formData: {
      ...page.data.formData,
      proteinTypeIndex: -1
    }
  });

  instance.onCategoryPickerChange({ detail: { value: 0 } });
  assert.equal(instance.data.formData.proteinTypeIndex, 1);
  assert.equal(instance.data.proteinTypeRecommendationText, '已根据分类推荐：天然蛋白（普通）');

  instance.onProteinTypeChange({ detail: { value: 2 } });
  instance.onCategoryPickerChange({ detail: { value: 1 } });

  assert.equal(instance.data.formData.category, '肉禽类');
  assert.equal(instance.data.formData.proteinTypeIndex, 2);
  assert.equal(instance.data.proteinTypeRecommendationText, '');
});
