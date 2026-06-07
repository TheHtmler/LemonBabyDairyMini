const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseArgs,
  stepsToRun,
  resolvePageSize,
  defaultMigrationVersion
} = require('../scripts/lib/milk-v2-migration-cli');

test('parseArgs defaults to dry-run and all steps', () => {
  const options = parseArgs([]);
  assert.equal(options.execute, false);
  assert.equal(options.step, 'all');
  assert.equal(options.maxBatches, 1);
  assert.equal(options.migrationVersion, 'milk-v2');
});

test('parseArgs accepts inline flags', () => {
  const options = parseArgs([
    '--execute',
    '--step=feeding',
    '--baby-uid=baby-1',
    '--migration-version=milk-v2-test',
    '--page-size=15',
    '--max-batches=2',
    '--continue-on-errors'
  ]);
  assert.equal(options.execute, true);
  assert.equal(options.step, 'feeding');
  assert.equal(options.babyUid, 'baby-1');
  assert.equal(options.migrationVersion, 'milk-v2-test');
  assert.equal(options.pageSize, 15);
  assert.equal(options.maxBatches, 2);
  assert.equal(options.continueOnErrors, true);
});

test('stepsToRun maps repair-dates and all', () => {
  assert.deepEqual(stepsToRun('all'), ['profiles', 'feeding', 'growth']);
  assert.deepEqual(stepsToRun('repair-dates'), ['repair-dates']);
  assert.deepEqual(stepsToRun('growth'), ['growth']);
});

test('resolvePageSize uses step defaults', () => {
  assert.equal(resolvePageSize('feeding', { pageSize: null }), 10);
  assert.equal(resolvePageSize('growth', { pageSize: null }), 50);
  assert.equal(resolvePageSize('feeding', { pageSize: 99 }), 99);
});

test('defaultMigrationVersion is fixed for incremental idempotency', () => {
  assert.equal(defaultMigrationVersion(), 'milk-v2');
});

test('wx console script exports runner and maintenance helpers', () => {
  const wxConsole = require('../scripts/milk-v2-migration-wx-console');
  assert.equal(typeof wxConsole.runMilkV2Migration, 'function');
  assert.equal(typeof wxConsole.inspectMilkV2Migration, 'function');
  assert.equal(typeof wxConsole.realignMilkV2Version, 'function');
  assert.equal(typeof wxConsole.cleanupMilkV2Version, 'function');
  assert.equal(wxConsole.defaultMigrationVersion(), 'milk-v2');
});
