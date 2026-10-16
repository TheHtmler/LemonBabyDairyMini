const MedicationModel = require('../../models/medication');
const MedicationRecordModel = require('../../models/medicationRecord');
const { getBabyUid } = require('../../utils/index');
const { isElderMode, finishElderRecord } = require('../../utils/elderMode');
const { buildMedicationChecklist, buildMedicationHistoryFromRecords, buildPeriodicMedicationIds } = require('../../utils/homeDashboard');

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function buildRecordDateTime(dateKey, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return formatDate(date) === dateKey && formatTime(date) === time ? date : null;
}

function recordedTime(record) {
  if (/^\d{2}:\d{2}$/.test(record.actualTime || '')) return record.actualTime;
  const value = record.actualDateTime && new Date(record.actualDateTime);
  return value && !Number.isNaN(value.getTime()) ? formatTime(value) : '';
}

function recordFingerprint(record) {
  return JSON.stringify([record.babyUid, record.medicationId, record.medicationName,
    record.date, record.actualTime, record.actualDateTime, record.dosage, record.unit,
    record.notes || '', record.status || '', record.updatedAt || '']);
}

function doseFingerprint(record) {
  // 新写入的本地记录与数据库日期格式不同，先归一再比较实际内容。
  return JSON.stringify([MedicationRecordModel.getDateKey(record.date), record.medicationId,
    record.medicationName, recordedTime(record), Number(record.dosage), record.unit || '', record.notes || '']);
}

function checklistView(snapshot, dateKey, previousCards = []) {
  const recordsByMedication = new Map();
  snapshot.records.forEach(record => {
    const key = record.medicationId || record.medicationName;
    if (!recordsByMedication.has(key)) recordsByMedication.set(key, []);
    recordsByMedication.get(key).push(record);
  });
  const checklist = buildMedicationChecklist({
    meds: snapshot.medications,
    todayRecords: snapshot.records,
    history: snapshot.history,
    todayKey: dateKey
  });
  return {
    checklistDateKey: dateKey,
    medications: snapshot.medications,
    medicationCards: checklist.todayItems.map(item => {
      const records = (recordsByMedication.get(item.medicationId) || []).slice().sort((first, second) => (
        recordedTime(first).localeCompare(recordedTime(second)) || String(first._id || '').localeCompare(String(second._id || ''))
      ));
      const totals = new Map();
      records.forEach(record => {
        const dosage = Number(record.dosage);
        if (!Number.isFinite(dosage) || dosage < 0) return;
        const unit = String(record.unit || '').trim();
        totals.set(unit, (totals.get(unit) || 0) + dosage);
      });
      const previous = previousCards.find(card => card.medicationId === item.medicationId);
      const slots = [];
      const assigned = new Set();
      const recordsById = new Map(records.filter(record => record._id).map(record => [record._id, record]));
      // 取消哪一格就清空哪一格，其他已打卡的勾和时间保持原位。
      (previous ? previous.doseChecks : []).forEach(dose => {
        const record = recordsById.get(dose.recordId);
        if (record) { slots[dose.index] = record; assigned.add(record); }
      });
      records.forEach(record => {
        if (assigned.has(record)) return;
        let index = 0;
        while (slots[index]) index += 1;
        slots[index] = record;
      });
      const doseChecks = Array.from({ length: Math.max(item.doseTotal, slots.length) }, (_, index) => {
        const record = slots[index];
        return { index, sequence: index + 1, checked: !!record,
          recordId: record ? record._id || '' : '', time: record ? recordedTime(record) : '',
          fingerprint: record ? doseFingerprint(record) : '' };
      });
      return {
        ...item,
        // 每个勾绑定真实记录，取消任意一次不会误删同药的其他打卡。
        doseChecks,
        nextDoseIndex: item.completed ? -1 : doseChecks.findIndex(dose => !dose.checked),
        totalIntake: Array.from(totals, ([unit, total]) => `${Number(total.toFixed(3))}${unit}`).join(' + '),
        ready: Number.isFinite(Number(item.dosage)) && Number(item.dosage) > 0 && !!String(item.unit || '').trim(),
        frequencyText: item.frequencyText || `每 ${item.periodDays} 天 ${item.doseTotal} 次`
      };
    })
  };
}

Page({
  data: {
    elderMode: true,
    loading: true,
    loadError: '',
    medications: [],
    medicationCards: [],
    editingRecordId: '',
    recordForm: null,
    recordLoading: false,
    recordError: '',
    recordBusy: false,
    recordSaved: false,
    showDetails: false,
    dateKey: '',
    maxDate: '',
    time: '',
    manualTime: false,
    saving: false,
    savingMedicationId: '',
    savingDoseIndex: -1,
    editingMedicationId: '',
    customDosage: ''
  },

  onLoad(options = {}) {
    const now = new Date();
    this._babyUid = getBabyUid();
    this.setData({
      editingRecordId: options.recordId || '',
      elderMode: options.from === 'elder' || options.source === 'elder' || isElderMode(),
      dateKey: formatDate(now), maxDate: formatDate(now), time: formatTime(now)
    });
  },

  onShow() {
    this._visible = true;
    if (this.data.editingRecordId) {
      if (this.data.recordSaved) this.returnFromRecord();
      else if (this._babyUid !== getBabyUid()) this.setData({ recordError: '宝宝已切换，请返回列表重新进入' });
      else if (!this.data.recordForm) this.loadStoredRecord();
      return;
    }
    if (this.data.saving) {
      this._refreshAfterSave = true;
      return;
    }
    this._refreshAfterSave = false;
    const today = formatDate(new Date());
    const dateKey = this.data.dateKey === this.data.maxDate ? today : this.data.dateKey;
    const dateChanged = dateKey !== this.data.dateKey;
    const manualTime = !dateChanged && this.data.manualTime;
    this.setData({
      dateKey, maxDate: today, manualTime,
      ...(!manualTime ? { time: formatTime(new Date()) } : {})
    });
    this.loadMedications();
  },

  onHide() {
    this._visible = false;
    this._loadVersion = (this._loadVersion || 0) + 1;
  },

  onUnload() {
    this._disposed = true;
    this.onHide();
  },

  contextMatches(dateKey) {
    return this._visible && !this._disposed && !!this._babyUid
      && this._babyUid === getBabyUid() && this.data.dateKey === dateKey;
  },

  buildChecklistView(snapshot, dateKey) {
    return checklistView(snapshot, dateKey,
      this.data.checklistDateKey === dateKey ? this.data.medicationCards : []);
  },

  async readSnapshot(dateKey) {
    const date = buildRecordDateTime(dateKey, '00:00');
    if (!date) throw new Error('日期无效');
    const medications = (await MedicationModel.getMedications() || [])
      .filter(item => item && (item._id || item.id) && item.name && item.status !== 'deleted' && item.status !== 'archived');
    const [result, historyRecords] = await Promise.all([
      MedicationRecordModel.getRecordsByDate(date, this._babyUid, { allRecords: true }),
      MedicationRecordModel.getLatestRecordsBeforeDateForMedications(this._babyUid, buildPeriodicMedicationIds(medications), date)
    ]);
    return {
      medications,
      records: (result.data || []).filter(record => record && !record.deletedAt
        && record.status !== 'deleted' && record.status !== 'archived'),
      history: buildMedicationHistoryFromRecords(historyRecords, dateKey)
    };
  },

  async loadMedications() {
    if (this.data.saving) return;
    const dateKey = this.data.dateKey;
    const version = this._loadVersion = (this._loadVersion || 0) + 1;
    if (!this._babyUid || this._babyUid !== getBabyUid()) {
      this.setData({ loading: false, loadError: '宝宝信息已变化，请返回首页重新进入。' });
      return;
    }
    this.setData({ loading: true, loadError: '', editingMedicationId: '' });
    try {
      const snapshot = await this.readSnapshot(dateKey);
      if (version !== this._loadVersion || !this.contextMatches(dateKey)) return;
      this.setData(this.buildChecklistView(snapshot, dateKey));
    } catch (error) {
      console.error('加载用药打卡失败:', error);
      if (version === this._loadVersion && this.contextMatches(dateKey)) {
        this.setData({ loadError: '用药记录加载失败，请重试后再打卡。' });
      }
    } finally {
      if (version === this._loadVersion && !this._disposed) this.setData({ loading: false });
    }
  },

  onDateChange(e) {
    if (this.data.saving) return;
    const dateKey = e.detail.value;
    if (!buildRecordDateTime(dateKey, '00:00') || dateKey > formatDate(new Date())) return;
    this.setData({ dateKey, time: formatTime(new Date()), manualTime: false });
    this.loadMedications();
  },

  onTimeChange(e) {
    if (this.data.saving || !buildRecordDateTime(this.data.dateKey, e.detail.value)) return;
    this.setData({ time: e.detail.value, manualTime: true });
  },

  toggleDetails() {
    if (this.data.saving) return;
    this.setData({ showDetails: !this.data.showDetails, editingMedicationId: '' });
  },

  editDosage(e) {
    if (this.data.saving || this.data.loading || this.data.loadError) return;
    const medicationId = e.currentTarget.dataset.id;
    const item = this.data.medicationCards.find(card => card.medicationId === medicationId);
    if (!item || !item.ready || item.completed || !item.scheduledToday) return;
    this.setData({ editingMedicationId: medicationId, customDosage: String(item.dosage) });
  },

  onDosageInput(e) {
    if (!this.data.saving) this.setData({ customDosage: e.detail.value });
  },

  cancelDosageEdit() {
    if (!this.data.saving) this.setData({ editingMedicationId: '' });
  },

  checkInMedication(e) {
    if (this.data.saving || this.data.loading || this.data.loadError) return;
    const { id, doseIndex } = e.currentTarget.dataset;
    const item = this.data.medicationCards.find(card => card.medicationId === id);
    if (!item || this.data.editingMedicationId === id) return;
    const dose = item.doseChecks[Number(doseIndex)];
    if (!dose) return;
    if (dose.checked) return this.cancelCheckIn(id, dose);
    if (Number(doseIndex) !== item.nextDoseIndex) return;
    return this.submitRecord(id);
  },

  async cancelCheckIn(medicationId, dose) {
    if (this.data.saving || this.data.loading || this.data.loadError || !dose.recordId) return;
    const dateKey = this.data.dateKey;
    if (!this.contextMatches(dateKey)) return;
    this.setData({ saving: true, savingMedicationId: medicationId, savingDoseIndex: dose.index });
    try {
      const snapshot = await this.readSnapshot(dateKey);
      if (!this.contextMatches(dateKey)) return;
      const current = snapshot.records.find(record => record._id === dose.recordId);
      this.setData(this.buildChecklistView(snapshot, dateKey));
      if (!current || current.babyUid !== this._babyUid || current.medicationId !== medicationId
        || doseFingerprint(current) !== dose.fingerprint) {
        wx.showToast({ title: '记录已更新，请核对后操作', icon: 'none' });
        return;
      }
      const result = await MedicationRecordModel.deleteRecord(dose.recordId);
      if (result && result.stats && result.stats.removed === 0) throw new Error('记录已变化，请刷新后重试');
      this._hasSavedRecords = true;
      if (!this.contextMatches(dateKey)) return;
      snapshot.records = snapshot.records.filter(record => record._id !== dose.recordId);
      this.setData(this.buildChecklistView(snapshot, dateKey));
      wx.showToast({ title: '已取消打卡', icon: 'success' });
    } catch (error) {
      console.error('取消用药打卡失败:', error);
      if (this.contextMatches(dateKey)) wx.showToast({ title: '取消失败，请刷新后重试', icon: 'none' });
    } finally {
      if (!this._disposed) {
        this.setData({ saving: false, savingMedicationId: '', savingDoseIndex: -1 });
        if (this._visible && (this._refreshAfterSave || this._babyUid !== getBabyUid())) this.onShow();
      }
    }
  },

  saveAdjustedRecord() {
    return this.submitRecord(this.data.editingMedicationId, this.data.customDosage);
  },

  async submitRecord(medicationId, customDosage) {
    if (this.data.saving || this.data.loading || this.data.loadError) return;
    const dateKey = this.data.dateKey;
    if (!this.contextMatches(dateKey)) {
      wx.showToast({ title: '宝宝信息已变化，请重新进入', icon: 'none' });
      return;
    }
    const today = formatDate(new Date());
    if (dateKey === this.data.maxDate && today !== this.data.maxDate) {
      this.onShow();
      wx.showToast({ title: '已跨天，请核对新的日期', icon: 'none' });
      return;
    }
    const previous = this.data.medicationCards.find(item => item.medicationId === medicationId);
    if (!previous || !previous.ready || previous.completed || !previous.scheduledToday) return;
    const dosage = Number(customDosage === undefined ? previous.dosage : customDosage);
    if (!Number.isFinite(dosage) || dosage <= 0) {
      wx.showToast({ title: '请输入大于零的实际用量', icon: 'none' });
      return;
    }

    this.setData({ saving: true, savingMedicationId: medicationId, savingDoseIndex: previous.nextDoseIndex });
    try {
      // 写入前重读共享记录和用药配置，家人刚打过卡或调整过计划时先刷新页面。
      const snapshot = await this.readSnapshot(dateKey);
      if (!this.contextMatches(dateKey)) return;
      const view = this.buildChecklistView(snapshot, dateKey);
      this.setData(view);
      const current = view.medicationCards.find(item => item.medicationId === medicationId);
      if (!current || !current.ready || current.completed || !current.scheduledToday
        || current.doseCount !== previous.doseCount || current.doseTotal !== previous.doseTotal
        || current.periodDays !== previous.periodDays || Number(current.dosage) !== Number(previous.dosage)
        || current.unit !== previous.unit || current.name !== previous.name) {
        this.setData({ editingMedicationId: '' });
        wx.showToast({ title: '用药信息已更新，请核对', icon: 'none' });
        return;
      }
      const now = new Date();
      if (dateKey === this.data.maxDate && formatDate(now) !== this.data.maxDate) {
        this._refreshAfterSave = true;
        wx.showToast({ title: '已跨天，请核对新的日期', icon: 'none' });
        return;
      }
      const time = this.data.time;
      const actualDateTime = buildRecordDateTime(dateKey, time);
      if (!actualDateTime) throw new Error('日期或时间无效');
      const payload = {
        medicationId, medicationName: current.name, dosage, unit: current.unit,
        frequency: current.frequencyText, date: dateKey, actualTime: time, actualDateTime
      };
      const result = await MedicationRecordModel.addRecord(payload);
      this._hasSavedRecords = true;
      if (!this.contextMatches(dateKey)) return;
      snapshot.records.push({ ...payload, _id: result._id, babyUid: this._babyUid });
      this.setData({
        ...this.buildChecklistView(snapshot, dateKey), time, editingMedicationId: '', customDosage: ''
      });
      wx.showToast({ title: '已打卡', icon: 'success' });
    } catch (error) {
      console.error('保存用药打卡失败:', error);
      if (!this._disposed) wx.showToast({ title: '打卡失败，请重试', icon: 'none' });
    } finally {
      if (!this._disposed) {
        this.setData({ saving: false, savingMedicationId: '', savingDoseIndex: -1 });
        if (this._visible && (this._refreshAfterSave || this._babyUid !== getBabyUid())) this.onShow();
      }
    }
  },

  finishRecording() {
    if (this.data.saving) return;
    if (this._hasSavedRecords && this.data.elderMode) {
      finishElderRecord();
    } else {
      wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/elder-home/index' }) });
    }
  },

  async loadStoredRecord() {
    if (this.data.recordBusy || this.data.recordSaved) return;
    const version = this._loadVersion = (this._loadVersion || 0) + 1;
    this.setData({ recordLoading: true, recordError: '' });
    try {
      const record = await MedicationRecordModel.getById(this.data.editingRecordId);
      if (version !== this._loadVersion || !this._visible) return;
      if (!record || record.babyUid !== this._babyUid || this._babyUid !== getBabyUid()
        || ['deleted', 'archived'].includes(record.status) || record.deletedAt) throw new Error('记录无法读取，请返回列表刷新后重试');
      this._loadedRecord = record;
      this.setData({ recordForm: {
        name: record.medicationName || '药物', unit: record.unit || '',
        date: MedicationRecordModel.getDateKey(record.date), time: recordedTime(record),
        dosage: record.dosage === undefined || record.dosage === null ? '' : String(record.dosage),
        notes: record.notes || ''
      } });
    } catch (error) {
      if (version === this._loadVersion && this._visible) this.setData({ recordError: error.message || '记录加载失败，请重试' });
    } finally {
      if (!this._disposed && version === this._loadVersion) this.setData({ recordLoading: false });
    }
  },

  onRecordFieldChange(e) {
    if (this.data.recordBusy || this.data.recordSaved) return;
    const field = e.currentTarget.dataset.field;
    if (!['date', 'time', 'dosage', 'notes'].includes(field)) return;
    this.setData({ [`recordForm.${field}`]: e.detail.value });
  },

  saveStoredRecord() {
    const form = this.data.recordForm;
    if (!form) return;
    const actualDateTime = buildRecordDateTime(form.date, form.time);
    const dosage = Number(form.dosage);
    if (!actualDateTime || form.date > formatDate(new Date())) {
      wx.showToast({ title: '请选择有效的日期和时间', icon: 'none' });
      return;
    }
    if (!Number.isFinite(dosage) || dosage <= 0) {
      wx.showToast({ title: '请输入大于零的实际用量', icon: 'none' });
      return;
    }
    return this.persistStoredRecord({
      date: buildRecordDateTime(form.date, '00:00'), actualTime: form.time, actualDateTime,
      dosage, notes: String(form.notes || '').trim()
    });
  },

  async persistStoredRecord(payload) {
    if (this.data.recordBusy || this.data.recordSaved || this.data.recordLoading || this.data.recordError || !this._loadedRecord) return;
    const id = this.data.editingRecordId;
    this.setData({ recordBusy: true });
    try {
      if (!this._visible || this._babyUid !== getBabyUid()) return;
      const current = await MedicationRecordModel.getById(id);
      if (!this._visible || this._babyUid !== getBabyUid()) throw new Error('宝宝已切换，请返回重新进入');
      if (!current || current.babyUid !== this._babyUid || ['deleted', 'archived'].includes(current.status) || current.deletedAt
        || recordFingerprint(current) !== recordFingerprint(this._loadedRecord)) {
        this.setData({ recordError: '记录已被更新或删除，请重新加载后再操作' });
        return;
      }
      const result = await MedicationRecordModel.updateRecord(id, payload);
      if (result && result.stats && result.stats.updated === 0) throw new Error('记录未更新，请重新加载');
      // 写入成功后保持锁定；返回失败也不能重复提交。
      if (this._disposed) return;
      this.setData({ recordSaved: true });
      if (this._visible) {
        wx.showToast({ title: '已更新', icon: 'success' });
        this.returnFromRecord();
      }
    } catch (error) {
      console.error('修改用药打卡失败:', error);
      if (this._visible) wx.showToast({ title: error.message || '操作失败，请重试', icon: 'none' });
    } finally {
      if (!this._disposed) this.setData({ recordBusy: false });
    }
  },

  returnFromRecord() {
    if (this.data.recordBusy && !this.data.recordSaved) return;
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/elder-home/index' }) });
  }
});
