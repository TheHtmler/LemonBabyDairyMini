const test = require('node:test');
const assert = require('node:assert/strict');

function loadAddReportPage() {
  const pagePath = require.resolve('../miniprogram/pages/add-report/index.js');
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

test('add-report honors incoming report type when opening add mode from a category', () => {
  const page = loadAddReportPage();
  const instance = {
    ...page,
    data: JSON.parse(JSON.stringify(page.data)),
    setData(update) {
      Object.assign(this.data, update);
    },
    initPage() {}
  };

  page.onLoad.call(instance, {
    mode: 'add',
    type: 'urine_ms'
  });

  assert.equal(instance.data.mode, 'add');
  assert.equal(instance.data.selectedReportType, 'urine_ms');
});
