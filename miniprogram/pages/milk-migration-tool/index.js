// 临时迁移工具页（上线前删除整个 pages/milk-migration-tool 目录 + app.json 注册）
// 在小程序逻辑层运行，wx.cloud 一定可用；自动循环 nextOffset 跑完全量，无需密钥。

const FEEDING_FN = 'migrateFeedingRecordsV2';
const PROFILE_FN = 'migrateNutritionProfiles';
const GROWTH_FN = 'backfillGrowthRecordsV2';
const MIGRATION_VERSION = 'milk-v2';
const DELAY_MS = 200;
const MAX_LOGS = 200;

const ACC_FIELDS = [
  'migrated', 'skipped', 'existingSkipped', 'planned', 'added',
  'updated', 'matched', 'removed', 'repaired', 'checked'
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function callFn(name, data) {
  return wx.cloud.callFunction({ name, data }).then((res) => {
    const result = res && res.result;
    if (!result) {
      throw new Error(`云函数 ${name} 无返回结果`);
    }
    return result;
  });
}

Page({
  data: {
    running: false,
    babyUid: '',
    statusText: '空闲。建议顺序：诊断 → 全量预览 → 全量迁移(执行)',
    logs: []
  },

  onBabyUidInput(e) {
    this.setData({ babyUid: (e.detail.value || '').trim() });
  },

  appendLog(text) {
    const time = new Date().toLocaleTimeString();
    const logs = this.data.logs.concat(`[${time}] ${text}`);
    if (logs.length > MAX_LOGS) {
      logs.splice(0, logs.length - MAX_LOGS);
    }
    this.setData({ logs });
  },

  startRun(label) {
    this._aborted = false;
    this.setData({ running: true, statusText: `进行中：${label}` });
    this.appendLog(`==== 开始：${label} ====`);
  },

  endRun(label) {
    this.setData({ running: false, statusText: `空闲（上次：${label || '完成'}）` });
    this.appendLog(`==== 结束：${label || ''} ====`);
  },

  onAbort() {
    this._aborted = true;
    this.appendLog('已请求停止，将在当前批次后中止…');
  },

  briefResult(r) {
    const parts = ACC_FIELDS
      .filter((k) => typeof r[k] === 'number')
      .map((k) => `${k}=${r[k]}`);
    return parts.join(' ') + (r.hasMore ? ' (还有下一批)' : '');
  },

  withBaby(payload) {
    if (this.data.babyUid) payload.babyUid = this.data.babyUid;
    return payload;
  },

  async runPaginated(functionName, buildPayload, options) {
    const { execute, maxBatches = 3, pageSize = 50 } = options;
    const dryRun = !execute;
    let offset = 0;
    let batchNo = 0;
    const totals = { batches: 0 };

    while (true) {
      if (this._aborted) {
        this.appendLog(`${functionName} 已中止，offset=${offset}`);
        break;
      }
      batchNo += 1;
      const payload = buildPayload({ offset, pageSize, dryRun, maxBatches });
      this.appendLog(`${functionName} #${batchNo} 开始调用 offset=${offset} pageSize=${pageSize} maxBatches=${maxBatches}`);
      const result = await callFn(functionName, payload);
      totals.batches += result.processedBatches || 1;
      ACC_FIELDS.forEach((f) => {
        if (typeof result[f] === 'number') totals[f] = (totals[f] || 0) + result[f];
      });
      this.appendLog(`${functionName} #${batchNo} offset=${offset} ${dryRun ? '预览' : '执行'} → ${this.briefResult(result)}`);

      if (Array.isArray(result.errors) && result.errors.length) {
        this.appendLog(`⚠️ errors ${result.errors.length} 条，样例：${JSON.stringify(result.errors[0])}`);
        throw new Error(`${functionName} 返回 errors，已停止`);
      }

      if (!result.hasMore) break;
      offset = Number(result.nextOffset);
      if (!isFinite(offset)) {
        throw new Error(`${functionName} hasMore=true 但缺少 nextOffset`);
      }
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }

    return totals;
  },

  async runProfiles(execute) {
    return this.runPaginated(PROFILE_FN, ({ offset, pageSize, dryRun, maxBatches }) => this.withBaby({
      dryRun,
      pageSize,
      maxBatches,
      offset
    }), { execute, maxBatches: 1, pageSize: 20 });
  },

  runFeeding(execute) {
    return this.runPaginated(FEEDING_FN, ({ offset, pageSize, dryRun, maxBatches }) => this.withBaby({
      dryRun,
      migrationVersion: MIGRATION_VERSION,
      pageSize,
      maxBatches,
      offset
    }), { execute, maxBatches: 1, pageSize: 20 });
  },

  runGrowth(execute) {
    return this.runPaginated(GROWTH_FN, ({ offset, pageSize, dryRun, maxBatches }) => this.withBaby({
      dryRun,
      pageSize,
      maxBatches,
      offset,
      includeBabyInfoInitial: true
    }), { execute, maxBatches: 1, pageSize: 20 });
  },

  async runFull(execute) {
    const label = execute ? '全量迁移(执行)' : '全量预览(dry-run)';
    this.startRun(label);
    try {
      const scope = this.data.babyUid ? `babyUid=${this.data.babyUid}` : '全部宝宝';
      this.appendLog(`范围：${scope}，版本号：${MIGRATION_VERSION}`);

      this.appendLog('— 1/3 配奶档案 —');
      const profiles = await this.runProfiles(execute);
      if (this._aborted) { this.endRun(label + '(已中止)'); return; }

      this.appendLog('— 2/3 喂奶记录 —');
      const feeding = await this.runFeeding(execute);
      if (this._aborted) { this.endRun(label + '(已中止)'); return; }

      this.appendLog('— 3/3 成长回填 —');
      const growth = await this.runGrowth(execute);

      this.appendLog('汇总: ' + JSON.stringify({
        profiles,
        feeding,
        growth
      }));
      this.appendLog(execute
        ? '✅ 全量迁移执行完成。建议再点一次「诊断现状」核对。'
        : 'ℹ️ 预览完成。feeding 的 errors 为 0、warnings 可接受后，再点「全量迁移(执行)」。');
      this.endRun(label);
    } catch (error) {
      this.appendLog('❌ ' + (error.message || error));
      this.endRun(label + '(出错)');
    }
  },

  onFullDryRun() {
    this.runFull(false);
  },

  onFullExecute() {
    wx.showModal({
      title: '确认全量迁移',
      content: this.data.babyUid
        ? `将正式写入 babyUid=${this.data.babyUid} 的 v2 数据`
        : '将正式写入【全部宝宝】的 v2 数据，确认执行？',
      confirmText: '执行',
      confirmColor: '#e64340',
      success: (res) => {
        if (res.confirm) this.runFull(true);
      }
    });
  },

  async onInspect() {
    this.startRun('诊断现状');
    try {
      const r = await callFn(FEEDING_FN, this.withBaby({ inspect: true }));
      this.appendLog(`v2 总数=${r.totalV2} 迁移=${r.migrationTotal} 非迁移(用户新建)=${r.nonMigrationTotal}`);
      (r.versionCounts || []).forEach((v) => this.appendLog(`  版本 ${v.migrationVersion}: ${v.count}`));
      this.appendLog(`  重复组(翻倍)=${r.duplicateGroups}`);
      this.endRun('诊断现状');
    } catch (error) {
      this.appendLog('❌ ' + (error.message || error));
      this.endRun('诊断现状(出错)');
    }
  },

  onRealign() {
    wx.showModal({
      title: '对齐版本号',
      content: '把旧版本号迁移记录统一改成 milk-v2，确认执行？',
      confirmText: '执行',
      success: async (res) => {
        if (!res.confirm) return;
        this.startRun('对齐版本号');
        try {
          const totals = await this.runPaginated(FEEDING_FN, ({ offset, pageSize, dryRun, maxBatches }) => this.withBaby({
            realignVersion: true,
            dryRun,
            toVersion: MIGRATION_VERSION,
            pageSize,
            maxBatches,
            offset
          }), { execute: true, maxBatches: 5, pageSize: 200 });
          this.appendLog('对齐汇总: ' + JSON.stringify(totals));
          this.endRun('对齐版本号');
        } catch (error) {
          this.appendLog('❌ ' + (error.message || error));
          this.endRun('对齐版本号(出错)');
        }
      }
    });
  },

  onCleanup() {
    wx.showModal({
      title: '清理迁移记录',
      content: '删除 source=legacy_migration 的迁移记录（不动用户新建记录），用于清空重迁。确认执行？',
      confirmText: '删除',
      confirmColor: '#e64340',
      success: async (res) => {
        if (!res.confirm) return;
        this.startRun('清理迁移记录');
        try {
          const totals = await this.runPaginated(FEEDING_FN, ({ offset, pageSize, dryRun, maxBatches }) => this.withBaby({
            cleanupMigrated: true,
            dryRun,
            pageSize,
            maxBatches,
            offset
          }), { execute: true, maxBatches: 5, pageSize: 200 });
          this.appendLog('清理汇总: ' + JSON.stringify(totals));
          this.endRun('清理迁移记录');
        } catch (error) {
          this.appendLog('❌ ' + (error.message || error));
          this.endRun('清理迁移记录(出错)');
        }
      }
    });
  }
});
