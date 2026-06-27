const test = require('node:test');
const assert = require('node:assert/strict');

function loadMedicationsPage({ modalConfirm = true } = {}) {
  const calls = {
    removeCount: 0,
    getCount: 0,
    loadCount: 0,
    loadingTitles: []
  };

  const db = {
    collection(name) {
      if (name !== 'medications') {
        throw new Error(`unexpected collection: ${name}`);
      }
      return {
        where() {
          return {
            get: async () => ({ data: [] })
          };
        },
        doc(id) {
          return {
            get: async () => {
              calls.getCount += 1;
              return { data: { _id: id, babyUid: 'baby-1' } };
            },
            remove: async () => {
              calls.removeCount += 1;
              return {};
            }
          };
        }
      };
    }
  };

  const previousWx = global.wx;
  const previousPage = global.Page;
  const previousGetApp = global.getApp;
  let pageConfig = null;

  global.wx = {
    cloud: {
      database() {
        return db;
      }
    },
    showModal: async () => ({ confirm: modalConfirm, cancel: !modalConfirm }),
    showLoading: ({ title }) => {
      calls.loadingTitles.push(title);
    },
    hideLoading() {},
    showToast() {},
    getStorageSync(key) {
      return key === 'baby_uid' ? 'baby-1' : '';
    }
  };
  global.getApp = () => ({ globalData: { babyUid: 'baby-1' } });
  global.Page = (config) => {
    pageConfig = config;
  };

  const modelPath = require.resolve('../miniprogram/models/medication.js');
  const pagePath = require.resolve('../miniprogram/pkg-misc/medications/index.js');
  delete require.cache[modelPath];
  delete require.cache[pagePath];
  require(pagePath);

  global.Page = previousPage;

  const instance = {
    ...pageConfig,
    setData(update) {
      this.data = {
        ...(this.data || {}),
        ...update
      };
    },
    async loadMedications() {
      calls.loadCount += 1;
    }
  };

  const cleanup = () => {
    global.wx = previousWx;
    global.getApp = previousGetApp;
  };

  return { instance, calls, cleanup };
}

test('deleteMedication does not delete when user cancels confirmation', async () => {
  const { instance, calls, cleanup } = loadMedicationsPage({ modalConfirm: false });
  try {
    await instance.deleteMedication({
      currentTarget: {
        dataset: {
          id: 'med-1'
        }
      }
    });

    assert.equal(calls.removeCount, 0);
    assert.equal(calls.loadCount, 0);
    assert.deepEqual(calls.loadingTitles, []);
  } finally {
    cleanup();
  }
});

