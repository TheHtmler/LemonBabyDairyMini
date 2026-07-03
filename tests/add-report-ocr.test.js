const test = require('node:test');
const assert = require('node:assert/strict');
const ReportRepository = require('../miniprogram/models/reportRepository');

function loadAddReportPage() {
  const pagePath = require.resolve('../miniprogram/pkg-report/add-report/index.js');
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

function createInstance(page, dataOverrides = {}) {
  return {
    ...page,
    data: {
      ...JSON.parse(JSON.stringify(page.data)),
      ...dataOverrides
    },
    setData(update) {
      Object.assign(this.data, update);
    }
  };
}

test('applyOcrRecognitionResult fills only empty fields and marks them pending', () => {
  const page = loadAddReportPage();
  global.wx = { showToast() {}, hideLoading() {} };

  const instance = createInstance(page, {
    selectedReportType: 'blood_ms',
    ocrPendingKeys: [],
    indicatorData: {
      c3: { value: '', minRange: '', maxRange: '' },
      c0: { value: '18.000', minRange: '10.000', maxRange: '40.000' }
    }
  });

  instance.applyOcrRecognitionResult({
    c3: { value: '8.000', minRange: '0.500', maxRange: '5.000', sourceText: 'x' },
    c0: { value: '99.000', minRange: '', maxRange: '', sourceText: 'y' }
  });

  assert.equal(instance.data.indicatorData.c3.value, '8.000');
  assert.equal(instance.data.indicatorData.c3.minRange, '0.500');
  assert.equal(instance.data.indicatorData.c3.ocrPending, true);
  // c0 already had a value, must not be overwritten by the recognized result
  assert.equal(instance.data.indicatorData.c0.value, '18.000');
  assert.equal(instance.data.indicatorData.c0.ocrPending, undefined);
  assert.deepEqual(instance.data.ocrPendingKeys, ['c3']);
});

test('applyOcrRecognitionResult toasts and makes no changes when every recognized key already has a value', () => {
  const page = loadAddReportPage();
  const toasts = [];
  global.wx = { showToast: (opts) => toasts.push(opts.title), hideLoading() {} };

  const instance = createInstance(page, {
    selectedReportType: 'blood_ms',
    ocrPendingKeys: [],
    indicatorData: {
      c0: { value: '18.000', minRange: '10.000', maxRange: '40.000' }
    }
  });

  instance.applyOcrRecognitionResult({
    c0: { value: '99.000', minRange: '', maxRange: '', sourceText: 'y' }
  });

  assert.equal(instance.data.indicatorData.c0.value, '18.000');
  assert.deepEqual(instance.data.ocrPendingKeys, []);
  assert.ok(toasts.some((title) => title.includes('都已经有数值')));
});

test('onIndicatorValueInput clears the pending-ocr flag once the user edits a recognized field', () => {
  const page = loadAddReportPage();
  global.wx = { showToast() {}, hideLoading() {} };

  const instance = createInstance(page, {
    ocrPendingKeys: ['c3'],
    indicatorData: {
      c3: { value: '8.000', minRange: '0.500', maxRange: '5.000', ocrPending: true }
    }
  });

  page.onIndicatorValueInput.call(instance, {
    currentTarget: { dataset: { indicator: 'c3', field: 'value' } },
    detail: { value: '9.000' }
  });

  assert.deepEqual(instance.data.ocrPendingKeys, []);
  assert.equal(instance.data.indicatorData.c3.ocrPending, false);
  assert.equal(instance.data.indicatorData.c3.value, '9.000');
});

test('onIndicatorValueInput leaves ocrPendingKeys untouched for fields that were never recognized', () => {
  const page = loadAddReportPage();
  global.wx = { showToast() {}, hideLoading() {} };

  const instance = createInstance(page, {
    ocrPendingKeys: ['c3'],
    indicatorData: {
      c3: { value: '8.000', ocrPending: true },
      c0: { value: '', minRange: '', maxRange: '' }
    }
  });

  page.onIndicatorValueInput.call(instance, {
    currentTarget: { dataset: { indicator: 'c0', field: 'value' } },
    detail: { value: '20.000' }
  });

  assert.deepEqual(instance.data.ocrPendingKeys, ['c3']);
});

test('onSaveReport asks for confirmation before saving when there are unresolved OCR pending keys', async () => {
  const page = loadAddReportPage();
  const modalCalls = [];
  let saveCalls = 0;
  global.wx = {
    showModal: (opts) => {
      modalCalls.push(opts);
    },
    showToast() {}
  };

  const originalSaveReport = ReportRepository.saveReport;
  ReportRepository.saveReport = async () => {
    saveCalls += 1;
  };

  try {
    const instance = createInstance(page, {
      ocrPendingKeys: ['c3'],
      selectedReportType: 'blood_ammonia',
      reportDate: '2026-07-01',
      babyInfo: { babyUid: 'baby-1' },
      indicatorData: {
        ammonia: { value: '45.000', minRange: '10.000', maxRange: '60.000' }
      }
    });

    await page.onSaveReport.call(instance);

    assert.equal(modalCalls.length, 1);
    assert.match(modalCalls[0].content, /1 项/);
    assert.equal(saveCalls, 0);
  } finally {
    ReportRepository.saveReport = originalSaveReport;
  }
});

test('onSaveReport saves immediately when there is nothing pending review', async () => {
  const page = loadAddReportPage();
  let saveCalls = 0;
  global.wx = {
    showModal: () => assert.fail('should not prompt when nothing is pending'),
    showToast() {},
    navigateBack() {}
  };

  const originalSaveReport = ReportRepository.saveReport;
  ReportRepository.saveReport = async () => {
    saveCalls += 1;
  };

  try {
    const instance = createInstance(page, {
      ocrPendingKeys: [],
      selectedReportType: 'blood_ammonia',
      reportDate: '2026-07-01',
      babyInfo: { babyUid: 'baby-1' },
      indicatorData: {
        ammonia: { value: '45.000', minRange: '10.000', maxRange: '60.000' }
      }
    });

    await page.onSaveReport.call(instance);

    assert.equal(saveCalls, 1);
  } finally {
    ReportRepository.saveReport = originalSaveReport;
  }
});

test('onRecognizeReportPhoto walks choose->upload->recognize->apply and cleans up the temp cloud file', async () => {
  const page = loadAddReportPage();
  const toasts = [];
  const deletedFiles = [];
  const calledFunctions = [];
  const loadingStates = [];

  global.getApp = () => ({ globalData: { cloudEnvId: 'prod-test' } });
  global.wx = {
    showToast: (opts) => toasts.push(opts.title),
    showLoading: (opts) => loadingStates.push(opts.title),
    hideLoading: () => loadingStates.push('hide'),
    compressImage: async ({ src, quality }) => ({ tempFilePath: src, quality }),
    getFileSystemManager: () => ({
      getFileInfo({ success }) {
        success({ size: 1024 });
      }
    }),
    chooseMedia: async () => ({ tempFiles: [{ tempFilePath: 'wxfile://tmp/report.jpg', size: 1024 }] }),
    cloud: {
      uploadFile: async ({ cloudPath, filePath, config }) => {
        assert.equal(filePath, 'wxfile://tmp/report.jpg');
        assert.match(cloudPath, /^report_ocr_temp\/baby-1_/);
        assert.deepEqual(config, { env: 'prod-test' });
        return { fileID: 'cloud://temp-file-id' };
      },
      getTempFileURL: async () => assert.fail('should not fetch temp url when fileID is provided'),
      callFunction: async ({ name, data, config }) => {
        calledFunctions.push(name);
        assert.deepEqual(config, { env: 'prod-test' });
        assert.equal(data.fileID, 'cloud://temp-file-id');
        assert.equal(data.babyUid, 'baby-1');
        assert.equal(data.imgUrl, undefined);
        assert.equal(data.imageBase64, undefined);
        return {
          result: {
            ok: true,
            items: [
              { text: '血氨', pos: { top: 10, left: 0, height: 20 } },
              { text: '45.000', pos: { top: 10, left: 220, height: 20 } }
            ]
          }
        };
      },
      deleteFile: async ({ fileList }) => {
        deletedFiles.push(...fileList);
        return {};
      }
    }
  };

  const instance = createInstance(page, {
    selectedReportType: 'blood_ammonia',
    babyInfo: { babyUid: 'baby-1' },
    ocrPendingKeys: [],
    indicatorData: {
      ammonia: { value: '', minRange: '', maxRange: '' }
    }
  });

  await page.onRecognizeReportPhoto.call(instance);

  assert.equal(calledFunctions[0], 'recognizeReportImage');
  assert.equal(instance.data.indicatorData.ammonia.value, '45.000');
  assert.deepEqual(instance.data.ocrPendingKeys, ['ammonia']);
  assert.equal(instance.data.ocrRecognizing, false);
  assert.deepEqual(deletedFiles, ['cloud://temp-file-id']);
  assert.ok(toasts.some((title) => title.includes('识别到')));
});

test('onRecognizeReportPhoto compresses large photos before upload', async () => {
  const page = loadAddReportPage();
  let compressedSrc = '';

  global.getApp = () => ({ globalData: { cloudEnvId: 'prod-test' } });
  global.wx = {
    showToast() {},
    showLoading() {},
    hideLoading() {},
    getFileSystemManager: () => ({
      getFileInfo({ filePath, success }) {
        success({ size: filePath.includes('compressed') ? 500 * 1024 : 3 * 1024 * 1024 });
      }
    }),
    compressImage: async ({ src, quality }) => {
      compressedSrc = src;
      assert.equal(quality, 60);
      return { tempFilePath: 'wxfile://tmp/report-compressed.jpg' };
    },
    chooseMedia: async () => ({
      tempFiles: [{ tempFilePath: 'wxfile://tmp/report.jpg', size: 3 * 1024 * 1024 }]
    }),
    cloud: {
      uploadFile: async ({ filePath }) => {
        assert.equal(filePath, 'wxfile://tmp/report-compressed.jpg');
        return { fileID: 'cloud://temp-file-id' };
      },
      callFunction: async () => ({ result: { ok: true, items: [] } }),
      deleteFile: async () => ({})
    }
  };

  const instance = createInstance(page, {
    selectedReportType: 'blood_ammonia',
    babyInfo: { babyUid: 'baby-1' },
    indicatorData: { ammonia: { value: '', minRange: '', maxRange: '' } }
  });

  await page.onRecognizeReportPhoto.call(instance);
  assert.equal(compressedSrc, 'wxfile://tmp/report.jpg');
});

test('formatOcrQuotaHint describes baby daily and monthly used and remaining counts', () => {
  const page = loadAddReportPage();
  const instance = createInstance(page);

  assert.equal(
    page.formatOcrQuotaHint.call(instance, {
      limits: { enabled: true },
      babyDaily: { used: 2, limit: 5 },
      babyMonthly: { used: 7, limit: 20 },
      remaining: { babyDaily: 3, babyMonthly: 13 }
    }),
    '今日已识别 2 次，剩余 3 次；本月已识别 7 次，剩余 13 次'
  );
});

test('formatOcrQuotaHint shows unlimited message when app quota is disabled', () => {
  const page = loadAddReportPage();
  const instance = createInstance(page);

  assert.equal(
    page.formatOcrQuotaHint.call(instance, { limits: { enabled: false } }),
    '应用内不限次数；微信 OCR 约100次/天（全应用共享）'
  );
});

test('getOcrFailureMessage distinguishes WeChat OCR quota from app quota', () => {
  const page = loadAddReportPage();
  const instance = createInstance(page);

  assert.match(
    page.getOcrFailureMessage.call(instance, {}, {
      code: 'WECHAT_OCR_QUOTA_EXCEEDED',
      message: '微信 OCR 今日共享额度已用完（约100次/天），请明天再试或手动填写',
      debug: { wechatOcrCallCount: 3 }
    }),
    /微信 OCR/
  );
  assert.match(
    page.getOcrFailureMessage.call(instance, {}, {
      code: 'WECHAT_OCR_QUOTA_EXCEEDED',
      message: '微信 OCR 今日共享额度已用完（约100次/天），请明天再试或手动填写',
      debug: { wechatOcrCallCount: 3 }
    }),
    /本次消耗微信 OCR 3 次/
  );
});

test('getOcrFailureMessage surfaces undeployed cloud function errors', () => {
  const page = loadAddReportPage();
  const instance = createInstance(page);

  assert.match(
    page.getOcrFailureMessage.call(instance, { errMsg: 'cloud.callFunction:fail -501000 FUNCTION_NOT_FOUND' }),
    /未部署/
  );
});

test('onRecognizeReportPhoto silently returns when the user cancels media selection', async () => {
  const page = loadAddReportPage();
  let toastCalled = false;
  global.wx = {
    showToast: () => { toastCalled = true; },
    chooseMedia: async () => { throw { errMsg: 'chooseMedia:fail cancel' }; }
  };

  const instance = createInstance(page, {
    ocrPendingKeys: [],
    indicatorData: {}
  });

  await page.onRecognizeReportPhoto.call(instance);

  assert.equal(instance.data.ocrRecognizing, false);
  assert.equal(toastCalled, false);
});

test('performSaveReport runs when the user confirms the pending-review modal', async () => {
  const page = loadAddReportPage();
  let confirmCallback = null;
  let saveCalls = 0;
  global.wx = {
    showModal: (opts) => {
      confirmCallback = opts.success;
    },
    showToast() {},
    navigateBack() {}
  };

  const originalSaveReport = ReportRepository.saveReport;
  ReportRepository.saveReport = async () => {
    saveCalls += 1;
  };

  try {
    const instance = createInstance(page, {
      ocrPendingKeys: ['ammonia'],
      selectedReportType: 'blood_ammonia',
      reportDate: '2026-07-01',
      babyInfo: { babyUid: 'baby-1' },
      indicatorData: {
        ammonia: { value: '45.000', minRange: '10.000', maxRange: '60.000' }
      }
    });

    await page.onSaveReport.call(instance);
    assert.ok(confirmCallback);
    await confirmCallback({ confirm: true });

    assert.equal(saveCalls, 1);
  } finally {
    ReportRepository.saveReport = originalSaveReport;
  }
});
