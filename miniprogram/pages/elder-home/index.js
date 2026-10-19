const DailyRecordV2Service = require('../../utils/dailyRecordV2Service');
const { getCurrentBabyUid } = require('../../utils/babyAccount');
const { buildElderRecords } = require('../../utils/elderRecords');
const { isElderMode, exitElderMode, consumeRecordSaved } = require('../../utils/elderMode');

const SleepRecordModel = require('../../models/sleepRecord');
const TreatmentRecordModel = require('../../models/treatmentRecord');
const WaterRecordModel = require('../../models/waterRecord');
const MedicationRecordModel = require('../../models/medicationRecord');
const FeedingRecordV2Model = require('../../models/feedingRecordV2');
const FoodIntakeRecordModel = require('../../models/foodIntakeRecord');
const DailySummaryV2Model = require('../../models/dailySummaryV2');

const EDIT_PAGES = {
  milk: '/pkg-milk/milk-feeding-editor-v2/index',
  medication: '/pkg-records/medication-record/index',
  water: '/pkg-records/water-record/index',
  bowel: '/pkg-records/bowel-record/index',
  food: '/pkg-records/meal-editor/index',
  treatment: '/pkg-records/treatment-record/index',
  sleep: '/pkg-records/sleep-record/index'
};
const COLLECTIONS = {
  milk: 'feeding_records_v2', medication: 'medication_records', water: 'water_records',
  bowel: 'bowel_records', food: 'food_intake_records', treatment: 'treatment_records', sleep: 'sleep_records'
};

function getElderRecordEditUrl(record, date) {
  const path = EDIT_PAGES[record.type];
  if (!path || !record.canManage || !record.recordId) return '';
  const query = { date, mode: 'edit', source: 'elder', from: 'elder' };
  if (record.type === 'food' && record.mealBatchId) query.mealBatchId = record.mealBatchId;
  else if (['milk', 'medication', 'food'].includes(record.type)) query.recordId = record.recordId;
  else query.id = record.recordId;
  return `${path}?${Object.keys(query).map(key => `${key}=${encodeURIComponent(query[key])}`).join('&')}`;
}

function ensureBaby(babyUid) {
  if (!babyUid || babyUid !== getCurrentBabyUid()) throw new Error('宝宝已切换，请刷新后再操作');
}

async function deleteElderRecord(record, babyUid, date) {
  ensureBaby(babyUid);
  const collection = COLLECTIONS[record.type];
  if (!collection || !record.canManage || !record.recordId) throw new Error('未找到可删除的记录');
  const db = wx.cloud.database();
  // 真实记录编号独立于展示编号；删除前确认仍属于当前宝宝。
  if (record.type === 'food' && record.mealBatchId) {
    const current = await FoodIntakeRecordModel.findByMealBatch(babyUid, date, record.mealBatchId);
    const ids = current.map(item => String(item._id)).sort();
    if (!ids.length || JSON.stringify(ids) !== JSON.stringify(record.recordIds.slice().sort())) {
      throw new Error('这餐记录已变化，请刷新后再操作');
    }
    if (current.some(item => record.recordVersions[item._id]
      && record.recordVersions[item._id] !== JSON.stringify(item.updatedAt))) {
      throw new Error('这餐记录已更新，请刷新后再操作');
    }
  } else {
    const result = await db.collection(collection).doc(record.recordId).get();
    const current = result.data;
    if (!current || current.babyUid !== babyUid || ['deleted', 'archived'].includes(current.status) || current.deletedAt
      || (record.recordVersion && record.recordVersion !== JSON.stringify(current.updatedAt))) {
      throw new Error('记录已变化，请刷新后再操作');
    }
  }
  ensureBaby(babyUid);
  const options = { babyUid, operatorOpenid: wx.getStorageSync('openid') || '' };
  let result;
  try {
    switch (record.type) {
      case 'milk':
        await FeedingRecordV2Model.deleteRecord(record.recordId, options);
        break;
      case 'medication':
        await MedicationRecordModel.deleteRecord(record.recordId);
        break;
      case 'water': result = await WaterRecordModel.delete(record.recordId); break;
      case 'treatment': result = await TreatmentRecordModel.delete(record.recordId); break;
      case 'sleep': result = await SleepRecordModel.delete(record.recordId); break;
      case 'bowel': await db.collection(collection).doc(record.recordId).remove(); break;
      case 'food':
        if (record.mealBatchId) await FoodIntakeRecordModel.deleteMealBatch(babyUid, date, record.mealBatchId, options);
        else await FoodIntakeRecordModel.softDeleteFoodIntake(record.recordId, options);
        break;
    }
    if (result && result.success === false) throw new Error(result.message || '删除失败，请重试');
  } finally {
    // 整餐若只删掉一部分也要刷新汇总，避免失败重试时仍显示旧统计。
    if (record.type === 'food' || record.type === 'bowel') {
      try { await DailySummaryV2Model.markDirty(babyUid, date); }
      catch (error) { console.error('删除后标记汇总失效失败:', error); }
    }
  }
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const RECORD_PAGES = {
  milk: '/pkg-milk/milk-feeding-editor-v2/index',
  medication: '/pkg-records/medication-record/index',
  water: '/pkg-records/water-record/index',
  bowel: '/pkg-records/bowel-record/index',
  food: '/pkg-records/meal-editor/index'
};

const RECORD_FILTERS = [
  { type: 'all', label: '全部' },
  { type: 'milk', label: '喂奶' },
  { type: 'medication', label: '用药' },
  { type: 'water', label: '喝水' },
  { type: 'bowel', label: '便便' },
  { type: 'food', label: '食物' },
  { type: 'other', label: '其他' }
];

// 分类只筛选已读取的共享记录，不改变取数和统计口径。
function recordView(records, selectedType) {
  const counts = { all: records.length, milk: 0, medication: 0, water: 0, bowel: 0, food: 0, other: 0 };
  records.forEach(record => {
    const type = Object.prototype.hasOwnProperty.call(RECORD_PAGES, record.type) ? record.type : 'other';
    counts[type] += 1;
  });
  const selectedFilter = RECORD_FILTERS.find(filter => filter.type === selectedType) || RECORD_FILTERS[0];
  return {
    records,
    recordFilters: RECORD_FILTERS.map(filter => ({ ...filter, count: counts[filter.type] })),
    selectedRecordType: selectedFilter.type,
    selectedRecordLabel: selectedFilter.label,
    visibleRecords: records.filter(record => selectedFilter.type === 'all'
      || (selectedFilter.type === 'other'
        ? !Object.prototype.hasOwnProperty.call(RECORD_PAGES, record.type)
        : record.type === selectedFilter.type))
  };
}

Page({
  data: {
    babyName: '',
    babyUid: '',
    today: '',
    loading: true,
    error: '',
    deletingRecordId: '',
    activeTab: 'entry',
    ...recordView([], 'all'),
    saved: false,
    actions: [
      { type: 'milk', label: '记奶', icon: '🍼', hint: '奶量与时间' },
      { type: 'food', label: '记食物', icon: '🥣', hint: '食物与分量' },
      { type: 'medication', label: '记药', icon: '💊', hint: '服用后打卡' },
      { type: 'water', label: '记喝水', icon: '💧', hint: '喝了多少水' },
      { type: 'bowel', label: '记便便', icon: '🧻', hint: '时间与性状' }
    ]
  },

  onShow() {
    this._visible = true;
    this._openingRecord = false;
    if (!isElderMode()) {
      wx.switchTab({ url: '/pages/daily-feeding/index' });
      return;
    }
    if (consumeRecordSaved()) {
      this.setData({ saved: true, activeTab: 'records', ...recordView(this.data.records, 'all') });
      wx.showToast({ title: '记录已更新', icon: 'success' });
    }
    this.loadRecords();
  },

  onHide() {
    this._visible = false;
    clearTimeout(this._midnightTimer);
  },

  onUnload() {
    this._disposed = true;
    this._visible = false;
    this._loadVersion = (this._loadVersion || 0) + 1;
    clearTimeout(this._midnightTimer);
  },

  onPullDownRefresh() {
    return this.loadRecords().finally(() => wx.stopPullDownRefresh());
  },

  switchTab(e) {
    const activeTab = e.currentTarget.dataset.tab;
    if (activeTab !== 'entry' && activeTab !== 'records') return;
    this.setData({ activeTab });
  },

  selectRecordType(e) {
    const type = e.currentTarget.dataset.type;
    if (!RECORD_FILTERS.some(filter => filter.type === type)) return;
    this.setData(recordView(this.data.records, type));
  },

  async loadRecords() {
    const version = this._loadVersion = (this._loadVersion || 0) + 1;
    const date = todayKey();
    const changedDay = this.data.today !== date;
    this.setData({
      loading: true, error: '', today: date,
      ...(changedDay ? { ...recordView([], this.data.selectedRecordType), saved: false } : {})
    });
    try {
      const app = getApp();
      const initialized = await app.waitForInitialization();
      if (!initialized.userRole || !initialized.babyInfoValid) {
        if (version === this._loadVersion) wx.reLaunch({ url: '/pages/role-selection/index' });
        return;
      }
      const babyUid = getCurrentBabyUid();
      const babyInfo = await app.getBabyInfo({ refreshAvatar: false });
      if (version !== this._loadVersion) return;
      if (!babyUid || !babyInfo || babyInfo.babyUid !== babyUid) throw new Error('宝宝信息暂时无法加载');
      this.setData({
        babyUid,
        babyName: babyInfo.name || '宝宝',
        ...(this.data.babyUid !== babyUid ? recordView([], 'all') : {})
      });
      // 每次返回都重新获取共享明细，保证其他家庭成员的新记录也可见。
      const daily = await DailyRecordV2Service.getDailyRecordV2(babyUid, date, {
        forceRefresh: true,
        strictErrors: true,
        allRecords: true
      });
      if (version !== this._loadVersion || babyUid !== getCurrentBabyUid()) return;
      if (date !== todayKey()) return this.loadRecords();
      this.setData(recordView(buildElderRecords(daily), this.data.selectedRecordType));
    } catch (error) {
      console.error('加载长辈首页失败:', error);
      if (version === this._loadVersion) this.setData({ error: '记录暂时加载失败，请点击重试' });
    } finally {
      if (version === this._loadVersion) {
        this.setData({ loading: false });
        this.scheduleNextDay();
      }
    }
  },

  scheduleNextDay() {
    clearTimeout(this._midnightTimer);
    if (!this._visible) return;
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    this._midnightTimer = setTimeout(() => this.loadRecords(), midnight.getTime() - now.getTime() + 100);
  },

  openRecord(e) {
    const path = RECORD_PAGES[e.currentTarget.dataset.type];
    if (!path || this._openingRecord || this.data.deletingRecordId || !this.data.babyUid) return;
    this._openingRecord = true;
    this.setData({ saved: false });
    wx.navigateTo({
      url: `${path}?date=${todayKey()}&mode=create&source=elder&from=elder`,
      fail: () => {
        this._openingRecord = false;
        wx.showToast({ title: '页面打开失败，请重试', icon: 'none' });
      }
    });
  },

  editableRecord(e) {
    if (this.data.loading || this.data.error || this.data.deletingRecordId || this._openingRecord) return null;
    if (!this._visible || !this.data.babyUid || this.data.babyUid !== getCurrentBabyUid()) return null;
    return this.data.records.find(record => record.id === e.currentTarget.dataset.id && record.canManage);
  },

  editRecord(e) {
    const record = this.editableRecord(e);
    if (!record) return;
    const url = getElderRecordEditUrl(record, this.data.today);
    if (!url) return;
    this._openingRecord = true;
    wx.navigateTo({ url, fail: () => {
      this._openingRecord = false;
      wx.showToast({ title: '编辑页面打开失败，请重试', icon: 'none' });
    } });
  },

  async deleteRecord(e) {
    const record = this.editableRecord(e);
    if (!record) return;
    const babyUid = this.data.babyUid;
    const date = this.data.today;
    this.setData({ deletingRecordId: record.id });
    try {
      const detail = record.type === 'food'
        ? `${record.content}（${record.items.length}项食物）`
        : `${record.label}：${record.content}`;
      const answer = await new Promise((resolve, reject) => wx.showModal({
        title: record.type === 'food' ? '删除这餐记录？' : '删除这条记录？',
        content: `${date} ${record.time}\n${detail}\n删除后家人的共享记录也会更新。`,
        confirmText: '确认删除', confirmColor: '#a33b2d', cancelText: '保留', success: resolve, fail: reject
      }));
      if (!answer.confirm || !this._visible || babyUid !== getCurrentBabyUid()) return;
      await deleteElderRecord(record, babyUid, date);
      if (!this._visible || babyUid !== getCurrentBabyUid()) return;
      this.setData({ saved: false, ...recordView(this.data.records.filter(item => item.id !== record.id), this.data.selectedRecordType) });
      wx.showToast({ title: '已删除', icon: 'success' });
      await this.loadRecords();
    } catch (error) {
      console.error('删除长辈模式记录失败:', error);
      if (this._visible) {
        wx.showToast({ title: error.message || '删除失败，请重试', icon: 'none' });
        await this.loadRecords();
      }
    } finally {
      if (!this._disposed) this.setData({ deletingRecordId: '' });
    }
  },

  exitMode() { if (!this.data.deletingRecordId) exitElderMode(); }
});
