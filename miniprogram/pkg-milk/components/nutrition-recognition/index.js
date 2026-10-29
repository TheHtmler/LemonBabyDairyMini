const { FIELDS, number, normalizeCategoryCatalog, normalizeCategoryName, matchCategory,
  makeIdentityConfirmation, isGenericIdentity, assertFoodRecognition } = require('./lib/core/index.js');
const FoodCategoryModel = require('../../../models/foodCategory');
const { isBlank, FIELD_NAMES } = require('../../../utils/nutritionComparison');
const { createRequestId, callNutritionFunction, chooseRecognitionImages, uploadRecognitionImages, uploadFoodImages, confirmWithRecovery, pendingConfirmation, recoverConfirmation } = require('../../../utils/nutritionRecognition');
const { invalidateSearchForBaby, currentContext } = require('../../../utils/searchSession');
const { createDialogState, formKey, targetBasis, clearProposals, editNutrition, buildRows, validateDialog, resultPatch,
  getEstimateEligibility, labelFillWarning, getIdentityRequirement, invalidateIdentityConfirmation } = require('./dialogState');
const { runWorkflow, providerName } = require('./workflow');
const { buildProgressView } = require('./progressView');
const { buildPreviewView, buildDuplicateComparison } = require('./evidenceView');
const { previewPreparationBinding, invalidatePreviewPreparation, isPreviewPreparationCurrent,
  startPreviewPreparation } = require('./preparation');
function sameContext(context) { const current = currentContext(); return current.accountKey === context.accountKey && current.babyUid === context.babyUid; }

Component({
  properties: { babyUid: String, mode: { type: String, value: 'food_label' }, draft: Object, expectedVersion: Number,
    purpose: { type: String, value: 'form' }, babyName: String,
    navigationTop: { type: Number, value: 0 }, navigationHeight: { type: Number, value: 44 },
    sourceSystemFoodId: String, targetId: String, formSessionId: Number,
    showTrigger: { type: Boolean, value: true }, categoryOptions: Array, proteinOptions: Array },
  data: { dialogOpen: false, busy: false, phase: '', phaseDetail: '', error: '', values: {},
    nutrientRows: [], requiredNutrientRows: [], optionalNutrientRows: [], categoryItems: [], categoryIndex: 0, categoryLabel: '',
    unitItems: ['请选择单位', 'g', 'ml', '份'], unitIndex: 0, proteinItems: [], proteinIndex: 0,
    unmatchedCategory: false, newCategoryName: '', categoryCreateOpen: false,
    proteinSuggestionText: '', proteinSuggestionIndex: -1, proteinSuggestionSpecial: false,
    identityCandidates: [], referenceCandidates: [], needIdentity: false, needReference: false,
    recoveryPending: null, recoveryBusy: false, canUse: false, previewOnly: false, displayMode: 'food_label', needType: false, canEstimate: false, saving: false, pendingSave: false,
    imagePaths: [], foodImagePaths: [], coverImagePath: '', uploadedCount: 0, imageCount: 0, identityVisible: false, nutritionVisible: false,
    longWaiting: false, canRestoreDraft: false, duplicateReview: null, duplicateReviewOpen: false, duplicateChecking: false, duplicateCheckFailed: false, existingItem: null, duplicateComparison: null,
    identityDetails: {}, keyboardHeight: 0, scrollToField: '', invalidField: '', fieldError: '', canRetryRecognition: false,
    previewNutritionHint: '', labelFillWarning: '', needBasis: false,
    previewPhoto: '', previewScanning: false, scanPhase: '', previewCalories: {}, previewProtein: {}, previewProteinType: '', previewMacros: [], previewExtras: [],
    previewBasisOptions: [], previewBasisMode: 'standard',
    identityEditorOpen: false,
    previewPhotoStyle: '', scanFeedbackStyle: '', scanOrbitStyle: '',
    canRetryReference: false, identityReview: false, identityDeferred: false, needIdentityPreparation: false,
    identityCoarseCategory: '', identityVisibleFeatures: [], identityPreparationIndex: 0, identityNote: '',
    identityPreparationItems: ['请选择制备状态', '生鲜 / 未烹调', '水煮', '炒制', '其他制备 / 成品'] },
  lifetimes: {
    attached() { this.resetForm(); },
    detached() { this.cancelPreviewPreparation(); this._epoch += 1; this._flowEpoch += 1; this._pending = null; this._previousDraft = null; clearTimeout(this._slowTimer); }
  },
  observers: {
    formSessionId() { this.resetForm(); },
    babyUid() { this.resetForm(); },
    dialogOpen(open) { this.triggerEvent('visibilitychange', { open: !!open }); }
  },
  methods: {
    resetForm() {
      this.cancelPreviewPreparation();
      this._epoch = (this._epoch || 0) + 1; this._flowEpoch = (this._flowEpoch || 0) + 1;
      this._pending = null; this._applied = null; this._parentTouched = {};
      this._previousDraft = null; clearTimeout(this._slowTimer);
      this.setData({ recoveryPending: this.properties.babyUid ? pendingConfirmation(this.properties.babyUid) : null, recoveryBusy: false, dialogOpen: false, busy: false, phase: '', phaseDetail: '', error: '',
        nutrientRows: [], requiredNutrientRows: [], optionalNutrientRows: [], values: {}, canUse: false, saving: false, pendingSave: false, needType: false, previewOnly: false,
        longWaiting: false, canRestoreDraft: false, duplicateReview: null, duplicateReviewOpen: false, duplicateChecking: false, duplicateCheckFailed: false, existingItem: null, duplicateComparison: null,
        keyboardHeight: 0, scrollToField: '', invalidField: '', fieldError: '', previewNutritionHint: '', labelFillWarning: '', needBasis: false, canRetryRecognition: false,
        coverImagePath: '', foodImagePaths: [], previewPhoto: '', previewScanning: false, scanPhase: '', previewCalories: {}, previewProtein: {}, previewProteinType: '', previewMacros: [], previewExtras: [],
        previewBasisOptions: [], previewBasisMode: 'standard',
        identityEditorOpen: false,
        previewPhotoStyle: '', scanFeedbackStyle: '', scanOrbitStyle: '', canRetryReference: false,
        identityReview: false, identityDeferred: false, needIdentityPreparation: false, identityCoarseCategory: '',
        identityVisibleFeatures: [], identityPreparationIndex: 0, identityNote: '' });
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
          if (this._applied && this._applied.operationId === pending.operationId) this._applied.operationId = createRequestId();
          wx.showToast({ title: '上次未保存，可继续核对', icon: 'none' });
        } else wx.showToast({ title: result.state === 'processing' ? '仍在保存，请稍后恢复' : '结果暂未确定，请稍后恢复', icon: 'none' });
      } catch (error) { if (epoch === this._epoch && sameContext(context)) wx.showToast({ title: error.message || '恢复失败，请重试', icon: 'none' }); }
      finally { if (epoch === this._epoch && sameContext(context)) this.setData({ recoveryBusy: false }); }
    },
    hasSession() { return !!(this._applied && this._applied.result); },
    isBusy() { return this.data.busy || this.data.dialogOpen; },
    emitPatch(patch, manualFields = []) { this.triggerEvent('patch', { patch, manualFields }); },
    preparePreview(options = {}) {
      try {
        if (!options.batchToken || this.isBusy() || this.data.pendingSave) return null;
        const binding = previewPreparationBinding(this.properties, currentContext(), options.imageCount);
        if (!binding) return null;
        const previous = this._previewPreparation;
        if (previous && previous.batchToken === options.batchToken && previous.binding.key === binding.key && isPreviewPreparationCurrent(previous)) return previous;
        invalidatePreviewPreparation(previous);
        const epoch = this._epoch;
        const isCurrent = () => {
          const current = previewPreparationBinding(this.properties, currentContext(), options.imageCount);
          return epoch === this._epoch && current && current.key === binding.key && options.isCurrent();
        };
        this._previewPreparation = startPreviewPreparation(binding, options.batchToken, isCurrent);
        return this._previewPreparation;
      } catch (_) { return null; }
    },
    cancelPreviewPreparation(batchToken) {
      const candidates = [this._previewPreparation, this._pending && this._pending.previewPreparation];
      candidates.forEach(candidate => {
        if (candidate && (!batchToken || candidate.batchToken === batchToken)) invalidatePreviewPreparation(candidate);
      });
      if (!batchToken || this._previewPreparation && this._previewPreparation.batchToken === batchToken) this._previewPreparation = null;
    },
    takePreviewPreparation(batchToken, state) {
      const candidate = this._previewPreparation;
      this._previewPreparation = null;
      const binding = previewPreparationBinding(this.properties, currentContext(), state.paths.length);
      if (candidate && batchToken && candidate.batchToken === batchToken && state.purpose === 'preview' && state.mode === 'auto' &&
          binding && candidate.binding.key === binding.key && isPreviewPreparationCurrent(candidate)) return candidate;
      invalidatePreviewPreparation(candidate);
      return null;
    },
    async startRecognition(options = {}) {
      if (this.data.busy || this.data.pendingSave || !this.properties.babyUid) {
        if (options.preparationBatch) this.cancelPreviewPreparation(options.preparationBatch);
        return;
      }
      if (this.hasPendingSave()) {
        if (options.preparationBatch) this.cancelPreviewPreparation(options.preparationBatch);
        wx.showToast({ title: '请先恢复上次保存状态', icon: 'none' }); return;
      }
      const epoch = this._epoch; const context = currentContext(); const flow = this._flowEpoch = (this._flowEpoch || 0) + 1;
      this.setData({ busy: true, error: '' });
      try {
        assertFoodRecognition({ mode: options.mode || this.properties.mode });
        const paths = options.paths || await chooseRecognitionImages(options);
        if (!sameContext(context) || epoch !== this._epoch || flow !== this._flowEpoch) return;
        const state = createDialogState({ ...this.properties, ...(options.mode ? { mode: options.mode } : {}) }, paths);
        state.previewFrame = options.previewFrame || null;
        state.coverImageIndex = Number.isInteger(options.coverImageIndex) && options.coverImageIndex >= 0 && options.coverImageIndex < paths.length ? options.coverImageIndex : -1;
        state.coverImagePath = paths[state.coverImageIndex] || paths[0] || '';
        state.foodImagePaths = [...new Set(paths)]; state.foodImageUploads = {};
        if (this._parentTouched.unit || this._parentTouched.baseQuantity) state.initialBasisEdited = true;
        state.accountKey = currentContext().accountKey;
        state.operationId = createRequestId();
        if (!this._previousDraft && this._pending && this._pending.result && !this._pending.needType && !this._pending.saving && !this._pending.pendingSave) this._previousDraft = this._pending;
        this._pending = state;
        this.setData({ dialogOpen: true, phase: '准备识别', phaseDetail: '', scrollToField: '' });
        this.renderDialog();
        state.previewPreparation = this.takePreviewPreparation(options.preparationBatch, state);
        await this.runPending();
        if (this._pending === state && state.result && state.status !== 'failed' && !state.needType) this._previousDraft = null;
      } catch (error) {
        if (options.preparationBatch) this.cancelPreviewPreparation(options.preparationBatch);
        if (epoch === this._epoch && sameContext(context) && flow === this._flowEpoch && !/cancel/i.test(error.errMsg || '')) {
          this.setData({ error: error.message || '图片处理失败，请重试' });
          wx.showToast({ title: error.message || '图片处理失败', icon: 'none' });
        }
      } finally {
        if (epoch === this._epoch && sameContext(context) && flow === this._flowEpoch) { this.setData({ busy: false }); this.renderDialog(); }
      }
    },
    async retryRecognition() {
      const state = this._pending; if (!state || this.data.busy || state.pendingSave) return;
      if (!state.retryRecognitionRequired) return this.runPending();
      wx.showModal({ title: '重新识别', content: '上次识别结果暂不可确认。继续会重新提交图片，并占用一次识别次数。', confirmText: '重新识别', success: result => {
        if (result.confirm && this._pending === state && !this.data.busy) this.startRecognition({
          paths: state.paths, previewFrame: state.previewFrame, coverImageIndex: state.coverImageIndex, mode: state.requestedMode });
      } });
    },
    async runPending() {
      const state = this._pending;
      if (!state || state.pendingSave) return;
      const epoch = this._epoch; const context = currentContext(); const flow = this._flowEpoch = (this._flowEpoch || 0) + 1;
      const active = () => epoch === this._epoch && sameContext(context) && flow === this._flowEpoch && this._pending === state && currentContext().accountKey === state.accountKey && currentContext().babyUid === state.babyUid;
      clearTimeout(this._slowTimer);
      this._slowTimer = setTimeout(() => { if (active()) this.setData({ longWaiting: true }); }, 8000);
      this.setData({ busy: true, error: '', canUse: false, longWaiting: false });
      try {
        await runWorkflow(state, { call: callNutritionFunction, upload: uploadRecognitionImages, isActive: active,
          onUpdate: (phase, phaseDetail) => { if (active()) { this.setData({ phase, phaseDetail }); this.renderDialog(); this.checkDuplicatePreview(state); } } });
      } finally {
        if (active()) {
          clearTimeout(this._slowTimer);
          // 首次结果到达后，后续估算和重试留在浮窗内更新。
          if (state.result) state.previewShown = true;
          this.setData({ busy: !!state.saving, longWaiting: false });
          this.renderDialog();
        }
      }
    },
    renderDialog(onRendered) {
      const state = this._pending;
      if (!state) return;
      if (!state.duplicateReview) state.duplicateReviewOpen = false;
      const rows = buildRows(state);
      const duplicateItems = state.existingItem ? [state.existingItem] : state.duplicateReview && state.duplicateReview.candidates || [];
      const comparedItem = duplicateItems.find(item => item.itemId === state.duplicateComparisonId);
      if (!comparedItem) state.duplicateComparisonId = '';
      const duplicateComparison = comparedItem ? buildDuplicateComparison(state, comparedItem, rows) : null;
      const sourceCategories = this.properties.categoryOptions || [];
      state.categoryCatalog = normalizeCategoryCatalog(sourceCategories.concat(state.extraCategories));
      const categoryItems = [{ value: '', label: '请选择分类' }].concat(state.categoryCatalog);
      const categoryIndex = Math.max(0, categoryItems.findIndex(item => item.value === state.values.category));
      const category = categoryItems.find(item => item.value === state.values.category);
      const unitItems = ['请选择单位', 'g', 'ml', '份'];
      const proteinItems = [{ index: -1, label: '请选择蛋白来源' }].concat((this.properties.proteinOptions || []).map((item, index) => ({ index, label: item.label })));
      const missing = validateDialog(state, { proteinOptions: this.properties.proteinOptions || [] });
      const invalidField = missing.includes(state.validationLabel) ? state.validationField || '' : '';
      const scrollTarget = invalidField && state.scrollToMissing && !state.saving ? invalidField : '';
      if (!invalidField || scrollTarget) state.scrollToMissing = false;
      if (!invalidField) { state.validationField = ''; state.validationLabel = ''; state.validationMessage = ''; }
      const recommendations = state.categorySuggestion && state.categorySuggestion.candidates || [];
      const progress = buildProgressView(state, this.data.busy, rows);
      const previewOnly = state.purpose === 'preview' && !state.saveFormOpen;
      const eligibility = state.result && state.identity ? getEstimateEligibility(state) : null;
      const identitySafety = state.result ? getIdentityRequirement(state) : null;
      const labelWarning = labelFillWarning(state, rows);
      const canEstimate = !!eligibility && eligibility.eligible &&
        state.comparisonVersion > 0 && !state.estimate && !state.saving && !state.pendingSave &&
        !state.needType && !state.needIdentity && !labelWarning && state.status !== 'reference';
      const preview = buildPreviewView(state, rows, { busy: this.data.busy, labelWarning });
      this.setData({ ...progress, ...preview,
        invalidField, fieldError: invalidField ? state.validationMessage : '',
        scrollToField: scrollTarget ? '' : this.data.scrollToField,
        previewOnly, coverImagePath: state.coverImagePath || '', foodImagePaths: state.foodImagePaths || [], retryRecognitionRequired: !!state.retryRecognitionRequired, displayMode: state.mode, needType: !!state.needType, saving: !!state.saving, pendingSave: !!state.pendingSave,
        identityDetails: { ...(state.identity || {}) }, canRetryRecognition: state.status === 'failed',
        canRestoreDraft: !!this._previousDraft && (state.status === 'failed' || state.needType), duplicateReview: state.duplicateReview || null, existingItem: state.existingItem || null,
        duplicateReviewOpen: !!state.duplicateReviewOpen,
        duplicateComparison,
        duplicateChecking: !!state.duplicateChecking, duplicateCheckFailed: !!state.duplicateCheckFailed,
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
        canUse: !this.data.busy && !state.pendingSave && !state.identityDeferred &&
          !(identitySafety && identitySafety.required) && (previewOnly ? !!state.result && !state.needType && !state.needIdentity && state.status !== 'failed' : missing.length === 0),
        error: previewOnly && !state.result && state.status === 'failed' ? '未识别成功，请重拍或重试' : state.error || '' }, () => {
        // 等缺项提示和提交蒙层更新到界面后，再定位到实际表单项。
        if (scrollTarget && this._pending === state && this.isCurrentState(state) && state.validationField === scrollTarget) {
          this.setData({ scrollToField: 'recognition-field-' + scrollTarget });
        }
        if (onRendered) onRendered();
      });
    },
    cancelDialog() {
      if (this._pending && (this._pending.saving || this._pending.pendingSave)) { wx.showToast({ title: '请先恢复本次保存状态', icon: 'none' }); return; }
      const state = this._pending;
      if (state && state.dirty) {
        wx.showModal({ title: '放弃本次修改？', content: state.identityDeferred ? '本次页面暂留的照片和备注将关闭。' : '已手动核对的内容尚未保存。', confirmText: '放弃修改', cancelText: '继续编辑', success: result => {
          if (result.confirm && this._pending === state && !state.saving && !state.pendingSave) this.discardPending();
        } }); return;
      }
      this.discardPending();
    },
    discardPending() {
      this.cancelPreviewPreparation();
      this._flowEpoch += 1; this._pending = null;
      this._previousDraft = null; clearTimeout(this._slowTimer);
      // 未使用结果前，外层表单和已采用会话均保持原状。
      this.setData({ dialogOpen: false, busy: false, error: '', phase: '', phaseDetail: '', longWaiting: false, keyboardHeight: 0 });
    },
    restorePreviousDraft() {
      const state = this._previousDraft;
      if (!state || this.data.busy || this.data.pendingSave || !this.isCurrentState(state)) return;
      this._flowEpoch++; this._pending = state; this._previousDraft = null;
      state.duplicateReviewOpen = false;
      this.setData({ busy: false, error: '', canRestoreDraft: false }); this.renderDialog();
    },
    retryReference() {
      const state = this._pending; if (!state || this.data.busy || state.pendingSave) return;
      clearProposals(state); return this.runPending();
    },
    stopPropagation() {},
    onPreviewBasisChange(event) {
      const state = this._pending; const mode = event.currentTarget.dataset.mode;
      if (!state || !this.data.previewOnly || this.data.busy || state.pendingSave || !this.data.previewBasisOptions.some(item => item.value === mode)) return;
      // 切换只影响预览；保存基准与原始标签依据均不变。
      state.previewBasisMode = mode; this.renderDialog();
    },
    onKeyboardHeight(event) { this.setData({ keyboardHeight: this.data.dialogOpen ? Math.max(0, Number(event.detail.height) || 0) : 0 }); },
    toggleDuplicateReview() {
      const state = this._pending;
      if (!state || this.data.busy || state.pendingSave || !state.duplicateReview) return;
      state.duplicateReviewOpen = !state.duplicateReviewOpen;
      if (!state.duplicateReviewOpen) state.duplicateComparisonId = '';
      this.renderDialog();
    },
    openDuplicateComparison(event) {
      const state = this._pending;
      if (!state || this.data.busy || state.pendingSave) return;
      const itemId = event.currentTarget.dataset.id;
      const items = state.existingItem ? [state.existingItem] : state.duplicateReview && state.duplicateReview.candidates || [];
      if (!items.some(item => item.itemId === itemId)) return;
      wx.hideKeyboard();
      state.duplicateComparisonId = itemId;
      this.renderDialog();
    },
    closeDuplicateComparison() {
      if (!this._pending) return;
      this._pending.duplicateComparisonId = ''; this.renderDialog();
    },
    focusMissing(missing) {
      const state = this._pending; if (!state || !missing.length) return;
      const label = missing[0];
      const field = FIELDS.find(key => FIELD_NAMES[key] === label || FIELD_NAMES[key] + '格式' === label || FIELD_NAMES[key] + '待核对' === label) ||
        ({ 名称: 'name', 具体种类名称: 'name', 分类: 'category', 选择或创建本地分类: 'category', 记录单位: 'unit',
          营养基准份量: 'baseQuantity', 蛋白来源: 'proteinTypeIndex', 粉量: 'ratioPowder', 水量: 'ratioWater' })[label] || 'name';
      state.validationField = field; state.validationLabel = label;
      state.validationMessage = ({ name: '请填写并确认具体食物名称', category: '请选择有效分类', unit: '请选择记录单位',
        baseQuantity: '请填写大于 0 的基准份量', proteinTypeIndex: '请选择蛋白来源', ratioPowder: '请填写大于 0 的粉量',
        ratioWater: '请填写大于 0 的水量' })[field] || (label.endsWith('待核对') ? '请对照包装核对该数值' : '请填写有效的' + FIELD_NAMES[field] + '数值');
      state.error = ''; state.scrollToMissing = true;
      wx.hideKeyboard(); this.renderDialog();
    },
    onDialogInput(e) {
      const state = this._pending;
      if (!state || this.data.busy || state.pendingSave) return;
      const field = e.currentTarget.dataset.field;
      state.dirty = true;
      // 手填营养不改变食物身份，保留对比并即时更新差异。
      if (['name', 'baseQuantity'].includes(field)) { state.existingItem = null; state.duplicateReview = null; state.duplicateDecision = null; }
      if (FIELDS.includes(field)) editNutrition(state, field, e.detail.value);
      else {
        state.values[field] = e.detail.value;
        if (['ratioPowder', 'ratioWater'].includes(field)) state.ratioSource = 'manual';
        if (field === 'name') { clearProposals(state, true); invalidateIdentityConfirmation(state); state.needIdentity = !state.saveFormOpen; }
        if (field === 'baseQuantity') { clearProposals(state, true); state.initialBasisEdited = true; }
      }
      this.renderDialog();
    },
    confirmOriginalNutrition(event) {
      const state = this._pending;
      if (!state || this.data.busy || state.pendingSave) return;
      const field = event.currentTarget.dataset.field;
      const row = buildRows(state).find(item => item.path === field);
      if (!row || !row.retainedValueReview) return;
      editNutrition(state, field, state.values[field]); state.dirty = true;
      this.renderDialog();
    },
    async onDialogBlur(e) {
      const field = e.currentTarget.dataset.field;
      const state = this._pending;
      if (!state || this.data.busy || state.pendingSave || !state.result) return;
      if (state.saveFormOpen) return;
      if (field === 'name' && String(state.values.name || '').trim()) {
        state.identity = { ...state.identity, name: state.values.name.trim() };
        state.needIdentity = isGenericIdentity(state.identity) || state.identityManualRequired && !state.identityConfirmation || getIdentityRequirement(state).required;
        if (state.needIdentity) { state.identityEditorOpen = true; this.renderDialog(); return; }
        state.packageIdentityConfirmed = true;
        await this.runPending();
      } else if (field === 'baseQuantity' && number(state.values.baseQuantity) > 0) await this.runPending();
    },
    onCategoryChange(e) {
      const state = this._pending; const item = this.data.categoryItems[Number(e.detail.value)];
      if (!state || !item || this.data.busy || state.pendingSave) return;
      state.dirty = true;
      state.values.category = item.value; state.categoryManual = true; state.categoryRejected = !!item.value; this.renderDialog();
    },
    async onProteinChange(e) {
      if (!this._pending || this.data.busy || this._pending.pendingSave) return;
      const item = this.data.proteinItems[Number(e.detail.value)];
      if (!item) return;
      const state = this._pending; const previous = state.proteinOptions[state.values.proteinTypeIndex];
      state.dirty = true;
      const next = state.proteinOptions[item.index];
      state.values.proteinTypeIndex = item.index; state.proteinManual = true;
      if (previous && previous.value === 'special' || next && next.value === 'special') clearProposals(state);
      this.renderDialog();
      if (this._pending.result && !state.saveFormOpen) await this.runPending();
    },
    async onUseProteinSuggestion() {
      const state = this._pending;
      if (!state || this.data.busy || state.pendingSave || !state.proteinSuggestion) return;
      state.dirty = true;
      const previous = state.proteinOptions[state.values.proteinTypeIndex];
      const next = state.proteinOptions[state.proteinSuggestion.index];
      state.values.proteinTypeIndex = state.proteinSuggestion.index; state.proteinManual = true;
      if (previous && previous.value === 'special' || next && next.value === 'special') clearProposals(state);
      this.renderDialog();
      if (state.result && !state.saveFormOpen) await this.runPending();
    },
    onNewCategoryInput(e) {
      if (!this._pending || this.data.busy || this._pending.pendingSave) return;
      this._pending.newCategoryName = e.detail.value; this.renderDialog();
    },
    toggleCategoryCreate() {
      if (!this._pending || this.data.busy || this._pending.pendingSave) return;
      this._pending.categoryCreateOpen = !this._pending.categoryCreateOpen; this.renderDialog();
    },
    async onCreateCategory() {
      const state = this._pending;
      if (state && state.purpose === 'preview') return;
      if (!state || this.data.busy || state.pendingSave || state.mode === 'powder_label') return;
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
      if (!state || this.data.busy || state.pendingSave) return;
      state.dirty = true;
      const index = Number(e.detail.value);
      state.values.unit = index > 0 ? this.data.unitItems[index] : ''; state.initialBasisEdited = true;
      clearProposals(state, true); this.renderDialog();
      if (state.result && !state.saveFormOpen) await this.runPending();
    },
    async onCandidate(e) {
      const state = this._pending;
      if (!state || this.data.busy || state.pendingSave) return;
      const candidate = state.identityCandidates[Number(e.currentTarget.dataset.index)];
      if (!candidate) return;
      state.dirty = true;
      clearProposals(state); invalidateIdentityConfirmation(state);
      state.identity = { ...candidate }; state.values.name = candidate.name; state.needIdentity = true; state.identityEditorOpen = true;
      this.renderDialog();
    },
    async onContinueIdentity() {
      const state = this._pending;
      if (!state || this.data.busy || state.pendingSave || !String(state.values.name || '').trim()) return;
      let identity = { ...state.identity, name: state.values.name.trim() };
      if (isGenericIdentity(identity)) {
        state.error = '请填写具体种类，例如猪肉、牛肉或鸡肉；仍不确定可选择“我也不确定”'; this.renderDialog(); return;
      }
      const needsPreparation = ['uncertain', 'food_object'].includes(state.mode) && (state.identityManualRequired || getIdentityRequirement(state, identity).required);
      if (needsPreparation) {
        if (!['raw', 'boiled', 'stir_fried', 'other'].includes(state.identityPreparation)) {
          state.error = '请选择制备状态，糕点、甜点或其他成品可选择“其他制备 / 成品”'; this.renderDialog(); return;
        }
        identity = { ...identity, preparation: state.identityPreparation };
      }
      clearProposals(state);
      state.dirty = true; state.identity = identity;
      state.identityConfirmation = makeIdentityConfirmation(identity); state.identityConfirmationPending = true;
      state.needIdentity = getIdentityRequirement(state).required;
      if (state.needIdentity) { state.error = '请补充具体名称与生熟状态后确认'; this.renderDialog(); return; }
      if (state.mode === 'uncertain') state.mode = 'food_object';
      state.needType = false; state.identityDeferred = false; state.identityEditorOpen = false; state.packageIdentityConfirmed = true;
      await this.runPending();
    },
    onIdentityPreparationChange(event) {
      const state = this._pending; if (!state || this.data.busy || state.pendingSave) return;
      const preparation = ['', 'raw', 'boiled', 'stir_fried', 'other'][Number(event.detail.value)];
      if (preparation === undefined) return;
      clearProposals(state); invalidateIdentityConfirmation(state);
      state.identityPreparation = preparation; state.identity = { ...state.identity, preparation: preparation || 'unknown' };
      state.needIdentity = true; state.identityManualRequired = true; state.dirty = true; this.renderDialog();
    },
    onIdentityUnknown() {
      const state = this._pending; if (!state || this.data.busy || state.pendingSave) return;
      clearProposals(state); invalidateIdentityConfirmation(state);
      state.needIdentity = true; state.identityDeferred = true; state.identityEditorOpen = false;
      state.status = 'identity_deferred'; state.stage = 'review'; state.previewShown = true; state.dirty = true;
      this.renderDialog();
    },
    onIdentityNoteInput(event) {
      const state = this._pending; if (!state || this.data.busy || state.pendingSave || !state.identityDeferred) return;
      state.identityNote = String(event.detail.value || '').slice(0, 160); state.dirty = true;
    },
    async onReference(e) {
      const state = this._pending;
      if (!state || this.data.busy || state.pendingSave) return;
      const candidate = state.referenceCandidates[Number(e.currentTarget.dataset.index)];
      if (!candidate) return;
      if (isGenericIdentity(candidate.identity)) { state.error = '该参考名称过于笼统，请填写具体种类后核对'; this.renderDialog(); return; }
      state.dirty = true;
      clearProposals(state); invalidateIdentityConfirmation(state);
      state.identity = { ...candidate.identity }; state.values.name = candidate.identity.name;
      state.identityConfirmation = makeIdentityConfirmation(state.identity, 'user_selected_reference', candidate.referenceId);
      if (state.mode === 'uncertain') state.mode = 'food_object';
      state.needIdentity = false; state.packageIdentityConfirmed = true; state.selectedReferenceId = candidate.referenceId;
      await this.runPending();
    },
    async onSkipReference() {
      if (!this._pending || this.data.busy || this._pending.pendingSave) return;
      this._pending.dirty = true;
      this._pending.ignoreReference = true; await this.runPending();
    },
    async onSkipEstimate() {
      this.onIdentityUnknown();
    },
    async useResults() {
      const state = this._pending;
      if (!state || this.data.busy || state.pendingSave) return;
      if (!state.saveFormOpen && (state.needIdentity || state.identityDeferred)) { this.openIdentityEditor(); return; }
      if (state.purpose === 'preview') {
        if (!state.saveFormOpen) return this.openSaveForm();
        return this.savePreview();
      }
      const missing = validateDialog(state, { proteinOptions: this.properties.proteinOptions || [] });
      if (missing.length) { this.focusMissing(missing); return; }
      if (state.initialFormKey !== formKey(this.properties.draft || {}, state.mode)) {
        state.error = '原表单已变化，请取消后重新识别'; this.renderDialog(); return;
      }
      const patch = resultPatch(state);
      this.setData({ busy: true });
      try {
        const images = await uploadFoodImages(state.foodImagePaths, state.prepared.envId, state.foodImageUploads);
        if (this._pending !== state || !this.isCurrentState(state)) return;
        Object.assign(patch, { images, image: images[Math.max(0, state.foodImagePaths.indexOf(state.coverImagePath))] || '' });
      } catch (error) {
        if (this._pending === state && this.isCurrentState(state)) { state.error = error.message || '图片保存失败，请重试'; this.renderDialog(); }
        return;
      } finally { if (this._pending === state && this.isCurrentState(state)) this.setData({ busy: false }); }
      this._applied = state; this._pending = null; this._flowEpoch += 1;
      this.emitPatch(patch, [...state.editedFields].filter(field => FIELDS.includes(field) && state.decisions[field] && state.decisions[field].source === 'manual'));
      this.setData({ dialogOpen: false, busy: false, error: '', phase: '', phaseDetail: '' });
    },
    markManual(field, value) {
      this._parentTouched = { ...(this._parentTouched || {}), [field]: true };
      const state = this._applied;
      if (!state) return;
      if (FIELDS.includes(field)) editNutrition(state, field, value);
      if (['ratioPowder', 'ratioWater'].includes(field)) state.ratioSource = 'manual';
      if (['name', 'unit', 'baseQuantity'].includes(field)) {
        state.values[field] = value;
        if (field === 'name') {
          invalidateIdentityConfirmation(state);
          state.identity = { ...state.identity, name: value };
        }
        const nutrition = state.mode === 'powder_label' ? (this.properties.draft || {}).nutritionPer100g || {} : this.properties.draft || {};
        FIELDS.forEach(path => {
          state.values[path] = isBlank(nutrition[path]) ? '' : String(nutrition[path]);
        });
        clearProposals(state, true);
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
        const decisions = FIELDS.filter(path => !isBlank(values[path]) && !(path === 'sodium' && state.mode === 'powder_label'))
          .map(path => ({ path, source: (state.decisions[path] || {}).source || 'manual', value: values[path] }));
        return await confirmWithRecovery({ ...saveContext,
          ...(state.mode !== 'powder_label' ? { targetId: state.prepared.targetFoodId } : {}),
          babyUid: state.babyUid, sessionId: state.result.sessionId, operationId: state.operationId,
          comparisonVersion: state.comparisonVersion, useFormValues: true, identity: { ...state.identity, name: draft.name },
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
      state.identityDeferred = false; state.identityEditorOpen = true; this.renderDialog();
    },
    async chooseFoodImage() {
      const state = this._pending;
      if (!state || this.data.busy || state.pendingSave || state.foodImagePaths.length >= 3) return;
      this.setData({ busy: true });
      try {
        const paths = await chooseRecognitionImages({ count: 3 - state.foodImagePaths.length });
        if (this._pending !== state || !this.isCurrentState(state)) return;
        state.foodImagePaths = [...new Set(state.foodImagePaths.concat(paths))];
        if (!state.coverImagePath) state.coverImagePath = paths[0];
        state.dirty = true;
      } catch (error) {
        if (this._pending === state && this.isCurrentState(state) && !/cancel/i.test(error.errMsg || error.message || '')) {
          state.error = error.message || '选择图片失败，请重试';
        }
      } finally {
        if (this._pending === state && this.isCurrentState(state)) { this.setData({ busy: false }); this.renderDialog(); }
      }
    },
    previewFoodImage(event) {
      const state = this._pending; const index = Number(event.currentTarget.dataset.index);
      if (!state || this.data.busy || state.pendingSave || !state.foodImagePaths[index]) return;
      wx.previewImage({ current: state.foodImagePaths[index], urls: state.foodImagePaths });
    },
    setFoodImageCover(event) {
      const state = this._pending; const index = Number(event.currentTarget.dataset.index);
      if (!state || this.data.busy || state.pendingSave || !state.foodImagePaths[index]) return;
      state.coverImagePath = state.foodImagePaths[index]; state.dirty = true; this.renderDialog();
    },
    removeFoodImage(event) {
      const state = this._pending; const index = Number(event.currentTarget.dataset.index);
      if (!state || this.data.busy || state.pendingSave || !state.foodImagePaths[index]) return;
      state.foodImagePaths = state.foodImagePaths.filter((_, i) => i !== index);
      if (!state.foodImagePaths.includes(state.coverImagePath)) state.coverImagePath = state.foodImagePaths[0] || '';
      state.dirty = true; this.renderDialog();
    },
    openSaveForm() {
      const state = this._pending; if (!state || this.data.busy || state.pendingSave || state.needType) return;
      if (state.needIdentity || state.identityDeferred || getIdentityRequirement(state).required) { this.openIdentityEditor(); return; }
      // 直接填写当前识别结果，保存时以用户最终表单为准。
      state.saveFormOpen = true;
      this.setData({ scrollToField: '' }); this.renderDialog();
      if (state.duplicateCheckFailed) state.duplicateCheckKey = '';
      this.checkDuplicatePreview(state);
    },
    async checkDuplicatePreview(state) {
      if (state.purpose !== 'preview' || !state.result || state.needType || state.needIdentity ||
          state.identityDeferred || state.saving || state.pendingSave || state.status === 'failed' || getIdentityRequirement(state).required) return;
      // 同一身份沿用预查结果，改名后由清空草稿建议使旧请求失效。
      const key = JSON.stringify([state.mode, state.identity]);
      if (state.duplicateCheckKey === key) return;
      state.duplicateCheckKey = key;
      const requestId = state.duplicateCheckId = createRequestId();
      const identityKey = JSON.stringify(state.identity); const mode = state.mode; const name = state.values.name;
      state.duplicateChecking = true; state.duplicateCheckFailed = false; this.renderDialog();
      const active = () => this._pending === state && this.isCurrentState(state) && state.duplicateCheckId === requestId;
      try {
        const result = await callNutritionFunction('recognizeNutritionLabel', { action: 'checkDuplicates',
          babyUid: state.babyUid, sessionId: state.result.sessionId, requestId,
          targetType: mode === 'powder_label' ? 'powder' : 'food', identity: { ...state.identity } });
        if (!active() || mode !== state.mode || name !== state.values.name || identityKey !== JSON.stringify(state.identity)) return;
        state.existingItem = result.existing || null; state.duplicateReview = result.duplicateReview || null;
        state.duplicateReviewOpen = !!state.duplicateReview && state.duplicateReview.total === 1;
      } catch (_) {
        if (active()) state.duplicateCheckFailed = true;
      } finally {
        if (active()) { state.duplicateChecking = false; this.renderDialog(); }
      }
    },
    async bindPreviewState(state) {
      // 正式绑定开始后，忽略尚未返回的只读查重结果。
      state.duplicateCheckId = ''; state.duplicateChecking = false;
      this.setData({ busy: true });
      try {
        const result = await callNutritionFunction('recognizeNutritionLabel', { action: 'bindTarget', babyUid: state.babyUid, sessionId: state.result.sessionId,
          requestId: createRequestId(), targetType: state.mode === 'powder_label' ? 'powder' : 'food', comparisonVersion: state.comparisonVersion,
          useFormValues: true, identity: { ...state.identity, name: state.values.name }, targetBasis: targetBasis(state),
          duplicateReviewToken: state.duplicateDecision || undefined, allowDuplicate: !!state.duplicateDecision });
        if (this._pending !== state || !this.isCurrentState(state)) return false;
        state.comparisonVersion = result.comparisonVersion;
        state.duplicateCheckFailed = false;
        state.duplicateReviewOpen = !result.existing && !!result.duplicateReview && result.duplicateReview.total === 1;
        if (result.existing || result.duplicateReview) {
          state.binding = null; state.existingItem = result.existing || null; state.duplicateReview = result.duplicateReview || null;
          state.duplicateDecision = null; state.error = '';
          if (state.existingItem) this.triggerEvent('existing', { ...state.existingItem, babyUid: state.babyUid });
          return false;
        }
        state.duplicateReview = null; state.existingItem = null; state.error = '';
        state.binding = result.binding; state.expectedVersion = result.expectedVersion; return true;
      } catch (error) { if (this._pending === state && this.isCurrentState(state)) state.error = error.message || '添加前核对失败，请重试'; return false; }
      finally { if (this._pending === state && this.isCurrentState(state)) { this.setData({ busy: !!state.saving }); this.renderDialog(); } }
    },
    async confirmDuplicateAddition() {
      const state = this._pending;
      if (!state || (this.data.busy && !state.saving) || state.pendingSave || !state.duplicateReview || !state.duplicateReview.token || !state.duplicateReview.canConfirm) return false;
      const review = state.duplicateReview;
      const answer = await new Promise(resolve => wx.showModal({ title: '确认新增一份',
        content: (state.existingItem ? '资料库已有同一食物。' : '资料库已有相近资料。') + '继续会新增独立条目，已有资料不会被修改。',
        confirmText: '继续添加', cancelText: '返回核对', success: resolve, fail: () => resolve({ confirm: false }) }));
      if (this._pending !== state || state.duplicateReview !== review || !this.isCurrentState(state)) return false;
      if (!answer.confirm) { state.error = '已取消添加，本次资料尚未保存'; return false; }
      state.duplicateDecision = review.token;
      return this.bindPreviewState(state);
    },
    onIdentityDetailInput(event) {
      const state = this._pending; const key = event.currentTarget.dataset.key;
      if (!state || this.data.busy || state.pendingSave || !['brand', 'series', 'stage', 'barcode'].includes(key)) return;
      state.identity = { ...state.identity, [key]: event.detail.value }; state.dirty = true;
      clearProposals(state); invalidateIdentityConfirmation(state);
      state.needIdentity = state.identityManualRequired || getIdentityRequirement(state).required;
      state.existingItem = null; this.renderDialog();
    },
    onIdentityDetailBlur() { if (this._pending && !this.data.busy && !this._pending.pendingSave && !this._pending.saveFormOpen && this._pending.result) return this.runPending(); },
    async savePreview() {
      const state = this._pending; if (!state || this.data.busy || state.saving || state.pendingSave) return;
      const missingFields = validateDialog(state, { proteinOptions: this.properties.proteinOptions || [], currentForm: true });
      if (missingFields.length) { this.focusMissing(missingFields); return; }
      state.error = ''; state.saving = true; this.setData({ busy: true, phase: '正在添加', phaseDetail: '' }); this.renderDialog();
      try {
        // 仅绑定当前资料、查重和上传，不再次查询或覆盖营养值。
        let bound = await this.bindPreviewState(state);
        if (!bound && this._pending === state && state.duplicateReview && state.duplicateReview.token) bound = await this.confirmDuplicateAddition();
        if (this._pending !== state || !this.isCurrentState(state)) return;
        if (!bound) {
          state.error = state.error || (state.existingItem || state.duplicateReview ?
            '尚未添加，请先核对已有资料' : '添加前核对未完成，请重试');
          return;
        }
        const protein = state.proteinOptions[state.values.proteinTypeIndex] || {};
        const form = { name: state.values.name, category: state.values.category, categoryLevel2: state.values.categoryLevel2 || '',
          proteinSource: protein.value || '', proteinQuality: protein.quality || '',
          mixRatio: { powder: state.values.ratioPowder, water: state.values.ratioWater } };
        const decisions = buildRows(state).filter(row => !isBlank(row.value))
          .map(row => ({ path: row.path, source: row.source || 'manual', value: row.value }));
        if (state.mode !== 'powder_label') {
          form.images = await uploadFoodImages(state.foodImagePaths, state.prepared.envId, state.foodImageUploads);
          form.image = form.images[Math.max(0, state.foodImagePaths.indexOf(state.coverImagePath))] || '';
        }
        if (this._pending !== state || !this.isCurrentState(state)) return;
        state.submittedName = form.name;
        const result = await confirmWithRecovery({ babyUid: state.babyUid, sessionId: state.result.sessionId, operationId: state.operationId, comparisonVersion: state.comparisonVersion,
          useFormValues: true,
          expectedVersion: state.expectedVersion, targetBasis: targetBasis(state), decisions, form, mixRatioDecision: { source: state.ratioSource } });
        const saved = { ...result, name: state.submittedName, accountKey: state.accountKey, babyUid: state.babyUid, mode: state.mode };
        invalidateSearchForBaby(state.babyUid, saved);
        if (this._pending === state && this.isCurrentState(state)) { this._pending = null; this._previousDraft = null; this.setData({ dialogOpen: false, busy: false, saving: false }); this.triggerEvent('saved', saved); }
      } catch (error) {
        if (this._pending === state && this.isCurrentState(state)) {
          state.pendingSave = !!pendingConfirmation(state.babyUid);
          state.error = state.pendingSave ? '保存结果暂未确认，请点击“恢复保存状态”，避免重复添加。' : error.message || '添加失败，请重试';
          if (!state.pendingSave) { state.operationId = createRequestId(); if (['VERSION_CONFLICT', 'COMPARISON_STALE'].includes(error.code)) state.binding = null; }
        }
      } finally {
        state.saving = false;
        if (this._pending === state && this.isCurrentState(state)) {
          this.setData({ busy: false });
          this.renderDialog(() => {
            if (this._pending === state && this.isCurrentState(state) && state.error) {
              wx.showToast({ title: state.pendingSave ? '保存结果待确认' : '尚未添加，请查看提示', icon: 'none' });
            }
          });
        }
      }
    },
    async recoverPreviewSave() {
      const state = this._pending; if (!state || this.data.busy) return;
      const epoch = this._epoch; const context = currentContext();
      const pending = pendingConfirmation(state.babyUid); if (!pending) return;
      this.setData({ busy: true });
      try {
        const result = await recoverConfirmation(pending);
        if (this._pending !== state || !this.isCurrentState(state)) return;
        if (result.state === 'saved') { const saved = { ...result.savedResult, name: state.submittedName, accountKey: state.accountKey, babyUid: state.babyUid, mode: state.mode }; invalidateSearchForBaby(state.babyUid, saved); this._pending = null; this.setData({ dialogOpen: false, pendingSave: false }); this.triggerEvent('saved', saved); }
        else if (['failed', 'not_submitted'].includes(result.state)) { state.pendingSave = false; state.error = '本次尚未保存，可核对后重新提交'; state.operationId = createRequestId(); state.binding = null; }
        else state.error = result.state === 'processing' ? '仍在保存，请稍后再查看' : '暂不能确认保存结果，请稍后恢复状态，避免重复添加';
      } catch (error) { if (this._pending === state && this.isCurrentState(state)) state.error = error.message; }
      finally { if (epoch === this._epoch && sameContext(context)) this.setData({ busy: false }); if (this._pending === state && this.isCurrentState(state)) this.renderDialog(); }
    }
  }
});
