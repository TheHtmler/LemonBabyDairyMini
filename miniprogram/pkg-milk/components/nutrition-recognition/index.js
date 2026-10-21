const { FIELDS, number, normalizeCategoryCatalog, normalizeCategoryName, matchCategory } = require('./lib/core/index.js');
const FoodCategoryModel = require('../../../models/foodCategory');
const { isBlank, FIELD_NAMES } = require('../../../utils/nutritionComparison');
const { createRequestId, callNutritionFunction, chooseRecognitionImages, uploadRecognitionImages, confirmWithRecovery, pendingConfirmation, recoverConfirmation } = require('../../../utils/nutritionRecognition');
const { invalidateSearchForBaby, currentContext } = require('../../../utils/searchSession');
const { createDialogState, formKey, targetBasis, clearProposals, editNutrition, buildRows, validateDialog, resultPatch, getEstimateEligibility, labelFillWarning } = require('./dialogState');
const { runWorkflow, providerName } = require('./workflow');
const { buildProgressView } = require('./progressView');
const { buildPreviewView } = require('./evidenceView');
function sameContext(context) { const current = currentContext(); return current.accountKey === context.accountKey && current.babyUid === context.babyUid; }

Component({
  properties: { babyUid: String, mode: { type: String, value: 'food_label' }, draft: Object, expectedVersion: Number,
    purpose: { type: String, value: 'form' }, recognitionKind: String, babyName: String, powderCategoryOptions: Array,
    navigationTop: { type: Number, value: 0 }, navigationHeight: { type: Number, value: 44 },
    sourceSystemFoodId: String, targetId: String, formSessionId: Number,
    showTrigger: { type: Boolean, value: true }, categoryOptions: Array, proteinOptions: Array },
  data: { dialogOpen: false, busy: false, phase: '', phaseDetail: '', error: '', values: {},
    nutrientRows: [], requiredNutrientRows: [], optionalNutrientRows: [], categoryItems: [], categoryIndex: 0, categoryLabel: '',
    unitItems: ['请选择单位', 'g', 'ml', '份'], unitIndex: 0, proteinItems: [], proteinIndex: 0,
    unmatchedCategory: false, newCategoryName: '', categoryCreateOpen: false,
    proteinSuggestionText: '', proteinSuggestionIndex: -1, proteinSuggestionSpecial: false,
    identityCandidates: [], referenceCandidates: [], needIdentity: false, needReference: false,
    recoveryPending: null, recoveryBusy: false, canUse: false, hasEstimate: false, previewOnly: false, displayMode: 'food_label', needType: false, canEstimate: false, saving: false, pendingSave: false,
    imagePaths: [], uploadedCount: 0, imageCount: 0, identityVisible: false, nutritionVisible: false,
    longWaiting: false, canRestoreDraft: false, duplicateReview: null, existingItem: null,
    identityDetails: {}, keyboardHeight: 0, scrollToField: '', optionalOpen: false, canRetryRecognition: false,
    previewNutritionHint: '', labelFillWarning: '', needBasis: false,
    previewPhoto: '', previewScanning: false, scanPhase: '', previewCalories: {}, previewProtein: {}, previewProteinType: '', previewMacros: [], previewExtras: [],
    previewBasisOptions: [], previewBasisMode: 'standard',
    needsProductPhoto: false, needsNutritionPhoto: false, packagePhotoNeeded: false, previewEmptyNutrition: true,
    packagePhotoTitle: '', packagePhotoHint: '', identityEditorOpen: false,
    previewPhotoStyle: '', scanFeedbackStyle: '', scanOrbitStyle: '',
    canRetryReference: false },
  lifetimes: {
    attached() { this.resetForm(); },
    detached() { this._epoch += 1; this._flowEpoch += 1; this._pending = null; this._previousDraft = null; clearTimeout(this._slowTimer); }
  },
  observers: {
    formSessionId() { this.resetForm(); },
    babyUid() { this.resetForm(); },
    dialogOpen(open) { this.triggerEvent('visibilitychange', { open: !!open }); }
  },
  methods: {
    resetForm() {
      this._epoch = (this._epoch || 0) + 1; this._flowEpoch = (this._flowEpoch || 0) + 1;
      this._pending = null; this._applied = null; this._parentTouched = {};
      this._previousDraft = null; clearTimeout(this._slowTimer);
      this.setData({ recoveryPending: this.properties.babyUid ? pendingConfirmation(this.properties.babyUid) : null, recoveryBusy: false, dialogOpen: false, busy: false, phase: '', phaseDetail: '', error: '',
        nutrientRows: [], requiredNutrientRows: [], optionalNutrientRows: [], values: {}, hasEstimate: false, canUse: false, saving: false, pendingSave: false, needType: false, previewOnly: false,
        longWaiting: false, canRestoreDraft: false, duplicateReview: null, existingItem: null,
        keyboardHeight: 0, optionalOpen: false, scrollToField: '', previewNutritionHint: '', labelFillWarning: '', needBasis: false, canRetryRecognition: false,
        previewPhoto: '', previewScanning: false, scanPhase: '', previewCalories: {}, previewProtein: {}, previewProteinType: '', previewMacros: [], previewExtras: [],
        previewBasisOptions: [], previewBasisMode: 'standard',
        needsProductPhoto: false, needsNutritionPhoto: false, packagePhotoNeeded: false, previewEmptyNutrition: true,
        packagePhotoTitle: '', packagePhotoHint: '', identityEditorOpen: false,
        previewPhotoStyle: '', scanFeedbackStyle: '', scanOrbitStyle: '', canRetryReference: false });
    },
    isCurrentState(state) { return !!state && sameContext({ accountKey: state.accountKey, babyUid: state.babyUid }); },
    hasPendingSave() {
      const pending = this.properties.babyUid ? pendingConfirmation(this.properties.babyUid) : null;
      this.setData({ recoveryPending: pending }); return !!pending;
    },
    async recoverFormSave() {
      const pending = pendingConfirmation(this.properties.babyUid); if (!pending || this.data.recoveryBusy) return;
      const epoch = this._epoch; const context = currentContext(); this.setData({ recoveryBusy: true });
      try {
        const result = await recoverConfirmation(pending);
        if (result.state === 'saved') invalidateSearchForBaby(pending.babyUid);
        if (!sameContext(context) || epoch !== this._epoch) return;
        if (result.state === 'saved') {
          this._applied = null; this.setData({ recoveryPending: null });
          this.triggerEvent('recovered', { ...result.savedResult, babyUid: pending.babyUid });
          wx.showToast({ title: '上次资料已保存', icon: 'success' });
        } else if (['failed', 'not_submitted'].includes(result.state)) {
          this.setData({ recoveryPending: null });
          if (this._applied && this._applied.operationId === pending.operationId && result.state === 'failed') this._applied.operationId = createRequestId();
          wx.showToast({ title: '上次未保存，可继续核对', icon: 'none' });
        } else wx.showToast({ title: result.state === 'processing' ? '仍在保存，请稍后恢复' : '结果暂未确定，请稍后恢复', icon: 'none' });
      } catch (error) { if (epoch === this._epoch && sameContext(context)) wx.showToast({ title: error.message || '恢复失败，请重试', icon: 'none' }); }
      finally { if (epoch === this._epoch && sameContext(context)) this.setData({ recoveryBusy: false }); }
    },
    hasSession() { return !!(this._applied && this._applied.result); },
    isBusy() { return this.data.busy || this.data.dialogOpen; },
    emitPatch(patch, manualFields = []) { this.triggerEvent('patch', { patch, manualFields }); },
    async startRecognition(options = {}) {
      if (this.data.busy || this.data.pendingSave || !this.properties.babyUid) return;
      if (this.hasPendingSave()) { wx.showToast({ title: '请先恢复上次保存状态', icon: 'none' }); return; }
      const epoch = this._epoch; const context = currentContext(); const flow = this._flowEpoch = (this._flowEpoch || 0) + 1;
      this.setData({ busy: true, error: '' });
      try {
        const paths = options.paths || await chooseRecognitionImages(options);
        if (!sameContext(context) || epoch !== this._epoch || flow !== this._flowEpoch) return;
        const state = createDialogState({ ...this.properties, ...(options.mode ? { mode: options.mode } : {}),
          ...(options.recognitionKind ? { recognitionKind: options.recognitionKind } : {}) }, paths);
        state.previewFrame = options.previewFrame || null;
        state.coverImageIndex = Number.isInteger(options.coverImageIndex) && options.coverImageIndex >= 0 && options.coverImageIndex < paths.length ? options.coverImageIndex : -1;
        if (this._parentTouched.unit || this._parentTouched.baseQuantity) state.initialBasisEdited = true;
        state.accountKey = currentContext().accountKey;
        state.operationId = createRequestId();
        if (!this._previousDraft && this._pending && this._pending.result && !this._pending.needType && !this._pending.saving && !this._pending.pendingSave) this._previousDraft = this._pending;
        this._pending = state;
        this.setData({ dialogOpen: true, phase: '准备识别', phaseDetail: '', optionalOpen: false, scrollToField: '' });
        this.renderDialog();
        await this.runPending();
        if (this._pending === state && state.result && state.status !== 'failed' && !state.needType) this._previousDraft = null;
      } catch (error) {
        if (epoch === this._epoch && sameContext(context) && flow === this._flowEpoch && !/cancel/i.test(error.errMsg || '')) {
          this.setData({ error: error.message || '图片处理失败，请重试' });
          wx.showToast({ title: error.message || '图片处理失败', icon: 'none' });
        }
      } finally {
        if (epoch === this._epoch && sameContext(context) && flow === this._flowEpoch) { this.setData({ busy: false }); this.renderDialog(); }
      }
    },
    async retryRecognition() {
      const state = this._pending; if (!state || this.data.busy) return;
      if (!state.retryRecognitionRequired) return this.runPending();
      wx.showModal({ title: '重新识别', content: '上次识别结果暂不可确认。继续会重新提交图片，并占用一次识别次数。', confirmText: '重新识别', success: result => {
        if (result.confirm && this._pending === state && !this.data.busy) this.startRecognition({
          paths: state.paths, previewFrame: state.previewFrame, coverImageIndex: state.coverImageIndex, mode: state.requestedMode, recognitionKind: state.recognitionKind });
      } });
    },
    async runPending() {
      const state = this._pending;
      if (!state) return;
      const epoch = this._epoch; const context = currentContext(); const flow = this._flowEpoch = (this._flowEpoch || 0) + 1;
      const active = () => epoch === this._epoch && sameContext(context) && flow === this._flowEpoch && this._pending === state && currentContext().accountKey === state.accountKey && currentContext().babyUid === state.babyUid;
      clearTimeout(this._slowTimer);
      this._slowTimer = setTimeout(() => { if (active()) this.setData({ longWaiting: true }); }, 8000);
      this.setData({ busy: true, error: '', canUse: false, longWaiting: false });
      try {
        await runWorkflow(state, { call: callNutritionFunction, upload: uploadRecognitionImages, isActive: active,
          onUpdate: (phase, phaseDetail) => { if (active()) { this.setData({ phase, phaseDetail }); this.renderDialog(); } } });
      } finally {
        if (active()) {
          clearTimeout(this._slowTimer);
          // 首次结果到达后，后续估算和重试留在浮窗内更新。
          if (state.result) state.previewShown = true;
          this.setData({ busy: false, longWaiting: false }); this.renderDialog();
        }
      }
    },
    renderDialog() {
      const state = this._pending;
      if (!state) return;
      const rows = buildRows(state);
      const sourceCategories = state.purpose === 'preview' && state.mode === 'powder_label' ? this.properties.powderCategoryOptions || [] : this.properties.categoryOptions || [];
      state.categoryCatalog = normalizeCategoryCatalog(sourceCategories.concat(state.extraCategories));
      const categoryItems = [{ value: '', label: '请选择分类' }].concat(state.categoryCatalog);
      const categoryIndex = Math.max(0, categoryItems.findIndex(item => item.value === state.values.category));
      const category = categoryItems.find(item => item.value === state.values.category);
      const unitItems = ['请选择单位', 'g', 'ml', '份'];
      const proteinItems = [{ index: -1, label: '请选择蛋白来源' }].concat((this.properties.proteinOptions || []).map((item, index) => ({ index, label: item.label })));
      const missing = validateDialog(state, { proteinOptions: this.properties.proteinOptions || [] });
      const recommendations = state.categorySuggestion && state.categorySuggestion.candidates || [];
      const progress = buildProgressView(state, this.data.busy, rows);
      const previewOnly = state.purpose === 'preview' && !state.saveFormOpen;
      const eligibility = state.result && state.identity ? getEstimateEligibility(state) : null;
      const labelWarning = labelFillWarning(state, rows);
      const canEstimate = !!eligibility && eligibility.eligible &&
        state.comparisonVersion > 0 && !state.estimate && !state.saving && !state.pendingSave &&
        !state.needType && !state.needIdentity && !labelWarning && state.status !== 'reference';
      this.setData({ ...progress, ...buildPreviewView(state, rows, { busy: this.data.busy, labelWarning }),
        previewOnly, retryRecognitionRequired: !!state.retryRecognitionRequired, displayMode: state.mode, needType: !!state.needType, saving: !!state.saving, pendingSave: !!state.pendingSave,
        identityDetails: { ...(state.identity || {}) }, canRetryRecognition: state.status === 'failed',
        canRestoreDraft: !!this._previousDraft && (state.status === 'failed' || state.needType), duplicateReview: state.duplicateReview || null, existingItem: state.existingItem || null,
        canEstimate, labelFillWarning: labelWarning, needBasis: state.status === 'basis',
        estimateButtonText: 'AI 估算',
        values: { ...state.values }, categoryItems, categoryIndex,
        categoryLabel: category ? category.label : state.values.category, unitItems, proteinItems,
        unmatchedCategory: !!state.categorySuggestion && !!state.categorySuggestion.name && !recommendations.length && !state.categoryRejected,
        categoryCreateOpen: !!state.categoryCreateOpen,
        newCategoryName: state.newCategoryName == null ? state.categorySuggestion && state.categorySuggestion.name || '' : state.newCategoryName,
        proteinSuggestionText: state.proteinSuggestion ? state.proteinSuggestion.label : '',
        proteinSuggestionIndex: state.proteinSuggestion ? state.proteinSuggestion.index : -1,
        proteinSuggestionSpecial: !!state.proteinSuggestion && state.proteinSuggestion.special,
        proteinIndex: Math.max(0, proteinItems.findIndex(item => item.index === state.values.proteinTypeIndex)),
        unitIndex: Math.max(0, unitItems.indexOf(state.values.unit)),
        identityCandidates: state.identityCandidates,
        referenceCandidates: state.referenceCandidates.map(item => ({ referenceId: item.referenceId,
          identity: { name: item.identity.name }, source: { provider: providerName(item.source.provider) } })),
        needIdentity: state.needIdentity, needReference: state.status === 'reference',
        canUse: !this.data.busy && !state.pendingSave && !state.existingItem && !state.duplicateReview && (previewOnly ? !!state.result && !state.needType && !state.needIdentity && state.status !== 'failed' : missing.length === 0),
        error: state.error || '', hasEstimate: rows.some(row => row.source === 'model_estimate') });
    },
    cancelDialog() {
      if (this._pending && (this._pending.saving || this._pending.pendingSave)) { wx.showToast({ title: '请先恢复本次保存状态', icon: 'none' }); return; }
      const state = this._pending;
      if (state && state.dirty) {
        wx.showModal({ title: '放弃本次修改？', content: '已手动核对的内容尚未保存。', confirmText: '放弃修改', cancelText: '继续编辑', success: result => {
          if (result.confirm && this._pending === state && !state.saving && !state.pendingSave) this.discardPending();
        } }); return;
      }
      this.discardPending();
    },
    discardPending() {
      this._flowEpoch += 1; this._pending = null;
      this._previousDraft = null; clearTimeout(this._slowTimer);
      // 未使用结果前，外层表单和已采用会话均保持原状。
      this.setData({ dialogOpen: false, busy: false, error: '', phase: '', phaseDetail: '', longWaiting: false, keyboardHeight: 0 });
    },
    restorePreviousDraft() {
      const state = this._previousDraft;
      if (!state || this.data.busy || !this.isCurrentState(state)) return;
      this._flowEpoch++; this._pending = state; this._previousDraft = null;
      this.setData({ busy: false, error: '', canRestoreDraft: false }); this.renderDialog();
    },
    retryReference() {
      const state = this._pending; if (!state || this.data.busy || state.pendingSave) return;
      clearProposals(state); return this.runPending();
    },
    stopPropagation() {},
    onPreviewBasisChange(event) {
      const state = this._pending; const mode = event.currentTarget.dataset.mode;
      if (!state || !this.data.previewOnly || this.data.busy || !this.data.previewBasisOptions.some(item => item.value === mode)) return;
      // 切换只影响预览；保存基准与原始标签依据均不变。
      state.previewBasisMode = mode; this.renderDialog();
    },
    onKeyboardHeight(event) { this.setData({ keyboardHeight: this.data.dialogOpen ? Math.max(0, Number(event.detail.height) || 0) : 0 }); },
    toggleOptional() { this.setData({ optionalOpen: !this.data.optionalOpen }); },
    openProductDetails() {
      if (!this._pending || this.data.busy) return;
      this.setData({ optionalOpen: true, scrollToField: '' }, () => this.setData({ scrollToField: 'recognition-field-details' }));
    },
    focusMissing(missing) {
      const label = missing[0];
      const field = FIELDS.find(key => FIELD_NAMES[key] === label || FIELD_NAMES[key] + '格式' === label) ||
        ({ 名称: 'name', 分类: 'category', 选择或创建本地分类: 'category', 计量基准: 'baseQuantity', 蛋白来源: 'protein', 粉量: 'ratioPowder', 水量: 'ratioWater' })[label] || 'name';
      // 折叠项有格式错误时先展开，再定位到对应输入框。
      this.setData({ scrollToField: '', optionalOpen: this.data.optionalOpen || ['fiber', 'sodium'].includes(field) },
        () => this.setData({ scrollToField: 'recognition-field-' + field }));
    },
    onDialogInput(e) {
      const state = this._pending;
      if (!state || this.data.busy) return;
      const field = e.currentTarget.dataset.field;
      state.dirty = true; state.existingItem = null; state.duplicateReview = null; state.duplicateDecision = null;
      if (FIELDS.includes(field)) editNutrition(state, field, e.detail.value);
      else {
        state.values[field] = e.detail.value;
        if (['ratioPowder', 'ratioWater'].includes(field)) state.ratioSource = 'manual';
        if (field === 'name') { clearProposals(state); state.needIdentity = true; state.packageIdentityConfirmed = false; }
        if (field === 'baseQuantity') { clearProposals(state); state.initialBasisEdited = true; }
      }
      this.renderDialog();
    },
    async onDialogBlur(e) {
      const field = e.currentTarget.dataset.field;
      const state = this._pending;
      if (!state || this.data.busy || !state.result) return;
      if (field === 'name' && String(state.values.name || '').trim()) {
        state.identity = { ...state.identity, name: state.values.name.trim() }; state.needIdentity = false; state.packageIdentityConfirmed = true;
        await this.runPending();
      } else if (field === 'baseQuantity' && number(state.values.baseQuantity) > 0) await this.runPending();
    },
    onCategoryChange(e) {
      const state = this._pending; const item = this.data.categoryItems[Number(e.detail.value)];
      if (!state || !item || this.data.busy) return;
      state.dirty = true;
      state.values.category = item.value; state.categoryManual = true; state.categoryRejected = !!item.value; this.renderDialog();
    },
    async onProteinChange(e) {
      if (!this._pending || this.data.busy) return;
      const item = this.data.proteinItems[Number(e.detail.value)];
      if (!item) return;
      const state = this._pending; const previous = state.proteinOptions[state.values.proteinTypeIndex];
      state.dirty = true;
      const next = state.proteinOptions[item.index];
      state.values.proteinTypeIndex = item.index; state.proteinManual = true;
      if (previous && previous.value === 'special' || next && next.value === 'special') clearProposals(state);
      this.renderDialog();
      if (this._pending.result) await this.runPending();
    },
    async onUseProteinSuggestion() {
      const state = this._pending;
      if (!state || this.data.busy || !state.proteinSuggestion) return;
      state.dirty = true;
      const previous = state.proteinOptions[state.values.proteinTypeIndex];
      const next = state.proteinOptions[state.proteinSuggestion.index];
      state.values.proteinTypeIndex = state.proteinSuggestion.index; state.proteinManual = true;
      if (previous && previous.value === 'special' || next && next.value === 'special') clearProposals(state);
      this.renderDialog();
      if (state.result) await this.runPending();
    },
    onNewCategoryInput(e) {
      if (!this._pending || this.data.busy) return;
      this._pending.newCategoryName = e.detail.value; this.renderDialog();
    },
    toggleCategoryCreate() {
      if (!this._pending || this.data.busy) return;
      this._pending.categoryCreateOpen = !this._pending.categoryCreateOpen; this.renderDialog();
    },
    async onCreateCategory() {
      const state = this._pending;
      if (state && state.purpose === 'preview') return;
      if (!state || this.data.busy || state.mode === 'powder_label') return;
      const name = normalizeCategoryName(String(this.data.newCategoryName || '').trim());
      if (!name || name.length > 60) { state.error = '分类名称需为1至60个字符'; this.renderDialog(); return; }
      const existing = matchCategory(name, state.categoryCatalog);
      if (existing) {
        state.dirty = true;
        state.values.category = existing.value; state.categoryManual = true; state.categoryRejected = true;
        state.error = ''; this.renderDialog(); return;
      }
      const epoch = this._epoch; const context = currentContext(); const flow = this._flowEpoch;
      const previousStage = state.stage; state.stage = 'category';
      const active = () => this._pending === state && epoch === this._epoch && sameContext(context) && flow === this._flowEpoch;
      this.setData({ busy: true, phase: '创建分类', phaseDetail: '仅在当前宝宝的分类目录中创建', canUse: false });
      this.renderDialog();
      try {
        const created = await FoodCategoryModel.addCategory(name, { babyUid: state.babyUid,
          createdBy: getApp().globalData.openid || wx.getStorageSync('openid') || '' });
        // 分类已独立写入，同宝宝即同步目录；当前弹窗的选中项仍需通过异步有效性检查。
        if (this.properties.babyUid === state.babyUid) this.triggerEvent('categorycreated', { name: created.name, babyUid: state.babyUid });
        if (!active()) return;
        state.extraCategories.push(created.name); state.values.category = created.name;
        state.dirty = true;
        state.categoryManual = true; state.categoryRejected = true; state.error = '';
        state.categoryCreateOpen = false;
        this.setData({ phase: '分类已创建', phaseDetail: '已选用，可继续核对后使用结果' });
      } catch (error) {
        if (active()) { state.error = error.message || '分类创建失败，请重试'; this.setData({ phase: '分类创建失败', phaseDetail: '' }); }
      } finally { if (active()) { state.stage = previousStage; this.setData({ busy: false }); this.renderDialog(); } }
    },
    async onUnitChange(e) {
      const state = this._pending;
      if (!state || this.data.busy) return;
      state.dirty = true;
      const index = Number(e.detail.value);
      state.values.unit = index > 0 ? this.data.unitItems[index] : ''; state.initialBasisEdited = true;
      clearProposals(state); this.renderDialog();
      if (state.result) await this.runPending();
    },
    async onCandidate(e) {
      const state = this._pending;
      if (!state || this.data.busy) return;
      const candidate = state.identityCandidates[Number(e.currentTarget.dataset.index)];
      if (!candidate) return;
      state.dirty = true;
      clearProposals(state); state.identity = { ...candidate }; state.values.name = candidate.name; state.needIdentity = false;
      state.packageIdentityConfirmed = true;
      await this.runPending();
    },
    async onContinueIdentity() {
      const state = this._pending;
      if (!state || this.data.busy || !String(state.values.name || '').trim()) return;
      state.dirty = true;
      state.identity = { ...state.identity, name: state.values.name.trim() }; state.needIdentity = false; state.packageIdentityConfirmed = true;
      await this.runPending();
    },
    async onReference(e) {
      const state = this._pending;
      if (!state || this.data.busy) return;
      const candidate = state.referenceCandidates[Number(e.currentTarget.dataset.index)];
      if (!candidate) return;
      state.dirty = true;
      clearProposals(state); state.identity = { ...candidate.identity }; state.values.name = candidate.identity.name;
      state.needIdentity = false; state.packageIdentityConfirmed = true; state.selectedReferenceId = candidate.referenceId;
      await this.runPending();
    },
    async onSkipReference() {
      if (!this._pending || this.data.busy) return;
      this._pending.dirty = true;
      this._pending.ignoreReference = true; await this.runPending();
    },
    async onSkipEstimate() {
      const state = this._pending;
      if (!state || this.data.busy) return;
      state.ignoreEstimate = true; state.needIdentity = false; state.autoEstimateAttempted = true;
      state.dirty = true;
      state.identity = { ...state.identity, name: state.values.name.trim() };
      await this.runPending();
    },
    async useResults() {
      const state = this._pending;
      if (!state || this.data.busy) return;
      if (state.purpose === 'preview') {
        if (!state.saveFormOpen) return this.beginPreviewSave();
        return this.savePreview();
      }
      const missing = validateDialog(state, { proteinOptions: this.properties.proteinOptions || [] });
      if (missing.length) { state.error = '请补充：' + missing.join('、'); this.renderDialog(); this.focusMissing(missing); return; }
      if (state.initialFormKey !== formKey(this.properties.draft || {}, state.mode)) {
        state.error = '原表单已变化，请取消后重新识别'; this.renderDialog(); return;
      }
      this._applied = state; this._pending = null; this._flowEpoch += 1;
      this.emitPatch(resultPatch(state), [...state.editedFields].filter(field => FIELDS.includes(field) && state.decisions[field] && state.decisions[field].source === 'manual'));
      this.setData({ dialogOpen: false, busy: false, error: '', phase: '', phaseDetail: '' });
    },
    markManual(field, value) {
      this._parentTouched = { ...(this._parentTouched || {}), [field]: true };
      const state = this._applied;
      if (!state) return;
      if (FIELDS.includes(field)) {
        state.values[field] = value;
        if (isBlank(value)) delete state.decisions[field];
        else state.decisions[field] = { path: field, source: 'manual' };
      }
      if (['ratioPowder', 'ratioWater'].includes(field)) state.ratioSource = 'manual';
      if (['name', 'unit', 'baseQuantity'].includes(field)) {
        const nutrition = state.mode === 'powder_label' ? (this.properties.draft || {}).nutritionPer100g || {} : this.properties.draft || {};
        const patch = {};
        FIELDS.forEach(path => {
          const decision = state.decisions[path];
          if (decision && decision.source === 'model_estimate') { delete state.decisions[path]; patch[path] = ''; }
          else if (decision && decision.source !== 'manual') state.decisions[path] = { path, source: 'manual', value: nutrition[path] };
        });
        state.comparisonVersion = 0; state.reference = null; state.estimate = null;
        if (Object.keys(patch).length) this.emitPatch(patch);
      }
    },
    async confirm(saveContext) {
      const state = this._applied;
      if (!state) return null;
      if (!this.isCurrentState(state)) throw new Error('账号或宝宝已切换，请重新打开表单');
      if (this.isBusy()) throw new Error('请先完成或关闭识别弹窗');
      const epoch = this._epoch; const context = currentContext();
      const draft = this.properties.draft || {};
      const values = state.mode === 'powder_label' ? draft.nutritionPer100g || {} : draft;
      const basis = state.mode === 'powder_label' ? { quantity: 100, unit: 'g', material: 'dry_powder' } :
        { quantity: number(draft.baseQuantity), unit: draft.unit === '份' ? 'portion' : draft.unit, material: 'food' };
      this.setData({ busy: true });
      try {
        if (!state.comparisonVersion) {
          const result = await callNutritionFunction('lookupNutritionReference', { action: 'search',
            sessionId: state.result.sessionId, babyUid: state.babyUid, identity: { ...state.identity, name: draft.name }, targetBasis: basis });
          if (!sameContext(context) || epoch !== this._epoch || this._applied !== state) throw new Error('当前表单已关闭，请重新核对');
          state.comparisonVersion = result.comparisonVersion;
        }
        const decisions = FIELDS.filter(path => state.decisions[path] && !(path === 'sodium' && state.mode === 'powder_label')).map(path =>
          state.decisions[path].source === 'manual' ? { path, source: 'manual', value: values[path] } : { path, source: state.decisions[path].source });
        return await confirmWithRecovery({ ...saveContext,
          ...(state.mode !== 'powder_label' ? { targetId: state.prepared.targetFoodId } : {}),
          babyUid: state.babyUid, sessionId: state.result.sessionId, operationId: state.operationId,
          comparisonVersion: state.comparisonVersion,
          expectedVersion: state.mode === 'powder_label' ? this.properties.expectedVersion : state.prepared.targetFoodVersion,
          targetBasis: basis, decisions, mixRatioDecision: { source: state.ratioSource } });
      } catch (error) {
        if (epoch === this._epoch && sameContext(context)) { this.setData({ recoveryPending: pendingConfirmation(state.babyUid) }); if (!pendingConfirmation(state.babyUid)) state.operationId = createRequestId(); }
        throw error;
      } finally { if (epoch === this._epoch && sameContext(context)) this.setData({ busy: false }); }
    },
    async onRequestEstimate() {
      if (!this._pending || this.data.busy || !this.data.canEstimate) return;
      this._pending.dirty = true;
      this._pending.allowEstimate = true; this._pending.ignoreEstimate = false; await this.runPending();
    },
    openIdentityEditor() {
      const state = this._pending;
      if (!state || this.data.busy || state.pendingSave) return;
      state.identityEditorOpen = true; this.renderDialog();
    },
    async beginPreviewSave() {
      const state = this._pending; if (!state || this.data.busy || state.needType) return;
      state.saveFormOpen = true; await this.runPending();
      if (this._pending !== state || !state.comparisonVersion) return;
      await this.bindPreviewState(state);
    },
    async bindPreviewState(state) {
      this.setData({ busy: true });
      try {
        const result = await callNutritionFunction('recognizeNutritionLabel', { action: 'bindTarget', babyUid: state.babyUid, sessionId: state.result.sessionId,
          requestId: createRequestId(), targetType: state.mode === 'powder_label' ? 'powder' : 'food', comparisonVersion: state.comparisonVersion,
          duplicateReviewToken: state.duplicateDecision || undefined });
        if (this._pending !== state || !this.isCurrentState(state)) return false;
        if (result.existing) { state.existingItem = result.existing; state.duplicateReview = null; state.error = '资料库已有相同身份的物品，请查看已有资料。'; this.triggerEvent('existing', { ...result.existing, babyUid: state.babyUid }); return false; }
        if (result.duplicateReview) { state.binding = null; state.duplicateReview = result.duplicateReview; state.duplicateDecision = null; state.error = ''; return false; }
        state.duplicateReview = null; state.existingItem = null; state.error = '';
        state.binding = result.binding; state.expectedVersion = result.expectedVersion; return true;
      } catch (error) { if (this._pending === state && this.isCurrentState(state)) state.error = error.message; return false; }
      finally { if (this._pending === state && this.isCurrentState(state)) { this.setData({ busy: false }); this.renderDialog(); } }
    },
    async confirmDifferentIdentity() {
      const state = this._pending;
      if (!state || this.data.busy || !state.duplicateReview || !state.duplicateReview.canConfirm) return;
      const review = state.duplicateReview;
      const answer = await new Promise(resolve => wx.showModal({ title: '确认是不同物品', content: '请核对已有资料的名称、品牌、系列或段数。只有确认不是同一物品才新增，已有资料不会被覆盖。', confirmText: '确认不同', cancelText: '继续核对', success: resolve, fail: () => resolve({ confirm: false }) }));
      if (!answer.confirm || this._pending !== state || state.duplicateReview !== review || !this.isCurrentState(state)) return;
      state.duplicateDecision = review.token;
      await this.bindPreviewState(state);
    },
    openDuplicate(event) {
      const state = this._pending; if (!state || !this.isCurrentState(state) || this.data.busy) return;
      const index = Number(event.currentTarget.dataset.index);
      const item = state.existingItem || (state.duplicateReview && state.duplicateReview.candidates || [])[index];
      if (!item) return;
      wx.navigateTo({ url: (item.targetType === 'powder' ? '/pkg-milk/powder-management/index' : '/pkg-milk/food-management/index') + '?searchId=' + encodeURIComponent(item.itemId) + '&searchScope=mine&searchBabyUid=' + encodeURIComponent(state.babyUid) });
    },
    onIdentityDetailInput(event) {
      const state = this._pending; const key = event.currentTarget.dataset.key;
      if (!state || this.data.busy || !['brand', 'series', 'stage', 'barcode'].includes(key)) return;
      state.identity = { ...state.identity, [key]: event.detail.value }; state.dirty = true;
      clearProposals(state); state.existingItem = null; this.renderDialog();
    },
    onIdentityDetailBlur() { if (this._pending && !this.data.busy && this._pending.result) return this.runPending(); },
    async savePreview() {
      const state = this._pending; if (!state || this.data.busy || state.pendingSave) return;
      const missing = validateDialog(state, { proteinOptions: this.properties.proteinOptions || [] });
      if (missing.length) { state.error = '请补充：' + missing.join('、'); this.renderDialog(); this.focusMissing(missing); return; }
      if (!await this.bindPreviewState(state) || this._pending !== state) return;
      const protein = state.proteinOptions[state.values.proteinTypeIndex] || {};
      const form = { name: state.values.name, category: state.values.category, categoryLevel2: state.values.categoryLevel2 || '',
        proteinSource: protein.value || '', proteinQuality: protein.quality || '',
        mixRatio: { powder: state.values.ratioPowder, water: state.values.ratioWater } };
      const decisions = FIELDS.filter(path => state.decisions[path] && !(path === 'sodium' && state.mode === 'powder_label')).map(path => state.decisions[path].source === 'manual' ? { path, source: 'manual', value: state.values[path] } : { path, source: state.decisions[path].source });
      state.saving = true; this.setData({ busy: true, phase: '正在保存', phaseDetail: '保存到当前宝宝的资料库' }); this.renderDialog();
      try {
        if (state.mode !== 'powder_label' && state.coverImageIndex >= 0) {
          if (!state.coverFileID) {
            // 展示图另存到食物图片目录，不能引用会随识别草稿过期清理的临时文件。
            const path = state.paths[state.coverImageIndex];
            const extension = (path.match(/\.(jpg|jpeg|png|webp)$/i) || [null, 'jpg'])[1];
            const uploaded = await wx.cloud.uploadFile({ cloudPath: 'food_images/recognition_' + state.result.sessionId + '.' + extension,
              filePath: path, config: { env: state.prepared.envId } });
            if (!uploaded.fileID) throw new Error('食物图片保存失败，请重试');
            state.coverFileID = uploaded.fileID;
          }
          form.image = state.coverFileID;
        }
        if (this._pending !== state || !this.isCurrentState(state)) return;
        const result = await confirmWithRecovery({ babyUid: state.babyUid, sessionId: state.result.sessionId, operationId: state.operationId, comparisonVersion: state.comparisonVersion,
          expectedVersion: state.expectedVersion, targetBasis: targetBasis(state), decisions, form, mixRatioDecision: { source: state.ratioSource } });
        const saved = { ...result, name: state.values.name, accountKey: state.accountKey, babyUid: state.babyUid, mode: state.mode };
        invalidateSearchForBaby(state.babyUid, saved);
        if (this._pending === state && this.isCurrentState(state)) { this._pending = null; this._previousDraft = null; this.setData({ dialogOpen: false, busy: false, saving: false }); this.triggerEvent('saved', saved); }
      } catch (error) {
        if (this._pending === state && this.isCurrentState(state)) {
          state.error = error.message; state.pendingSave = !!pendingConfirmation(state.babyUid);
          if (!state.pendingSave) { state.operationId = createRequestId(); if (['VERSION_CONFLICT', 'COMPARISON_STALE'].includes(error.code)) state.binding = null; }
        }
      } finally { state.saving = false; if (this._pending === state && this.isCurrentState(state)) { this.setData({ busy: false }); this.renderDialog(); } }
    },
    async recoverPreviewSave() {
      const state = this._pending; if (!state || this.data.busy) return;
      const epoch = this._epoch; const context = currentContext();
      const pending = pendingConfirmation(state.babyUid); if (!pending) return;
      this.setData({ busy: true });
      try {
        const result = await recoverConfirmation(pending);
        if (this._pending !== state || !this.isCurrentState(state)) return;
        if (result.state === 'saved') { const saved = { ...result.savedResult, name: state.values.name, accountKey: state.accountKey, babyUid: state.babyUid, mode: state.mode }; invalidateSearchForBaby(state.babyUid, saved); this._pending = null; this.setData({ dialogOpen: false, pendingSave: false }); this.triggerEvent('saved', saved); }
        else if (['failed', 'not_submitted'].includes(result.state)) { state.pendingSave = false; state.error = '本次尚未保存，可核对后重新提交'; if (result.state === 'failed') { state.operationId = createRequestId(); state.binding = null; } }
        else state.error = result.state === 'processing' ? '仍在保存，请稍后再查看' : '暂不能确认保存结果，请稍后恢复状态，避免重复添加';
      } catch (error) { if (this._pending === state && this.isCurrentState(state)) state.error = error.message; }
      finally { if (epoch === this._epoch && sameContext(context)) this.setData({ busy: false }); if (this._pending === state && this.isCurrentState(state)) this.renderDialog(); }
    }
  }
});
