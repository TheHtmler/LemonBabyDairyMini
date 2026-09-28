const test = require('node:test');
const assert = require('node:assert/strict');

function loadBabyInfoPage() {
  const pagePath = require.resolve('../miniprogram/pkg-misc/baby-info/index.js');
  delete require.cache[pagePath];

  let pageConfig = null;
  const previousPage = global.Page;
  global.Page = (config) => {
    pageConfig = config;
  };

  require(pagePath);
  global.Page = previousPage;

  return pageConfig;
}

function createCollectionMock(collectionName, data, calls) {
  return {
    where(query = {}) {
      return {
        async get() {
          calls.push({ collectionName, query });
          return {
            data: (data[collectionName] || []).filter((row = {}) => (
              Object.entries(query).every(([key, value]) => row[key] === value)
            ))
          };
        }
      };
    }
  };
}

function createDbMock(data = {}) {
  const calls = [];
  return {
    calls,
    collection(name) {
      return createCollectionMock(name, data, calls);
    }
  };
}

test('adding a baby keeps the form empty instead of loading the current baby', () => {
  const page = loadBabyInfoPage();
  let loaded = false;
  const instance = {
    ...page,
    data: { ...page.data, createMode: true },
    _createMode: true,
    app: {},
    loadBabyInfo() {
      loaded = true;
    }
  };

  instance.onShow();

  assert.equal(loaded, false);
  assert.equal(instance.createEmptyBabyInfo().name, '');
  assert.equal(instance.createEmptyBabyInfo().babyUid, '');
  assert.equal(instance.createEmptyBabyInfo().birthday, '');
});

test('repeated create saves reuse the same babyUid and ignore taps while saving', () => {
  const page = loadBabyInfoPage();
  const instance = {
    ...page,
    data: { ...page.data, isFormValid: true, isFormSubmitting: false },
    _saving: true
  };

  instance.saveBabyInfo();
  const first = instance.resolveCreateBabyUid();
  const second = instance.resolveCreateBabyUid();

  assert.equal(first, second);
  assert.match(first, /^baby_/);
});

test('baby info save reuses existing creator babyUid before generating a new one', async () => {
  const page = loadBabyInfoPage();
  const db = createDbMock({
    baby_creators: [
      { _id: 'creator-1', _openid: 'openid-1', babyUid: 'baby-existing' }
    ],
    baby_info: [
      { _id: 'baby-info-1', babyUid: 'baby-existing', name: '柠檬宝宝' }
    ]
  });

  const instance = {
    ...page,
    app: {
      globalData: {
        babyUid: ''
      }
    },
    data: {
      ...page.data,
      babyInfo: {
        ...page.data.babyInfo,
        babyUid: ''
      }
    }
  };

  const babyUid = await instance.resolveBabyUidForSave(db, 'openid-1');

  assert.equal(babyUid, 'baby-existing');
  assert.deepEqual(db.calls.map((call) => call.collectionName), ['baby_creators', 'baby_info']);
});
