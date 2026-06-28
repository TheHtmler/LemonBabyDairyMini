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
