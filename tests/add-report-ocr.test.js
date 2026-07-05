const test = require('node:test');
const assert = require('node:assert/strict');
const ReportRepository = require('../miniprogram/models/reportRepository');

function loadAddReportHelpers() {
  loadAddReportPage();
  return require('../miniprogram/pkg-report/add-report/index.js');
}

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
    setData(update, callback) {
      Object.assign(this.data, update);
      if (typeof callback === 'function') {
        callback();
      }
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

test('onSaveReport shows a save reminder when OCR items are still marked pending', async () => {
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
    assert.equal(modalCalls[0].title, '保存前请核对识别数据');
    assert.match(modalCalls[0].content, /含 1 项拍照识别数据/);
    assert.match(modalCalls[0].content, /不必逐项点确认/);
    assert.match(modalCalls[0].content, /可直接继续保存/);
    assert.equal(modalCalls[0].confirmText, '继续保存');
    assert.equal(modalCalls[0].cancelText, '返回修改');
    assert.equal(saveCalls, 0);
  } finally {
    ReportRepository.saveReport = originalSaveReport;
  }
});

test('onConfirmOcrIndicator clears pending state without changing the recognized value', () => {
  const page = loadAddReportPage();
  global.wx = { showToast() {}, hideLoading() {} };

  const instance = createInstance(page, {
    ocrPendingKeys: ['c3', 'c0'],
    indicatorData: {
      c3: { value: '8.000', minRange: '0.500', maxRange: '5.000', ocrPending: true },
      c0: { value: '20.000', minRange: '10.000', maxRange: '40.000', ocrPending: true }
    }
  });

  page.onConfirmOcrIndicator.call(instance, {
    currentTarget: { dataset: { indicator: 'c3' } }
  });

  assert.deepEqual(instance.data.ocrPendingKeys, ['c0']);
  assert.equal(instance.data.indicatorData.c3.ocrPending, false);
  assert.equal(instance.data.indicatorData.c3.value, '8.000');
});

test('buildOcrPendingSaveTip describes pending OCR count', () => {
  const { buildOcrPendingSaveTip } = loadAddReportHelpers();

  assert.match(buildOcrPendingSaveTip(3), /含 3 项拍照识别数据/);
  assert.equal(buildOcrPendingSaveTip(0), '');
});

test('sanitizeIndicatorsForSave strips ocrPending and normalizes numeric fields', () => {
  const { sanitizeIndicatorsForSave } = loadAddReportHelpers();
  const sanitized = sanitizeIndicatorsForSave({
    c3: { value: '8', minRange: '1.5', maxRange: '65', ocrPending: true }
  });

  assert.deepEqual(sanitized.c3, {
    value: '8.000',
    minRange: '1.500',
    maxRange: '65.000'
  });
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
        assert.match(cloudPath, /^custom_ocr_temp\/baby-1_/);
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
        assert.equal(data.reportType, 'blood_ammonia');
        assert.ok(String(data.ocrRequestId || '').startsWith('custom_ocr_'));
        return {
          result: {
            ok: true,
            structuredItems: [
              { name: '血氨', value: '45.000', refRange: '15-50', flag: 'normal' }
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

  assert.equal(calledFunctions[0], 'recognizeReportCustom');
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

test('getOcrFailureMessage maps missing deploy, timeout and cloud result errors', () => {
  const page = loadAddReportPage();
  const instance = createInstance(page);

  assert.match(
    page.getOcrFailureMessage.call(instance, { errMsg: 'cloud.callFunction:fail -501000 FUNCTION_NOT_FOUND' }),
    /recognizeReportCustom/
  );
  assert.match(
    page.getOcrFailureMessage.call(instance, { message: '识别超时，请稍后重试或手动填写' }),
    /识别超时/
  );
  assert.equal(
    page.getOcrFailureMessage.call(instance, {}, { message: 'OCR 服务未就绪' }),
    'OCR 服务未就绪'
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
    assert.deepEqual(instance.data.ocrPendingKeys, []);
    assert.equal(instance.data.indicatorData.ammonia.ocrPending, false);
  } finally {
    ReportRepository.saveReport = originalSaveReport;
  }
});
