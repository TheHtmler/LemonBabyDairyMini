/**
 * 奶粉 v2 迁移 —— 微信开发者工具控制台编排版（无需任何密钥）
 *
 * 用法：
 *  1. 用微信开发者工具打开本项目，确保已选中云开发环境、云函数已部署。
 *  2. 打开「调试器 / Console」面板。
 *  3. 把本文件全部内容复制粘贴进 Console，回车（此步只是定义函数，不会写库）。
 *  4. 先 dry-run 预览（默认不写库）：
 *       runMilkV2Migration({ babyUid: '替换为测试宝宝babyUid' })
 *  5. 确认无误后正式迁移（execute: true 才会写库）：
 *       runMilkV2Migration({ babyUid: '替换为测试宝宝babyUid', execute: true })
 *  6. 全量：去掉 babyUid 即可。
 *
 * 选项（options 字段）：
 *  execute        Boolean  默认 false（dry-run，不写库）
 *  step           String   'all'|'profiles'|'feeding'|'growth'|'repair-dates'，默认 'all'
 *  babyUid        String   只处理指定宝宝；省略则全量
 *  migrationVersion String 喂奶迁移版本号，默认 milk-v2（固定不变以保证增量幂等）
 *  pageSize       Number   每批文档数（默认 profiles=50 feeding=10 growth=50）
 *  maxBatches     Number   每次云函数调用处理的批次数，默认 1（防超时）
 *  delayMs        Number   批次间休眠毫秒，默认 300
 *  startDate      String   'YYYY-MM-DD'
 *  endDate        String   'YYYY-MM-DD'
 *  includeBabyInfoInitial Boolean 成长回填是否含 baby_info 初值，默认 false
 *  legacyGrowthCollections Array  额外旧成长集合
 *  powderVersionRules Object 历史换奶时间段规则
 *  continueOnErrors Boolean 遇 errors 仍继续，默认 false
 */
(function () {
  // 固定不含日期：默认值在不同天调用时保持稳定，避免增量补迁误用新版本号导致喂奶记录翻倍。
  function defaultMigrationVersion() {
    return 'milk-v2';
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function resolvePageSize(step, options) {
    if (options.pageSize > 0) return options.pageSize;
    if (step === 'feeding' || step === 'repair-dates') return 10;
    return 50;
  }

  function getCloud() {
    if (typeof wx === 'undefined') {
      throw new Error('当前不在小程序环境。请在微信开发者工具的「调试器 / Console」里运行。');
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      throw new Error('当前 Console 上下文没有 wx.cloud（多半在渲染层/页面 WebView）。请把调试器 Console 顶部的执行上下文下拉切到「AppService / 逻辑层」后重新粘贴运行；可先敲 wx.cloud 回车确认不是 undefined。');
    }
    return wx.cloud;
  }

  function callFn(name, data) {
    return getCloud().callFunction({ name: name, data: data }).then(function (res) {
      var result = res && res.result;
      if (!result) {
        throw new Error('云函数 ' + name + ' 无返回结果');
      }
      return result;
    });
  }

  function logResult(result) {
    var warnings = result.warnings || [];
    var errors = result.errors || [];
    var rest = Object.assign({}, result);
    delete rest.warnings;
    delete rest.errors;
    console.log('  结果:', rest);
    if (warnings.length) {
      console.log('  warnings: ' + warnings.length + ' 条（前 5 条）');
      warnings.slice(0, 5).forEach(function (w) { console.log('   ', w); });
    }
    if (errors.length) {
      console.log('  errors: ' + errors.length + ' 条');
      errors.slice(0, 10).forEach(function (e) { console.log('   ', e); });
    }
  }

  async function runPaginated(functionName, step, buildPayload, options) {
    var dryRun = !options.execute;
    var pageSize = resolvePageSize(step, options);
    var offset = 0;
    var batchNo = 0;
    var totals = { batches: 0 };
    var allWarnings = [];
    var allErrors = [];

    while (true) {
      batchNo += 1;
      console.log('\n→ ' + functionName + ' #' + batchNo + ' offset=' + offset + ' (' + (dryRun ? 'dry-run' : 'execute') + ')');
      var payload = buildPayload({ offset: offset, pageSize: pageSize, dryRun: dryRun });
      var result = await callFn(functionName, payload);
      totals.batches += result.processedBatches || 1;
      ['migrated', 'skipped', 'existingSkipped', 'planned', 'added', 'updated', 'repaired', 'checked', 'matched', 'removed'].forEach(function (field) {
        if (typeof result[field] === 'number') {
          totals[field] = (totals[field] || 0) + result[field];
        }
      });
      if (Array.isArray(result.warnings)) allWarnings = allWarnings.concat(result.warnings);
      if (Array.isArray(result.errors)) allErrors = allErrors.concat(result.errors);
      logResult(result);

      if (!options.continueOnErrors && Array.isArray(result.errors) && result.errors.length) {
        throw new Error(functionName + ' 返回 errors，已中止（传 continueOnErrors:true 可跳过）');
      }

      if (!result.hasMore) break;
      offset = Number(result.nextOffset);
      if (!isFinite(offset)) {
        throw new Error(functionName + ' hasMore=true 但缺少 nextOffset');
      }
      if (options.delayMs > 0) await sleep(options.delayMs);
    }

    return { totals: totals, warnings: allWarnings, errors: allErrors };
  }

  async function runProfiles(options) {
    var dryRun = !options.execute;
    console.log('\n=== 配奶档案 migrateNutritionProfiles ===');
    var payload = { dryRun: dryRun, pageSize: resolvePageSize('profiles', options) };
    if (options.babyUid) payload.babyUid = options.babyUid;
    var result = await callFn('migrateNutritionProfiles', payload);
    console.log('结果:', { dryRun: result.dryRun, migrated: result.migrated, skipped: result.skipped, babyUid: result.babyUid || options.babyUid || '(全部)' });
    if (Array.isArray(result.logs) && result.logs.length) {
      console.log('logs（前 10 条）:');
      result.logs.slice(0, 10).forEach(function (line) { console.log('  ' + line); });
    }
    return result;
  }

  function runFeeding(options) {
    console.log('\n=== 喂奶记录 migrateFeedingRecordsV2 ===');
    return runPaginated('migrateFeedingRecordsV2', 'feeding', function (ctx) {
      var payload = {
        dryRun: ctx.dryRun,
        migrationVersion: options.migrationVersion,
        pageSize: ctx.pageSize,
        maxBatches: options.maxBatches,
        offset: ctx.offset
      };
      if (options.babyUid) payload.babyUid = options.babyUid;
      if (options.startDate) payload.startDate = options.startDate;
      if (options.endDate) payload.endDate = options.endDate;
      if (options.powderVersionRules && Object.keys(options.powderVersionRules).length) {
        payload.powderVersionRules = options.powderVersionRules;
      }
      return payload;
    }, options);
  }

  function runRepairDates(options) {
    console.log('\n=== 修复 date 字段 migrateFeedingRecordsV2 (repairExistingDates) ===');
    return runPaginated('migrateFeedingRecordsV2', 'repair-dates', function (ctx) {
      var payload = {
        repairExistingDates: true,
        dryRun: ctx.dryRun,
        migrationVersion: options.migrationVersion,
        pageSize: ctx.pageSize,
        maxBatches: options.maxBatches,
        offset: ctx.offset
      };
      if (options.babyUid) payload.babyUid = options.babyUid;
      if (options.startDate) payload.startDate = options.startDate;
      if (options.endDate) payload.endDate = options.endDate;
      return payload;
    }, options);
  }

  function runGrowth(options) {
    console.log('\n=== 成长回填 backfillGrowthRecordsV2 ===');
    return runPaginated('backfillGrowthRecordsV2', 'growth', function (ctx) {
      var payload = {
        dryRun: ctx.dryRun,
        pageSize: ctx.pageSize,
        maxBatches: options.maxBatches,
        offset: ctx.offset,
        includeBabyInfoInitial: options.includeBabyInfoInitial === true
      };
      if (options.babyUid) payload.babyUid = options.babyUid;
      if (options.startDate) payload.startDate = options.startDate;
      if (options.endDate) payload.endDate = options.endDate;
      if (Array.isArray(options.legacyGrowthCollections) && options.legacyGrowthCollections.length) {
        payload.legacyGrowthCollections = options.legacyGrowthCollections;
      }
      return payload;
    }, options);
  }

  function stepsToRun(step) {
    if (step === 'repair-dates') return ['repair-dates'];
    if (step === 'profiles' || step === 'feeding' || step === 'growth') return [step];
    return ['profiles', 'feeding', 'growth'];
  }

  async function runMilkV2Migration(rawOptions) {
    var options = Object.assign({
      execute: false,
      step: 'all',
      babyUid: '',
      migrationVersion: defaultMigrationVersion(),
      pageSize: null,
      maxBatches: 1,
      delayMs: 300,
      startDate: '',
      endDate: '',
      includeBabyInfoInitial: false,
      legacyGrowthCollections: [],
      powderVersionRules: {},
      continueOnErrors: false
    }, rawOptions || {});

    if (!(options.maxBatches > 0)) options.maxBatches = 1;
    if (!(options.delayMs >= 0)) options.delayMs = 300;

    var steps = stepsToRun(options.step);
    console.log('奶粉 v2 迁移编排（开发者工具控制台）');
    console.log('  模式: ' + (options.execute ? '正式写入' : 'dry-run（预览，传 execute:true 才写入）'));
    console.log('  步骤: ' + steps.join(' → '));
    console.log('  migrationVersion: ' + options.migrationVersion);
    if (options.babyUid) console.log('  babyUid: ' + options.babyUid);
    if (options.startDate || options.endDate) {
      console.log('  日期范围: ' + (options.startDate || '*') + ' ~ ' + (options.endDate || '*'));
    }

    var summary = {};
    for (var i = 0; i < steps.length; i += 1) {
      var step = steps[i];
      if (step === 'profiles') summary.profiles = await runProfiles(options);
      else if (step === 'feeding') summary.feeding = await runFeeding(options);
      else if (step === 'repair-dates') summary.repairDates = await runRepairDates(options);
      else if (step === 'growth') summary.growth = await runGrowth(options);
    }

    console.log('\n========== 完成 ==========');
    console.log(summary);
    if (!options.execute) {
      console.log('\n当前为 dry-run。确认无误后请传 execute:true 正式迁移。');
    }
    return summary;
  }

  // 只读诊断：盘清 feeding_records_v2 现状（各版本号条数、是否翻倍、用户新建记录数）。
  async function inspectMilkV2Migration(rawOptions) {
    var options = rawOptions || {};
    console.log('=== 诊断 feeding_records_v2 迁移现状 ===');
    var payload = { inspect: true };
    if (options.babyUid) payload.babyUid = options.babyUid;
    if (options.toVersion) payload.toVersion = options.toVersion;
    var result = await callFn('migrateFeedingRecordsV2', payload);
    console.log('v2 总数:', result.totalV2);
    console.log('迁移记录(source=legacy_migration):', result.migrationTotal);
    console.log('用户新建记录(非迁移):', result.nonMigrationTotal);
    console.log('版本号分布:');
    (result.versionCounts || []).forEach(function (item) {
      console.log('  ' + item.migrationVersion + ' : ' + item.count);
    });
    console.log('重复组数(同 legacyRecordId+index 出现多次):', result.duplicateGroups);
    if (result.duplicateGroups > 0) {
      console.log('  ⚠️ 检测到翻倍，建议走「清空重迁」而非「对齐版本号」。样例:', result.duplicateSamples);
    }
    console.log('\n建议：');
    if (result.duplicateGroups > 0) {
      console.log('  有重复 → cleanupMilkV2Version({ execute:true }) 清空后 runMilkV2Migration({ step:"feeding", execute:true }) 重迁');
    } else if ((result.versionCounts || []).length === 0) {
      console.log('  无历史迁移记录 → 直接 runMilkV2Migration({ execute:true }) 即可');
    } else if (result.versionCounts.length === 1 && result.versionCounts[0].migrationVersion === (options.toVersion || 'milk-v2')) {
      console.log('  已是目标版本号 → 直接用默认 runMilkV2Migration 增量即可');
    } else {
      console.log('  单一旧版本、无翻倍 → realignMilkV2Version({ execute:true }) 对齐到 milk-v2');
    }
    return result;
  }

  // 把旧版本号迁移记录统一改成 milk-v2（默认 dry-run，传 execute:true 才写）。
  function realignMilkV2Version(rawOptions) {
    var options = Object.assign({
      execute: false,
      babyUid: '',
      toVersion: 'milk-v2',
      fromVersions: [],
      pageSize: null,
      maxBatches: 1,
      delayMs: 300,
      continueOnErrors: false
    }, rawOptions || {});
    console.log('\n=== 对齐迁移版本号 → ' + options.toVersion + ' ===');
    return runPaginated('migrateFeedingRecordsV2', 'realign', function (ctx) {
      var payload = {
        realignVersion: true,
        dryRun: ctx.dryRun,
        toVersion: options.toVersion,
        pageSize: ctx.pageSize,
        maxBatches: options.maxBatches,
        offset: ctx.offset
      };
      if (options.babyUid) payload.babyUid = options.babyUid;
      if (Array.isArray(options.fromVersions) && options.fromVersions.length) {
        payload.fromVersions = options.fromVersions;
      }
      return payload;
    }, options);
  }

  // 删除迁移记录（仅 source:legacy_migration），用于清空重迁（默认 dry-run）。
  function cleanupMilkV2Version(rawOptions) {
    var options = Object.assign({
      execute: false,
      babyUid: '',
      migrationVersions: [],
      pageSize: null,
      maxBatches: 1,
      delayMs: 300,
      continueOnErrors: false
    }, rawOptions || {});
    console.log('\n=== 清理迁移记录 source=legacy_migration ===');
    return runPaginated('migrateFeedingRecordsV2', 'cleanup', function (ctx) {
      var payload = {
        cleanupMigrated: true,
        dryRun: ctx.dryRun,
        pageSize: ctx.pageSize,
        maxBatches: options.maxBatches,
        offset: ctx.offset
      };
      if (options.babyUid) payload.babyUid = options.babyUid;
      if (Array.isArray(options.migrationVersions) && options.migrationVersions.length) {
        payload.migrationVersions = options.migrationVersions;
      }
      return payload;
    }, options);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      runMilkV2Migration: runMilkV2Migration,
      inspectMilkV2Migration: inspectMilkV2Migration,
      realignMilkV2Version: realignMilkV2Version,
      cleanupMilkV2Version: cleanupMilkV2Version,
      defaultMigrationVersion: defaultMigrationVersion
    };
  }
  var g = typeof globalThis !== 'undefined' ? globalThis : (typeof wx !== 'undefined' ? wx : this);
  if (g) {
    g.runMilkV2Migration = runMilkV2Migration;
    g.inspectMilkV2Migration = inspectMilkV2Migration;
    g.realignMilkV2Version = realignMilkV2Version;
    g.cleanupMilkV2Version = cleanupMilkV2Version;
  }

  if (typeof wx !== 'undefined') {
    console.log('已加载：runMilkV2Migration() / inspectMilkV2Migration() / realignMilkV2Version() / cleanupMilkV2Version()');
    console.log('之前迁移过的先诊断：inspectMilkV2Migration()');
  }
})();
