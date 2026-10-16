const { FIELDS, number, estimateEligibility, normalizeCategoryCatalog, normalizeCategoryName, matchCategory } = require('./lib/core/index.js');
const FoodCategoryModel = require('../../../models/foodCategory');
const { isBlank } = require('../../../utils/nutritionComparison');
const { createRequestId, callNutritionFunction, chooseRecognitionImages, uploadRecognitionImages, confirmWithRecovery, pendingConfirmation, recoverConfirmation } = require('../../../utils/nutritionRecognition');
const { invalidateSearchForBaby, currentContext } = require('../../../utils/searchSession');
const { createDialogState, formKey, targetBasis, clearProposals, editNutrition, buildRows, validateDialog, resultPatch } = require('./dialogState');
const { runWorkflow, providerName } = require('./workflow');
const { buildProgressView } = require('./progressView');
function sameContext(context) { const current = currentContext(); return current.accountKey === context.accountKey && current.babyUid === context.babyUid; }
const PREPARATIONS = [{ value: 'raw', label: '生鲜' }, { value: 'boiled', label: '水煮' }, { value: 'stir_fried', label: '炒制' }];

Component({
  properties: { babyUid: String, mode: { type: String, value: 'food_label' }, draft: Object, expectedVersion: Number,
    purpose: { type: String, value: 'form' }, babyName: String, powderCategoryOptions: Array,
    sourceSystemFoodId: String, targetId: String, formSessionId: Number,
    showTrigger: { type: Boolean, value: true }, categoryOptions: Array, proteinOptions: Array },
  data: { dialogOpen: false, busy: false, phase: '', phaseDetail: '', error: '', values: {},
    nutrientRows: [], requiredNutrientRows: [], optionalNutrientRows: [], categoryItems: [], categoryIndex: 0, categoryLabel: '',
    unitItems: ['请选择单位', 'g', 'ml', '份'], unitIndex: 0, proteinItems: [], proteinIndex: 0,
    unmatchedCategory: false, newCategoryName: '', categoryCreateOpen: false,
    proteinSuggestionText: '', proteinSuggestionIndex: -1, proteinSuggestionSpecial: false,
    preparations: PREPARATIONS, preparationIndex: 0,
    identityCandidates: [], referenceCandidates: [], needIdentity: false, needPreparation: false, canAdjustPreparation: false, showPreparation: false, needReference: false,
    recoveryPending: null, recoveryBusy: false, canUse: false, hasEstimate: false, previewOnly: false, displayMode: 'food_label', needType: false, canEstimate: false, saving: false, pendingSave: false,
    steps: [], imagePaths: [], uploadedCount: 0, imageCount: 0, identityVisible: false, nutritionVisible: false },
  lifetimes: {
    attached() { this.resetForm(); },
    detached() { this._epoch += 1; this._flowEpoch += 1; this._pending = null; }
  },
  observers: {
    formSessionId() { this.resetForm(); },
    babyUid() { this.resetForm(); }
  },
  methods: {
    resetForm() {
      this._epoch = (this._epoch || 0) + 1; this._flowEpoch = (this._flowEpoch || 0) + 1;
      this._pending = null; this._applied = null; this._parentTouched = {};
      this.setData({ recoveryPending: this.properties.babyUid ? pendingConfirmation(this.properties.babyUid) : null, recoveryBusy: false, dialogOpen: false, busy: false, phase: '', phaseDetail: '', error: '',
        nutrientRows: [], requiredNutrientRows: [], optionalNutrientRows: [], values: {}, hasEstimate: false, canUse: false, saving: false, pendingSave: false, needType: false, previewOnly: false });
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
        const state = createDialogState({ ...this.properties, ...(options.mode ? { mode: options.mode } : {}) }, paths);
        if (this._parentTouched.unit || this._parentTouched.baseQuantity) state.initialBasisEdited = true;
        state.accountKey = currentContext().accountKey;
        state.operationId = createRequestId();
        this._pending = state;
        this.setData({ dialogOpen: true, phase: '准备识别', phaseDetail: '' });
        this.renderDialog();
        await this.runPending();
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
        if (result.confirm && this._pending === state && !this.data.busy) this.startRecognition({ paths: state.paths, mode: state.purpose === 'preview' ? 'auto' : state.mode });
      } });
    },
    async runPending() {
      const state = this._pending;
      if (!state) return;
      const epoch = this._epoch; const context = currentContext(); const flow = this._flowEpoch = (this._flowEpoch || 0) + 1;
      const active = () => epoch === this._epoch && sameContext(context) && flow === this._flowEpoch && this._pending === state && currentContext().accountKey === state.accountKey && currentContext().babyUid === state.babyUid;
      this.setData({ busy: true, error: '', canUse: false });
      try {
        await runWorkflow(state, { call: callNutritionFunction, upload: uploadRecognitionImages, isActive: active,
          onUpdate: (phase, phaseDetail) => { if (active()) { this.setData({ phase, phaseDetail }); this.renderDialog(); } } });
      } finally {
        if (active()) { this.setData({ busy: false }); this.renderDialog(); }
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
      const canAdjustPreparation = !!state.result && estimateEligibility({ mode: state.mode,
        identity: { ...state.identity, preparation: 'unknown' }, observation: state.result.observation,
        reference: state.reference, basis: targetBasis(state) }).reason.includes('生鲜');
      const recommendations = state.categorySuggestion && state.categorySuggestion.candidates || [];
      const progress = buildProgressView(state, this.data.busy, rows);
      const previewOnly = state.purpose === 'preview' && !state.saveFormOpen;
      const eligibility = state.result && state.identity ? estimateEligibility({ mode: state.mode, identity: state.identity, observation: state.result.observation, reference: state.reference, basis: targetBasis(state) }) : null;
      this.setData({ ...progress, previewOnly, retryRecognitionRequired: !!state.retryRecognitionRequired, displayMode: state.mode, needType: !!state.needType, saving: !!state.saving, pendingSave: !!state.pendingSave,
        canEstimate: !previewOnly && !!eligibility && eligibility.eligible && !state.estimate && !state.saving,
        previewName: state.values.name || ((state.identityCandidates || [])[0] || {}).name || '物品待确认',
        previewType: { food_label: '食物包装', powder_label: '奶粉包装', food_object: '食物实物', uncertain: '类型待确认', unsupported: '暂不支持的图片' }[state.mode] || '',
        previewBasis: state.reference || (state.result && state.result.originalBasis && state.result.originalBasis.quantity > 0) ? '以下按每 ' + state.values.baseQuantity + (state.mode === 'powder_label' ? 'g 干粉' : state.values.unit) + '展示' : '图片未提供可比较的营养基准',
        previewRows: rows, referenceWarning: state.referenceWarning || '', values: { ...state.values }, categoryItems, categoryIndex,
        categoryLabel: category ? category.label : state.values.category, unitItems, proteinItems,
        unmatchedCategory: !!state.categorySuggestion && !!state.categorySuggestion.name && !recommendations.length && !state.categoryRejected,
        categoryCreateOpen: !!state.categoryCreateOpen,
        newCategoryName: state.newCategoryName == null ? state.categorySuggestion && state.categorySuggestion.name || '' : state.newCategoryName,
        proteinSuggestionText: state.proteinSuggestion ? state.proteinSuggestion.label : '',
        proteinSuggestionIndex: state.proteinSuggestion ? state.proteinSuggestion.index : -1,
        proteinSuggestionSpecial: !!state.proteinSuggestion && state.proteinSuggestion.special,
        proteinIndex: Math.max(0, proteinItems.findIndex(item => item.index === state.values.proteinTypeIndex)),
        unitIndex: Math.max(0, unitItems.indexOf(state.values.unit)),
        preparationIndex: PREPARATIONS.findIndex(item => item.value === (state.identity || {}).preparation), canAdjustPreparation,
        showPreparation: canAdjustPreparation && (state.needPreparation || !!state.preparationEditorOpen),
        identityCandidates: state.identityCandidates,
        referenceCandidates: state.referenceCandidates.map(item => ({ referenceId: item.referenceId,
          identity: { name: item.identity.name }, source: { provider: providerName(item.source.provider) } })),
        needIdentity: state.needIdentity, needPreparation: state.needPreparation, needReference: state.status === 'reference',
        canUse: !this.data.busy && !state.pendingSave && (previewOnly ? !!state.result && !state.needType && state.status !== 'failed' : missing.length === 0),
        error: state.error || '', hasEstimate: rows.some(row => row.source === 'model_estimate'),
        missingSummary: state.status === 'failed' && state.failedStage === 'reference' ? '请先完成营养参考查询' :
          missing.length ? '请补全必填信息后使用' : '点击使用结果，回填到原表单' });
    },
    cancelDialog() {
      if (this._pending && (this._pending.saving || this._pending.pendingSave)) { wx.showToast({ title: '请先恢复本次保存状态', icon: 'none' }); return; }
      this._flowEpoch += 1; this._pending = null;
      // 未使用结果前，外层表单和已采用会话均保持原状。
      this.setData({ dialogOpen: false, busy: false, error: '', phase: '', phaseDetail: '' });
    },
    stopPropagation() {},
    onDialogInput(e) {
      const state = this._pending;
      if (!state || this.data.busy) return;
      const field = e.currentTarget.dataset.field;
      if (FIELDS.includes(field)) editNutrition(state, field, e.detail.value);
      else {
        state.values[field] = e.detail.value;
        if (['ratioPowder', 'ratioWater'].includes(field)) state.ratioSource = 'manual';
        if (field === 'name') { clearProposals(state); state.needIdentity = true; }
        if (field === 'baseQuantity') { clearProposals(state); state.initialBasisEdited = true; }
      }
      this.renderDialog();
    },
    async onDialogBlur(e) {
      const field = e.currentTarget.dataset.field;
      const state = this._pending;
      if (!state || this.data.busy || !state.result) return;
      if (field === 'name' && String(state.values.name || '').trim()) {
        state.identity = { ...state.identity, name: state.values.name.trim() }; state.needIdentity = false;
        await this.runPending();
      } else if (field === 'baseQuantity' && number(state.values.baseQuantity) > 0) await this.runPending();
    },
    onCategoryChange(e) {
      const state = this._pending; const item = this.data.categoryItems[Number(e.detail.value)];
      if (!state || !item || this.data.busy) return;
      state.values.category = item.value; state.categoryManual = true; state.categoryRejected = !!item.value; this.renderDialog();
    },
    async onProteinChange(e) {
      if (!this._pending || this.data.busy) return;
      const item = this.data.proteinItems[Number(e.detail.value)];
      if (!item) return;
      const state = this._pending; const previous = state.proteinOptions[state.values.proteinTypeIndex];
      const next = state.proteinOptions[item.index];
      state.values.proteinTypeIndex = item.index; state.proteinManual = true;
      if (previous && previous.value === 'special' || next && next.value === 'special') clearProposals(state);
      this.renderDialog();
      if (this._pending.result) await this.runPending();
    },
    async onUseProteinSuggestion() {
      const state = this._pending;
      if (!state || this.data.busy || !state.proteinSuggestion) return;
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
      clearProposals(state); state.identity = { ...candidate }; state.values.name = candidate.name; state.needIdentity = false;
      await this.runPending();
    },
    async onContinueIdentity() {
      const state = this._pending;
      if (!state || this.data.busy || !String(state.values.name || '').trim()) return;
      state.identity = { ...state.identity, name: state.values.name.trim() }; state.needIdentity = false;
      await this.runPending();
    },
    async onPreparationChange(e) {
      const state = this._pending; const item = PREPARATIONS[Number(e.detail.value)];
      if (!state || !item || this.data.busy) return;
      clearProposals(state); state.identity = { ...state.identity, preparation: item.value }; state.needPreparation = false;
      state.preparationEditorOpen = false;
      await this.runPending();
    },
    togglePreparationEditor() {
      const state = this._pending;
      if (!state || this.data.busy || state.needPreparation || !this.data.canAdjustPreparation) return;
      state.preparationEditorOpen = !state.preparationEditorOpen; this.renderDialog();
    },
    onPreparationChoice(e) { return this.onPreparationChange({ detail: { value: e.currentTarget.dataset.index } }); },
    async onReference(e) {
      const state = this._pending;
      if (!state || this.data.busy) return;
      const candidate = state.referenceCandidates[Number(e.currentTarget.dataset.index)];
      if (!candidate) return;
      clearProposals(state); state.identity = { ...candidate.identity }; state.values.name = candidate.identity.name;
      state.needIdentity = false; state.needPreparation = false; state.selectedReferenceId = candidate.referenceId;
      await this.runPending();
    },
    async onSkipReference() {
      if (!this._pending || this.data.busy) return;
      this._pending.ignoreReference = true; await this.runPending();
    },
    async onSkipEstimate() {
      const state = this._pending;
      if (!state || this.data.busy) return;
      state.ignoreEstimate = true; state.needIdentity = false; state.needPreparation = false;
      state.preparationEditorOpen = false;
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
      if (missing.length) { state.error = '请补充：' + missing.join('、'); this.renderDialog(); return; }
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
      if (!this._pending || this.data.busy) return;
      this._pending.allowEstimate = true; this._pending.ignoreEstimate = false; await this.runPending();
    },
    async retryType(event) {
      const state = this._pending; if (!state || this.data.busy || state.pendingSave) return;
      await this.startRecognition({ paths: state.paths, mode: event.currentTarget.dataset.mode });
    },
    async addPreviewImage() {
      const state = this._pending; if (!state || this.data.busy || state.paths.length >= 3 || state.pendingSave) return;
      try {
        const paths = await chooseRecognitionImages({ count: 3 - state.paths.length, sourceType: ['camera', 'album'] });
        if (this._pending !== state || !this.isCurrentState(state)) return;
        await this.startRecognition({ paths: state.paths.concat(paths), mode: 'auto' });
      } catch (error) { if (!/cancel/i.test(error.errMsg || '')) { state.error = error.message || '添加图片失败'; this.renderDialog(); } }
    },
    async beginPreviewSave() {
      const state = this._pending; if (!state || this.data.busy || state.needType) return;
      state.saveFormOpen = true; await this.runPending();
      if (this._pending !== state || !state.comparisonVersion) return;
      await this.bindPreviewState(state);
    },
    async bindPreviewState(state) {
      if (state.binding) return true;
      this.setData({ busy: true });
      try {
        const result = await callNutritionFunction('recognizeNutritionLabel', { action: 'bindTarget', babyUid: state.babyUid, sessionId: state.result.sessionId,
          requestId: createRequestId(), targetType: state.mode === 'powder_label' ? 'powder' : 'food', comparisonVersion: state.comparisonVersion });
        if (this._pending !== state || !this.isCurrentState(state)) return false;
        if (result.existing) { state.error = '资料库已有相同物品，可关闭后到管理页查看'; this.triggerEvent('existing', result.existing); return false; }
        state.binding = result.binding; state.expectedVersion = result.expectedVersion; return true;
      } catch (error) { if (this._pending === state && this.isCurrentState(state)) state.error = error.message; return false; }
      finally { if (this._pending === state && this.isCurrentState(state)) { this.setData({ busy: false }); this.renderDialog(); } }
    },
    async savePreview() {
      const state = this._pending; if (!state || this.data.busy || state.pendingSave) return;
      const missing = validateDialog(state, { proteinOptions: this.properties.proteinOptions || [] });
      if (missing.length) { state.error = '请补充：' + missing.join('、'); this.renderDialog(); return; }
      if (!await this.bindPreviewState(state) || this._pending !== state) return;
      const protein = state.proteinOptions[state.values.proteinTypeIndex] || {};
      const form = { name: state.values.name, category: state.values.category, categoryLevel2: state.values.categoryLevel2 || '',
        proteinSource: protein.value || '', proteinQuality: protein.quality || '',
        mixRatio: { powder: state.values.ratioPowder, water: state.values.ratioWater } };
      const decisions = FIELDS.filter(path => state.decisions[path] && !(path === 'sodium' && state.mode === 'powder_label')).map(path => state.decisions[path].source === 'manual' ? { path, source: 'manual', value: state.values[path] } : { path, source: state.decisions[path].source });
      state.saving = true; this.setData({ busy: true, phase: '正在保存', phaseDetail: '保存到当前宝宝的资料库' }); this.renderDialog();
      try {
        const result = await confirmWithRecovery({ babyUid: state.babyUid, sessionId: state.result.sessionId, operationId: state.operationId, comparisonVersion: state.comparisonVersion,
          expectedVersion: state.expectedVersion, targetBasis: targetBasis(state), decisions, form, mixRatioDecision: { source: state.ratioSource } });
        invalidateSearchForBaby(state.babyUid);
        if (this._pending === state && this.isCurrentState(state)) { this._pending = null; this.setData({ dialogOpen: false, busy: false, saving: false }); this.triggerEvent('saved', { ...result, babyUid: state.babyUid, mode: state.mode }); }
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
        if (result.state === 'saved') { invalidateSearchForBaby(state.babyUid); this._pending = null; this.setData({ dialogOpen: false, pendingSave: false }); this.triggerEvent('saved', { ...result.savedResult, babyUid: state.babyUid, mode: state.mode }); }
        else if (['failed', 'not_submitted'].includes(result.state)) { state.pendingSave = false; state.error = '本次尚未保存，可核对后重新提交'; if (result.state === 'failed') { state.operationId = createRequestId(); state.binding = null; } }
        else state.error = result.state === 'processing' ? '仍在保存，请稍后再查看' : '暂不能确认保存结果，请稍后恢复状态，避免重复添加';
      } catch (error) { if (this._pending === state && this.isCurrentState(state)) state.error = error.message; }
      finally { if (epoch === this._epoch && sameContext(context)) this.setData({ busy: false }); if (this._pending === state && this.isCurrentState(state)) this.renderDialog(); }
    }
  }
});
