const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('data-records feeding persistence writes specialMilkPowder instead of specialPowderWeight', () => {
  const source = fs.readFileSync('miniprogram/pages/data-records/index.js', 'utf8');

  assert.doesNotMatch(source, /specialPowderWeight:\s*parseFloat\(this\.data\.newFeeding\.specialPowderWeight\)/);
  assert.doesNotMatch(source, /specialPowderWeight:\s*parseFloat\(editingFeeding\.specialPowderWeight\)/);
  assert.match(source, /specialMilkPowder:\s*parseFloat\(this\.data\.newFeeding\.(specialMilkPowder|specialPowderWeight)\)/);
  assert.match(
    source,
    /specialMilkPowder:\s*(parseFloat\(editingFeeding\.(specialMilkPowder|specialPowderWeight)\)|feedingCalculator\.getSpecialMilkPowder\(editingFeeding,\s*this\.data\.nutritionSettings \|\| \{\}\))/
  );
});

test('daily-feeding feeding persistence stores numeric milk fields instead of stringified values', () => {
  const source = fs.readFileSync('miniprogram/pages/daily-feeding/index.js', 'utf8');

  assert.doesNotMatch(source, /naturalMilkVolume:\s*Math\.round\(parseFloat\(this\.data\.currentFeeding\.naturalMilkVolume \|\| 0\)\)\.toString\(\)/);
  assert.doesNotMatch(source, /specialMilkVolume:\s*Math\.round\(parseFloat\(this\.data\.currentFeeding\.specialMilkVolume \|\| 0\)\)\.toString\(\)/);
  assert.doesNotMatch(source, /specialMilkPowder:\s*parseFloat\(this\.data\.currentFeeding\.specialMilkPowder \|\| 0\)\.toFixed\(1\)/);
  assert.doesNotMatch(source, /totalVolume:\s*Math\.round\(parseFloat\(this\.data\.currentFeeding\.totalVolume \|\| 0\)\)\.toString\(\)/);

  assert.doesNotMatch(source, /naturalMilkVolume:\s*Math\.round\(parseFloat\(naturalMilkVolume \|\| 0\)\)\.toString\(\)/);
  assert.doesNotMatch(source, /specialMilkVolume:\s*Math\.round\(parseFloat\(specialMilkVolume \|\| 0\)\)\.toString\(\)/);
  assert.doesNotMatch(source, /specialMilkPowder:\s*parseFloat\(specialMilkPowder \|\| 0\)\.toFixed\(1\)/);
  assert.doesNotMatch(source, /totalVolume:\s*Math\.round\(parseFloat\(totalVolume \|\| 0\)\)\.toString\(\)/);

  assert.doesNotMatch(source, /naturalMilkVolume:\s*naturalMilkNum\.toString\(\)/);
  assert.doesNotMatch(source, /specialMilkVolume:\s*specialMilkNum\.toString\(\)/);
  assert.doesNotMatch(source, /specialMilkPowder:\s*specialMilkPowder\.toFixed\(1\)/);
  assert.doesNotMatch(source, /totalVolume:\s*totalVolumeNum\.toString\(\)/);

  assert.match(source, /naturalMilkVolume:\s*Math\.round\(parseFloat\(this\.data\.currentFeeding\.naturalMilkVolume \|\| 0\)\)/);
  assert.match(source, /specialMilkVolume:\s*Math\.round\(parseFloat\(this\.data\.currentFeeding\.specialMilkVolume \|\| 0\)\)/);
  assert.match(source, /specialMilkPowder:\s*feedingCalculator\.roundValue\(this\.data\.currentFeeding\.specialMilkPowder \|\| 0,\s*2\)/);
  assert.match(source, /totalVolume:\s*Math\.round\(feedingCalculator\.getTotalVolume\(this\.data\.currentFeeding\)\)/);
});

test('feeding page temp state uses specialMilkPowder instead of specialPowderWeight', () => {
  const dailyFeedingSource = fs.readFileSync('miniprogram/pages/daily-feeding/index.js', 'utf8');
  const dataRecordsSource = fs.readFileSync('miniprogram/pages/data-records/index.js', 'utf8');
  const modalSource = fs.readFileSync('miniprogram/components/feeding-modal/feeding-modal.wxml', 'utf8');
  const quickFeedingStart = dailyFeedingSource.indexOf('quickFeedingData: {');
  const newFeedingStart = dailyFeedingSource.indexOf('newFeeding: {');
  const dataRecordsNewFeedingStart = dataRecordsSource.indexOf('newFeeding: {');
  const quickFeedingBlock = dailyFeedingSource.slice(quickFeedingStart, quickFeedingStart + 400);
  const newFeedingBlock = dailyFeedingSource.slice(newFeedingStart, newFeedingStart + 300);
  const dataRecordsNewFeedingBlock = dataRecordsSource.slice(dataRecordsNewFeedingStart, dataRecordsNewFeedingStart + 300);

  assert.match(quickFeedingBlock, /specialMilkPowder:\s*'0'/);
  assert.doesNotMatch(quickFeedingBlock, /specialPowderWeight:/);
  assert.match(newFeedingBlock, /specialMilkPowder:\s*0/);
  assert.doesNotMatch(newFeedingBlock, /specialPowderWeight:/);
  assert.match(dataRecordsNewFeedingBlock, /specialMilkPowder:\s*0/);
  assert.doesNotMatch(dataRecordsNewFeedingBlock, /specialPowderWeight:/);
  assert.doesNotMatch(modalSource, /specialPowderWeight \|\| feedingData\.specialMilkPowder/);
  assert.match(modalSource, /粉重 \{\{feedingData\.specialMilkPowder \|\| 0\}\} g/);
});

test('feeding saves derive totalVolume from milk volumes instead of requiring raw totalVolume input', () => {
  const dailyFeedingSource = fs.readFileSync('miniprogram/pages/daily-feeding/index.js', 'utf8');
  const dataRecordsSource = fs.readFileSync('miniprogram/pages/data-records/index.js', 'utf8');

  assert.doesNotMatch(dailyFeedingSource, /if \(!naturalMilkVolume \|\| !totalVolume \|\| !startTime\)/);
  assert.doesNotMatch(dailyFeedingSource, /if \(!naturalMilkVolume \|\| !totalVolume\)/);
  assert.doesNotMatch(dataRecordsSource, /if \(!naturalMilkVolume \|\| !totalVolume\)/);

  assert.match(dailyFeedingSource, /const totalVolumeNum = feedingCalculator\.getTotalVolume\(this\.data\.quickFeedingData\);/);
  assert.match(dailyFeedingSource, /totalVolume:\s*feedingCalculator\.getTotalVolume\(this\.data\.newFeeding\)/);
  assert.match(dailyFeedingSource, /totalVolume:\s*Math\.round\(feedingCalculator\.getTotalVolume\(this\.data\.currentFeeding\)\)/);
  assert.match(
    dailyFeedingSource,
    /totalVolume:\s*Math\.round\(feedingCalculator\.getTotalVolume\((this\.data\.)?editingFeeding\)\)/
  );

  assert.match(dataRecordsSource, /totalVolume:\s*feedingCalculator\.getTotalVolume\(this\.data\.newFeeding\)/);
  assert.match(dataRecordsSource, /totalVolume:\s*feedingCalculator\.getTotalVolume\(editingFeeding\)/);
});

test('feeding page no longer back-calculates special milk volume from editable totalVolume field', () => {
  const dailyFeedingSource = fs.readFileSync('miniprogram/pages/daily-feeding/index.js', 'utf8');

  assert.doesNotMatch(dailyFeedingSource, /field === 'naturalMilkVolume' \|\| field === 'totalVolume'/);
  assert.doesNotMatch(dailyFeedingSource, /newFeeding\.specialMilkVolume = Math\.max\(0, totalVolume - naturalMilk\)/);
});

test('daily-feeding exposes a separate milk feeding editor entry', () => {
  const js = fs.readFileSync('miniprogram/pages/daily-feeding/index.js', 'utf8');
  const wxml = fs.readFileSync('miniprogram/pages/daily-feeding/index.wxml', 'utf8');
  const appJson = fs.readFileSync('miniprogram/app.json', 'utf8');

  assert.match(appJson, /"pages\/milk-feeding-editor\/index"/);
  assert.match(wxml, /bindtap="navigateToMilkFeedingEditor"/);
  assert.match(wxml, /<text>添加奶<\/text>/);
  assert.match(js, /navigateToMilkFeedingEditor\(\)\s*\{/);
  assert.match(
    js,
    /navigateToMilkFeedingEditor\(\)\s*\{[\s\S]*?wx\.navigateTo\(\{\s*url:\s*[`'"]\/pages\/milk-feeding-editor\/index/
  );
});
