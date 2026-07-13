const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

test('reportTypes constant lists all six report entry types', () => {
  const { REPORT_ENTRY_TYPES } = require('../miniprogram/constants/reportTypes');
  assert.deepEqual(
    REPORT_ENTRY_TYPES.map(({ key, name, icon }) => ({ key, name, icon })),
    [
      { key: 'blood_ms', name: '血串联质谱', icon: '🩸' },
      { key: 'urine_ms', name: '尿串联质谱', icon: '🧪' },
      { key: 'blood_gas', name: '血气分析', icon: '💨' },
      { key: 'blood_cbc', name: '血常规', icon: '🩺' },
      { key: 'blood_biochem', name: '大生化', icon: '🧬' },
      { key: 'blood_ammonia', name: '血氨检测', icon: '⚡' }
    ]
  );
});

test('add-report uses shared REPORT_ENTRY_TYPES', () => {
  const js = read('miniprogram/pkg-report/add-report/index.js');
  assert.match(js, /constants\/reportTypes/);
  assert.match(js, /REPORT_ENTRY_TYPES/);
  assert.doesNotMatch(js, /reportTypes:\s*\[\s*\{\s*key:\s*'blood_ms'/);
});
