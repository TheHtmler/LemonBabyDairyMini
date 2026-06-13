const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadFoodManagementPage() {
  const pagePath = require.resolve('../miniprogram/pkg-milk/food-management/index.js');
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
    require.resolve('../miniprogram/pkg-milk/food-management/index.wxml'),
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

test('food management explains first system index loading progress', () => {
  const wxml = fs.readFileSync(
    require.resolve('../miniprogram/pkg-milk/food-management/index.wxml'),
    'utf8'
  );
  const wxss = fs.readFileSync(
    require.resolve('../miniprogram/pkg-milk/food-management/index.wxss'),
    'utf8'
  );
  const source = fs.readFileSync(
    require.resolve('../miniprogram/pkg-milk/food-management/index.js'),
    'utf8'
  );

  assert.match(wxml, /loadingTitle/);
  assert.match(wxml, /loadingHint/);
  assert.match(wxml, /loadingProgressText/);
  assert.match(wxml, /food-data-disclaimer/);
  assert.match(wxml, /仅供参考/);
  assert.match(wxml, /校准成分/);
  assert.doesNotMatch(wxml, /class="page-header"/);
  assert.doesNotMatch(wxml, /class="page-title"/);
  assert.ok(wxml.indexOf('food-data-disclaimer') < wxml.indexOf('search-bar'));
  assert.match(wxss, /\.food-data-disclaimer[\s\S]*margin:\s*0 16rpx 12rpx/);
  assert.match(wxss, /\.search-bar[\s\S]*padding:\s*16rpx/);
  assert.match(source, /SystemFoodIndex\.hasLocalIndex/);
  assert.match(source, /isFirstSystemIndexLoad/);
  assert.match(source, /首次加载大量系统食物/);
  assert.match(source, /已加载 \$\{foods\.length\} 种食物/);
  assert.doesNotMatch(source, /onProgress:\s*foods\s*=>\s*\{\s*this\.applyFoodList/);
});

test('food management uses text-only category tabs and flat nutrition cards', () => {
  const wxml = fs.readFileSync(
    require.resolve('../miniprogram/pkg-milk/food-management/index.wxml'),
    'utf8'
  );
  const wxss = fs.readFileSync(
    require.resolve('../miniprogram/pkg-milk/food-management/index.wxss'),
    'utf8'
  );
  const source = fs.readFileSync(
    require.resolve('../miniprogram/pkg-milk/food-management/index.js'),
    'utf8'
  );

  assert.doesNotMatch(wxml, /category-nav-icon/);
  assert.doesNotMatch(wxml, /food-avatar/);
  assert.doesNotMatch(wxml, /food-primary-metrics/);
  assert.match(wxml, /另存为我的/);
  assert.match(wxml, /另存为我的食物/);
  assert.doesNotMatch(wxml, /复制并修改/);
  assert.doesNotMatch(wxml, /添加至我的/);
  assert.doesNotMatch(wxml, /修改系统食物/);
  assert.doesNotMatch(wxml, /校准成分<\/button>/);
  assert.doesNotMatch(wxml, /class="food-cover"/);
  assert.match(wxml, /class="food-list-image"/);
  assert.match(wxml, /wx:if="\{\{item\.showListImage\}\}"/);
  assert.match(wxml, /activeLibraryScope === 'mine'/);
  assert.match(source, /showListImage:\s*!food\.isSystem && !!listImage/);
  assert.doesNotMatch(source, /getCategoryIcon/);
  assert.doesNotMatch(source, /getFoodInitial/);
  assert.match(wxml, /nutrition-item highlight calories/);
  assert.match(wxml, /nutrition-item highlight protein/);
  assert.match(wxss, /\.food-layout[\s\S]*margin:\s*0 16rpx/);
  assert.match(wxss, /\.category-sidebar[\s\S]*width:\s*190rpx/);
  const categoryNavItemBlock = wxss.match(/\.category-nav-item\s*\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(categoryNavItemBlock, /flex-direction:\s*column/);
  assert.match(wxss, /\.category-nav-name[\s\S]*white-space:\s*nowrap/);
  assert.match(wxss, /\.food-title[\s\S]*text-overflow:\s*ellipsis/);
  assert.match(wxss, /\.nutrition-item\.highlight/);
  assert.match(wxss, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  const nutritionValueBlock = wxss.match(/\.nutrition-item \.value\s*\{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(nutritionValueBlock, /text-overflow:\s*ellipsis/);
  assert.doesNotMatch(nutritionValueBlock, /overflow:\s*hidden/);
  assert.match(nutritionValueBlock, /font-size:\s*20rpx/);
  assert.match(wxss, /\.action-btn[\s\S]*white-space:\s*nowrap/);
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

test('food management separates system and mine libraries before grouping', () => {
  const page = loadFoodManagementPage();
  const instance = createPageInstance(page, {
    activeLibraryScope: 'system',
    searchQuery: '小麦',
    foods: [
      {
        _id: 'sys-1',
        name: '小麦',
        category: '谷类及制品',
        libraryScope: 'system',
        isSystem: true,
        nutritionPerBasis: {}
      },
      {
        _id: 'mine-1',
        name: '家庭米糊',
        category: '谷类及制品',
        libraryScope: 'mine',
        isSystem: false,
        nutritionPerBasis: {}
      }
    ]
  });

  instance.updateGroupedFoods(instance.data.foods, { searchQuery: '' });
  assert.deepEqual(instance.data.activeFoods.map(item => item._id), ['sys-1']);
  instance.setData({ searchQuery: '小麦' });

  instance.switchLibraryScope({ currentTarget: { dataset: { scope: 'mine' } } });
  assert.equal(instance.data.activeLibraryScope, 'mine');
  assert.equal(instance.data.searchQuery, '');
  assert.deepEqual(instance.data.activeFoods.map(item => item._id), ['mine-1']);
});

test('food management renders large categories incrementally with load more', () => {
  const page = loadFoodManagementPage();
  const foods = Array.from({ length: 60 }, (_, index) => ({
    _id: `sys-${index + 1}`,
    name: `系统食物${index + 1}`,
    category: '谷类及制品',
    libraryScope: 'system',
    isSystem: true,
    nutritionPerBasis: {}
  }));
  const instance = createPageInstance(page, {
    activeLibraryScope: 'system',
    foods
  });

  instance.updateGroupedFoods(instance.data.foods, { searchQuery: '' });

  assert.equal(instance.data.filteredFoodCount, 60);
  assert.equal(instance.data.activeFoods.length, 50);
  assert.equal(instance.data.activeFoodTotal, 60);
  assert.equal(instance.data.hasMoreActiveFoods, true);

  instance.loadMoreActiveFoods();

  assert.equal(instance.data.activeFoods.length, 60);
  assert.equal(instance.data.hasMoreActiveFoods, false);
});

test('food management category switching does not force scroll position', () => {
  const wxml = fs.readFileSync(
    require.resolve('../miniprogram/pkg-milk/food-management/index.wxml'),
    'utf8'
  );
  const page = loadFoodManagementPage();
  const instance = createPageInstance(page, {
    activeCategory: '谷类及制品',
    categoryNavScrollIntoView: 'food-category-8',
    foodPanelScrollTop: 280,
    groupedFoods: [
      {
        navId: 'food-category-0',
        category: '谷类及制品',
        items: [{ _id: 'food-1', name: '小米' }]
      },
      {
        navId: 'food-category-1',
        category: '水果类',
        items: [{ _id: 'food-2', name: '苹果' }]
      }
    ]
  });

  assert.doesNotMatch(wxml, /scroll-into-view="\{\{categoryNavScrollIntoView\}\}"/);
  assert.doesNotMatch(wxml, /scroll-top="\{\{foodPanelScrollTop\}\}"/);

  instance.switchCategory({ currentTarget: { dataset: { category: '水果类' } } });

  assert.equal(instance.data.activeCategory, '水果类');
  assert.equal(instance.data.categoryNavScrollIntoView, 'food-category-8');
  assert.equal(instance.data.foodPanelScrollTop, 280);
});
