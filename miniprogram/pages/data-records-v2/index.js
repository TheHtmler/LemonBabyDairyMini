const runtimeGlobal = typeof globalThis !== 'undefined' ? globalThis : {};
const previousSuppressAutoPage = runtimeGlobal.__DATA_RECORDS_SUPPRESS_AUTO_PAGE__;
runtimeGlobal.__DATA_RECORDS_SUPPRESS_AUTO_PAGE__ = true;

const { createDataRecordsPageConfig } = require('../data-records/index');

runtimeGlobal.__DATA_RECORDS_SUPPRESS_AUTO_PAGE__ = previousSuppressAutoPage;

Page(createDataRecordsPageConfig({ recordSource: 'v2' }));
