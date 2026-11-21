const FoodModel = require('../../models/food');
const NutritionProfile = require('../../models/nutritionProfile');
const { getBabyUid, waitForAppInitialization } = require('../../utils/index');
const { loadAminoAcidRecords } = require('../../utils/aminoAcidRecords');
const { lookupReferences } = require('./referenceLookup');
const { normalizeFormulaPowders, POWDER_STATUSES } = require('../../utils/formulaPowderUtils');
const { buildVirtualBreastMilkPowder, VIRTUAL_BREAST_MILK_ID } = require('../utils/breastMilkProfileItem');
const {
  AMINO_ACIDS, applyAminoReference, canSupplementIntake, collectIntakes, fromFoodCatalog, fromPowderCatalog, getAminoProfileForField,
  getManualAminoAcidError, getSystemAminoReference, selectProfile
} = require('../../utils/aminoAcidIntake');

const LATEST_PROFILE_AT = Number.MAX_SAFE_INTEGER;
const DECIMAL_FORMAT = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
const POWDER_BASES = ['每 100 g 奶粉', '每 100 mL 冲调奶'];
const FOOD_PREPARATION_LABELS = { raw: '生重', cooked: '熟重' };
const LIQUID_PREPARATION_LABELS = { raw: '生', cooked: '熟制' };

function latestProfile(entry, archive) {
  return selectProfile({ ...entry, at: LATEST_PROFILE_AT }, archive);
}

function fieldValue(value) {
  return value == null ? '' : String(value);
}

Page({
  data: {
    loading: true,
    loadError: '',
    error: '',
    saving: false,
    name: '',
    readOnly: false,
    supplementDate: '',
    intakeLabel: '',
    identityLabel: '',
    canSearch: false,
    isPowder: false,
    basisLabel: '',
    foodPreparationLabel: '',
    powderBases: POWDER_BASES,
    powderBasisIndex: 0,
    gramsPer100ml: '',
    sourceName: '',
    sourceRecordId: '',
    sourceUrl: '',
    fields: AMINO_ACIDS,
    values: {},
    referenceFields: {},
    referenceOpen: false,
    referenceQuery: '',
    referenceBusy: false,
    applicableReferences: [],
    reviewReferences: [],
    showReviewReferences: false,
    referenceTotal: 0,
    referenceError: '',
    referenceSearched: false,
    selectedReference: null
  },

  onLoad({ babyUid = '', foodId = '', powderId = '', date = '', recordId = '', componentIndex = '' } = {}) {
    this._route = {
      babyUid: decodeURIComponent(babyUid),
      foodId: decodeURIComponent(foodId),
      powderId: decodeURIComponent(powderId),
      date: decodeURIComponent(date),
      recordId: decodeURIComponent(recordId),
      componentIndex: /^\d+$/.test(componentIndex) ? Number(componentIndex) : undefined
    };
    this.load();
  },

  onShow() {
    if (this._babyUid !== undefined) this.isCurrentBaby();
  },

  onPageScroll({ scrollTop }) {
    this._scrollTop = scrollTop;
  },

  onUnload() {
    this._unloaded = true;
  },

  isCurrentBaby(babyUid = this._babyUid) {
    if (this._unloaded || this._babyUid !== babyUid) return false;
    if ((getBabyUid() || '') === babyUid) return true;
    this._referenceRequest = null;
    this.setData({ loading: false, loadError: '宝宝已切换，请返回后重新打开。', referenceOpen: false });
    return false;
  },

  async load() {
    const request = {};
    this._loadRequest = request;
    const isCurrent = () => !this._unloaded && this._loadRequest === request;
    this.setData({ loading: true, loadError: '', error: '' });
    try {
      await waitForAppInitialization();
      if (!isCurrent()) return;
      const babyUid = getBabyUid() || '';
      const { babyUid: routeBabyUid, foodId, powderId, date, recordId, componentIndex } = this._route;
      if ((routeBabyUid && routeBabyUid !== babyUid) || ((powderId || recordId) && !babyUid)) {
        throw new Error('请返回后重新选择宝宝。');
      }
      this._babyUid = babyUid;

      let entry;
      if (recordId) {
        const records = await loadAminoAcidRecords(babyUid, date);
        entry = collectIntakes(records).find(item => item.recordId === recordId && item.componentIndex === componentIndex);
        if (!canSupplementIntake(entry)) throw new Error('这条记录已变更或缺少食物、份量信息，请返回查看。');
      } else if (foodId) {
        const foods = await FoodModel.getAvailableFoods(babyUid, { preferLocalSystemIndex: true });
        const food = foods.find(item => item._id === foodId && item.status !== 'archived');
        if (!food) throw new Error('找不到这项食物。');
        entry = fromFoodCatalog(food);
      } else if (powderId) {
        const settings = await NutritionProfile.getNutritionProfileSettings(babyUid, {
          includeLegacyFallback: true, throwOnError: true
        });
        const powder = powderId === VIRTUAL_BREAST_MILK_ID ? buildVirtualBreastMilkPowder()
          : normalizeFormulaPowders(settings?.formulaPowders || []).find(item =>
            item.status === POWDER_STATUSES.ACTIVE && [item.id, item._id].includes(powderId));
        if (!powder) throw new Error('找不到这项奶粉。');
        entry = fromPowderCatalog(powder);
      }
      if (!isCurrent() || !this.isCurrentBaby(babyUid)) return;
      if (!entry?.key) throw new Error('找不到可填写的氨基酸资料。');

      this._entry = entry;
      this._supplementDate = recordId ? date : '';
      this._reference = getSystemAminoReference(entry);
      const archive = babyUid ? await NutritionProfile.getAminoAcidArchive(babyUid) : [];
      if (!isCurrent() || !this.isCurrentBaby(babyUid)) return;
      this._archive = archive;
      const dayProfile = this._supplementDate ? selectProfile(entry, archive, this._supplementDate) : null;
      this.showEntry(dayProfile || latestProfile(entry, archive));
    } catch (error) {
      if (isCurrent()) this.setData({ loading: false, loadError: error.message || '读取失败，请重试。' });
    }
  },

  showEntry(saved) {
    const entry = this._entry;
    const isPowder = entry.kind === 'powder';
    const basis = isPowder ? (saved?.basis || 'g') : entry.unit === 'ml' ? 'ml' : 'g';
    const current = saved?.basis === basis ? saved : null;
    const reference = this._reference?.profile;
    const values = {};
    const referenceFields = {};
    this._estimatedValues = {};
    this._estimateSource = current?.estimateSource || (current?.estimated ? current.source : reference?.source);
    this._savedPreparation = current?.confirmedFoodPreparation || '';
    // 只在个人食物档案中确认长期使用的口径，旧摄入记录沿用其原始资料。
    this._allowPreparationConfirmation = !!entry.searchTarget && !entry.isSystemFood && !this._supplementDate;
    for (const { key } of AMINO_ACIDS) {
      const profile = getAminoProfileForField(current, reference, key);
      const value = profile?.values[key];
      values[key] = fieldValue(value);
      if (value != null && profile.estimated === true) {
        this._estimatedValues[key] = value;
        referenceFields[key] = true;
      }
    }
    this._powderDrafts = {};
    const hasReference = Object.keys(referenceFields).length > 0;
    const preparation = this._savedPreparation || entry.searchTarget?.preparation;
    const preparationLabels = basis === 'ml' ? LIQUID_PREPARATION_LABELS : FOOD_PREPARATION_LABELS;
    this.setData({
      loading: false,
      error: '',
      name: entry.name,
      readOnly: !this._babyUid || (entry.isSystemFood && !this._supplementDate),
      supplementDate: this._supplementDate,
      intakeLabel: this._supplementDate ? `${entry.quantity} ${entry.unit === 'ml' ? 'mL' : entry.unit}` : '',
      identityLabel: isPowder || entry.sourceType === 'recipe' ? entry.identityLabel || '' : '',
      canSearch: basis === 'g' && !!this._babyUid && !!entry.searchTarget && (!entry.isSystemFood || !!this._supplementDate),
      isPowder,
      basisLabel: basis === 'ml' ? '每 100 mL' : '每 100 g',
      foodPreparationLabel: preparationLabels[preparation] || '',
      powderBasisIndex: basis === 'ml' ? 1 : 0,
      gramsPer100ml: fieldValue(current?.powderGramsPer100ml),
      sourceName: hasReference ? this._estimateSource?.name || '' : '',
      sourceRecordId: hasReference ? this._estimateSource?.recordId || '' : '',
      sourceUrl: hasReference ? this._estimateSource?.url || '' : '',
      values,
      referenceFields
    });
  },

  onAmountInput(event) {
    const { key } = event.currentTarget.dataset;
    const { value } = event.detail;
    delete this._estimatedValues[key];
    this.setData({
      [`values.${key}`]: value,
      [`referenceFields.${key}`]: false,
      error: ''
    });
  },

  onPowderBasisChange(event) {
    const powderBasisIndex = Number(event.currentTarget.dataset.index);
    if (powderBasisIndex === this.data.powderBasisIndex) return;
    const { values, gramsPer100ml } = this.data;
    this._powderDrafts[this.data.powderBasisIndex] = { values: { ...values }, gramsPer100ml };
    const draft = this._powderDrafts[powderBasisIndex];
    this.setData({
      powderBasisIndex,
      gramsPer100ml: draft?.gramsPer100ml || '',
      values: draft?.values || Object.fromEntries(AMINO_ACIDS.map(({ key }) => [key, ''])),
      error: ''
    });
  },

  onGramsInput(event) {
    this.setData({ gramsPer100ml: event.detail.value, error: '' });
  },

  setViewAtScroll(updates, scrollTop = 0) {
    this.setData(updates, () => {
      if (!this._unloaded) wx.pageScrollTo({ scrollTop, duration: 0 });
    });
  },

  openReferenceSearch() {
    if (!this.data.canSearch || this.data.saving || !this.isCurrentBaby()) return;
    this._formScrollTop = this._scrollTop || 0;
    this.setViewAtScroll({ referenceOpen: true, referenceQuery: this.data.name.slice(0, 80) });
    this.searchReferences();
  },

  closeReferenceSearch() {
    if (this.data.saving) return;
    this._referenceRequest = null;
    this.setViewAtScroll({ referenceOpen: false, referenceBusy: false, selectedReference: null }, this._formScrollTop);
  },

  toggleReviewReferences() {
    this.setData({ showReviewReferences: !this.data.showReviewReferences });
  },

  copySource(event) {
    const { url } = event.currentTarget.dataset;
    if (/^https?:\/\//i.test(url || '')) wx.setClipboardData({ data: url });
  },

  onReferenceQueryInput(event) {
    this._referenceRequest = null;
    this.setData({
      referenceQuery: event.detail.value,
      applicableReferences: [],
      reviewReferences: [],
      showReviewReferences: false,
      referenceTotal: 0,
      referenceSearched: false,
      referenceBusy: false,
      referenceError: '',
      selectedReference: null
    });
  },

  async searchReferences(event) {
    if (!this.data.referenceOpen || this.data.referenceBusy || !this.isCurrentBaby()) return;
    if (event) wx.hideKeyboard();
    const babyUid = this._babyUid;
    const query = this.data.referenceQuery.trim();
    const request = {};
    this._referenceRequest = request;
    this.setData({
      referenceBusy: !!query,
      applicableReferences: [],
      reviewReferences: [],
      showReviewReferences: false,
      referenceTotal: 0,
      referenceError: '',
      referenceSearched: !!query,
      selectedReference: null
    });
    if (!query) return;
    const isCurrent = () => this._referenceRequest === request && this.isCurrentBaby(babyUid);
    try {
      const target = { ...this._entry.searchTarget };
      if (this._reference) target.verifiedId = this._reference.profile.source.recordId;
      if (!['raw', 'cooked'].includes(target.preparation) && this._savedPreparation) {
        target.preparation = this._savedPreparation;
      }
      target.allowPreparationConfirmation = this._allowPreparationConfirmation;
      const result = await lookupReferences({ query, target });
      if (!isCurrent()) return;
      if (!Array.isArray(result?.matches)) throw new Error('搜索结果格式异常');
      this.setData({
        applicableReferences: result.matches.filter(item => item.canApply || item.preparationToConfirm),
        reviewReferences: result.matches.filter(item => !item.canApply && !item.preparationToConfirm),
        referenceTotal: result.total || result.matches.length
      });
    } catch (error) {
      if (isCurrent()) this.setData({ referenceError: '参考资料暂时无法读取。请重新搜索，或返回手填。' });
    } finally {
      if (isCurrent()) this.setData({ referenceBusy: false });
    }
  },

  previewReference(event) {
    const { id } = event.currentTarget.dataset;
    const match = this.data.applicableReferences.find(item => item.id === id)
      || this.data.reviewReferences.find(item => item.id === id);
    if (!match || !this.data.referenceOpen) return;
    this._resultsScrollTop = this._scrollTop || 0;
    this.setViewAtScroll({ selectedReference: match, referenceError: '' });
  },

  backToReferenceResults() {
    if (!this.data.saving) this.setViewAtScroll({ selectedReference: null, referenceError: '' }, this._resultsScrollTop);
  },

  async confirmReference() {
    const { selectedReference, values, saving } = this.data;
    if (!selectedReference || !this.data.referenceOpen || !this.data.canSearch || saving || !this.isCurrentBaby()) return;
    try {
      const basis = this._entry.unit === 'ml' ? 'ml' : 'g';
      const profile = applyAminoReference(selectedReference, values, this._estimatedValues, {
        basis,
        allowPreparationConfirmation: this._allowPreparationConfirmation,
        savedPreparation: this._savedPreparation
      });
      if (!profile) {
        this.setData({ referenceError: '这条参考有数值的项目都已手填。' });
        return;
      }
      await this.saveProfile(profile, { fromReference: true });
    } catch (error) {
      this.setData({ referenceError: error.message || '无法应用这条参考。' });
    }
  },

  async saveAmounts() {
    const entry = this._entry;
    if (!entry || this.data.readOnly || !this._babyUid || !this.isCurrentBaby() || this.data.saving) return;
    const { values, isPowder, powderBasisIndex, gramsPer100ml } = this.data;
    const liquid = isPowder ? powderBasisIndex === 1 : entry.unit === 'ml';
    const conversion = isPowder && liquid ? gramsPer100ml.trim() : '';
    const error = getManualAminoAcidError(values);
    if (error) {
      this.setData({ error });
      return;
    }
    if (conversion && (!DECIMAL_FORMAT.test(conversion) || !Number.isFinite(Number(conversion)) || Number(conversion) <= 0)) {
      this.setData({ error: '每 100 mL 冲调奶所用的奶粉克数需大于 0。' });
      return;
    }
    const profile = {
      basis: liquid ? 'ml' : 'g',
      values,
      powderGramsPer100ml: conversion,
      confirmedFoodPreparation: this._savedPreparation,
      source: { name: '手动填写' },
      ...(this._estimateSource ? {
        estimateSource: this._estimateSource,
        estimatedKeys: AMINO_ACIDS.filter(({ key }) =>
          values[key].trim() && Number(values[key]) === this._estimatedValues[key]
        ).map(({ key }) => key)
      } : {})
    };
    await this.saveProfile(profile);
  },

  async saveProfile(profile, { fromReference = false } = {}) {
    const entry = this._entry;
    const babyUid = this._babyUid;
    this.setData({ saving: true, error: '' });
    try {
      const archive = await NutritionProfile.saveAminoAcidProfiles(babyUid, [{ key: entry.key, profile }], {
        date: this._supplementDate,
        expectedArchive: this._archive,
        applyReference: fromReference
      });
      if (!this.isCurrentBaby(babyUid)) return;
      this._archive = archive;
      if (this._supplementDate) {
        wx.showToast({ title: '已保存并补算当天', icon: 'success' });
        wx.navigateBack({
          fail: () => {
            if (this.isCurrentBaby(babyUid)) this.setData({
              [fromReference ? 'referenceError' : 'error']: '已保存，请返回当天汇总查看。'
            });
          }
        });
        return;
      }
      this.showEntry(latestProfile(entry, archive));
      if (fromReference) this.setViewAtScroll({
        referenceOpen: false, selectedReference: null, referenceError: ''
      }, this._formScrollTop);
      wx.showToast({ title: fromReference ? '已应用参考值' : '已保存', icon: 'success' });
    } catch (error) {
      if (this.isCurrentBaby(babyUid)) this.setData({ [fromReference ? 'referenceError' : 'error']: error.message || '保存失败，请重试。' });
    } finally {
      if (!this._unloaded && this._babyUid === babyUid) this.setData({ saving: false });
    }
  }
});
