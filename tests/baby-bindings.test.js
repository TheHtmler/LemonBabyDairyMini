const test = require('node:test');
const assert = require('node:assert/strict');
const {
  conditionLabel,
  pickNextBaby,
  uniqueBabyUids
} = require('../miniprogram/utils/babyBindings');

test('uniqueBabyUids dedupes and drops empty values', () => {
  assert.deepEqual(uniqueBabyUids(['baby-a', 'baby-b', 'baby-a', '', null]), ['baby-a', 'baby-b']);
  assert.deepEqual(uniqueBabyUids(undefined), []);
});

test('conditionLabel maps known conditions and defaults to MMA', () => {
  assert.equal(conditionLabel('MMA'), '甲基丙二酸血症');
  assert.equal(conditionLabel('PA'), '丙酸血症');
  assert.equal(conditionLabel('other'), '其他');
  assert.equal(conditionLabel(''), '甲基丙二酸血症');
});

test('after removing the current baby, the next bound baby is selected', () => {
  const babies = [
    { babyUid: 'baby-a', role: 'creator', name: '柠檬' },
    { babyUid: 'baby-b', role: 'creator', name: '弟弟' }
  ];
  assert.equal(pickNextBaby(babies, 'baby-a').babyUid, 'baby-b');
  assert.equal(pickNextBaby([{ babyUid: 'baby-a' }], 'baby-a'), null);
});
