#!/usr/bin/env node
/**
 * 本地编排：自动循环云函数 nextOffset，直到 hasMore=false。
 * 需配置 TCB_SECRET_ID / TCB_SECRET_KEY，见 scripts/milk-v2-migration.env.example
 */
const path = require('node:path');
const {
  printHelp,
  parseArgs,
  readJsonFile,
  resolvePageSize,
  stepsToRun
} = require('./lib/milk-v2-migration-cli');

const SUM_FIELDS = {
  profiles: ['migrated', 'skipped'],
  feeding: ['migrated', 'skipped', 'existingSkipped'],
  growth: ['planned', 'added', 'updated', 'skipped'],
  'repair-dates': ['repaired', 'skipped', 'checked']
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadProjectEnvId() {
  try {
    const projectConfig = require(path.join(__dirname, '..', 'project.config.json'));
    return projectConfig.cloudSettings?.defaultEnv || '';
  } catch {
    return '';
  }
}

function createCloudApp() {
  let cloudbase;
  try {
    cloudbase = require('@cloudbase/node-sdk');
  } catch (error) {
    console.error('缺少依赖 @cloudbase/node-sdk，请先执行: npm install');
    throw error;
  }

  const secretId = process.env.TCB_SECRET_ID || process.env.CLOUDBASE_SECRET_ID;
  const secretKey = process.env.TCB_SECRET_KEY || process.env.CLOUDBASE_SECRET_KEY;
  const env = process.env.TCB_ENV || loadProjectEnvId();

  if (!secretId || !secretKey) {
    throw new Error(
      '未配置密钥。请设置 TCB_SECRET_ID / TCB_SECRET_KEY（见 scripts/milk-v2-migration.env.example）'
    );
  }
  if (!env) {
    throw new Error('未配置云环境 ID。请设置 TCB_ENV 或确认 project.config.json 含 cloudSettings.defaultEnv');
  }

  return {
    env,
    app: cloudbase.init({ env, secretId, secretKey })
  };
}

async function callCloudFunction(app, name, data) {
  const response = await app.callFunction({ name, data });
  if (response.code && response.code !== 'SUCCESS') {
    throw new Error(`云函数 ${name} 调用失败: ${response.message || response.code}`);
  }
  return response.result ?? response.data ?? response;
}

function initTotals(step) {
  const totals = { batches: 0 };
  (SUM_FIELDS[step] || []).forEach((field) => {
    totals[field] = 0;
  });
  return totals;
}

function mergeTotals(totals, result, step) {
  totals.batches += result.processedBatches || 1;
  (SUM_FIELDS[step] || []).forEach((field) => {
    totals[field] += Number(result[field]) || 0;
  });
}

function logBatchHeader(functionName, batchNo, offset, dryRun) {
  const mode = dryRun ? 'dry-run' : 'execute';
  console.log(`\n→ ${functionName} #${batchNo} offset=${offset} (${mode})`);
}

function logBatchResult(result) {
  const { warnings = [], errors = [], hasMore, nextOffset, ...rest } = result;
  console.log('  结果:', JSON.stringify(rest));
  if (warnings.length > 0) {
    console.log(`  warnings: ${warnings.length} 条（仅展示前 5 条）`);
    warnings.slice(0, 5).forEach((item) => console.log('   ', JSON.stringify(item)));
  }
  if (errors.length > 0) {
    console.log(`  errors: ${errors.length} 条`);
    errors.slice(0, 10).forEach((item) => console.log('   ', JSON.stringify(item)));
  }
  if (hasMore) {
    console.log(`  继续: nextOffset=${nextOffset}`);
  }
}

function shouldStopOnErrors(result, options) {
  return !options.continueOnErrors && Array.isArray(result.errors) && result.errors.length > 0;
}

async function runPaginatedStep(app, functionName, step, buildPayload, options) {
  const dryRun = !options.execute;
  const pageSize = resolvePageSize(step, options);
  let offset = 0;
  let batchNo = 0;
  const totals = initTotals(step);
  const allWarnings = [];
  const allErrors = [];

  while (true) {
    batchNo += 1;
    logBatchHeader(functionName, batchNo, offset, dryRun);
    const payload = buildPayload({ offset, pageSize, dryRun });
    const result = await callCloudFunction(app, functionName, payload);
    mergeTotals(totals, result, step);
    if (Array.isArray(result.warnings)) allWarnings.push(...result.warnings);
    if (Array.isArray(result.errors)) allErrors.push(...result.errors);
    logBatchResult(result);

    if (shouldStopOnErrors(result, options)) {
      throw new Error(`${functionName} 返回 errors，已中止（可用 --continue-on-errors 跳过）`);
    }

    if (!result.hasMore) break;
    offset = Number(result.nextOffset);
    if (!Number.isFinite(offset)) {
      throw new Error(`${functionName} hasMore=true 但缺少 nextOffset`);
    }
    if (options.delayMs > 0) {
      await sleep(options.delayMs);
    }
  }

  return { totals, warnings: allWarnings, errors: allErrors };
}

async function runProfiles(app, options) {
  const dryRun = !options.execute;
  console.log('\n=== 1/3 配奶档案 migrateNutritionProfiles ===');
  const payload = {
    dryRun,
    pageSize: resolvePageSize('profiles', options)
  };
  if (options.babyUid) payload.babyUid = options.babyUid;

  const result = await callCloudFunction(app, 'migrateNutritionProfiles', payload);
  console.log('结果:', JSON.stringify({
    dryRun: result.dryRun,
    migrated: result.migrated,
    skipped: result.skipped,
    babyUid: result.babyUid || options.babyUid || '(全部)'
  }));
  if (Array.isArray(result.logs) && result.logs.length > 0) {
    console.log('logs（前 10 条）:');
    result.logs.slice(0, 10).forEach((line) => console.log(`  ${line}`));
  }
  return result;
}

async function runFeeding(app, options, powderVersionRules) {
  console.log('\n=== 2/3 喂奶记录 migrateFeedingRecordsV2 ===');
  return runPaginatedStep(
    app,
    'migrateFeedingRecordsV2',
    'feeding',
    ({ offset, pageSize, dryRun }) => {
      const payload = {
        dryRun,
        migrationVersion: options.migrationVersion,
        pageSize,
        maxBatches: options.maxBatches,
        offset
      };
      if (options.babyUid) payload.babyUid = options.babyUid;
      if (options.startDate) payload.startDate = options.startDate;
      if (options.endDate) payload.endDate = options.endDate;
      if (powderVersionRules && Object.keys(powderVersionRules).length > 0) {
        payload.powderVersionRules = powderVersionRules;
      }
      return payload;
    },
    options
  );
}

async function runRepairDates(app, options) {
  console.log('\n=== 修复 date 字段 migrateFeedingRecordsV2 (repairExistingDates) ===');
  return runPaginatedStep(
    app,
    'migrateFeedingRecordsV2',
    'repair-dates',
    ({ offset, pageSize, dryRun }) => {
      const payload = {
        repairExistingDates: true,
        dryRun,
        migrationVersion: options.migrationVersion,
        pageSize,
        maxBatches: options.maxBatches,
        offset
      };
      if (options.babyUid) payload.babyUid = options.babyUid;
      if (options.startDate) payload.startDate = options.startDate;
      if (options.endDate) payload.endDate = options.endDate;
      return payload;
    },
    options
  );
}

async function runGrowth(app, options) {
  console.log('\n=== 3/3 成长回填 backfillGrowthRecordsV2 ===');
  return runPaginatedStep(
    app,
    'backfillGrowthRecordsV2',
    'growth',
    ({ offset, pageSize, dryRun }) => {
      const payload = {
        dryRun,
        pageSize,
        maxBatches: options.maxBatches,
        offset,
        includeBabyInfoInitial: options.includeBabyInfoInitial
      };
      if (options.babyUid) payload.babyUid = options.babyUid;
      if (options.startDate) payload.startDate = options.startDate;
      if (options.endDate) payload.endDate = options.endDate;
      if (options.legacyGrowthCollections.length > 0) {
        payload.legacyGrowthCollections = options.legacyGrowthCollections;
      }
      return payload;
    },
    options
  );
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    return;
  }

  const { env, app } = createCloudApp();
  const powderVersionRules = options.powderRulesFile
    ? readJsonFile(options.powderRulesFile)
    : {};
  const steps = stepsToRun(options.step);

  console.log('奶粉 v2 迁移编排');
  console.log(`  环境: ${env}`);
  console.log(`  模式: ${options.execute ? '正式写入' : 'dry-run（预览，加 --execute 才写入）'}`);
  console.log(`  步骤: ${steps.join(' → ')}`);
  console.log(`  migrationVersion: ${options.migrationVersion}`);
  if (options.babyUid) console.log(`  babyUid: ${options.babyUid}`);
  if (options.startDate || options.endDate) {
    console.log(`  日期范围: ${options.startDate || '*'} ~ ${options.endDate || '*'}`);
  }

  const summary = {};

  for (const step of steps) {
    if (step === 'profiles') {
      summary.profiles = await runProfiles(app, options);
      continue;
    }
    if (step === 'feeding') {
      summary.feeding = await runFeeding(app, options, powderVersionRules);
      continue;
    }
    if (step === 'repair-dates') {
      summary.repairDates = await runRepairDates(app, options);
      continue;
    }
    if (step === 'growth') {
      summary.growth = await runGrowth(app, options);
    }
  }

  console.log('\n========== 完成 ==========');
  console.log(JSON.stringify(summary, null, 2));

  if (!options.execute) {
    console.log('\n当前为 dry-run。确认无误后请加 --execute 正式迁移。');
  }
}

main().catch((error) => {
  console.error('\n迁移失败:', error.message || error);
  process.exitCode = 1;
});
