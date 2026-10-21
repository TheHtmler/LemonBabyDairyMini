const { number, searchText, REQUIRED, FIELDS, estimateIdentityKey } = require('./lib/core/index.js');
const { isBlank } = require('../../../utils/nutritionComparison');
const { createRequestId } = require('../../../utils/nutritionRecognition');
const { targetBasis, offerNutrition, applyClassification, getEstimateEligibility } = require('./dialogState');
const PROVIDER_NAMES = { china_food_table: '中国食物成分表', usda_fdc: 'USDA', manufacturer: '厂家资料', verified_catalog: '已核验参考' };
function providerName(provider) { return PROVIDER_NAMES[provider] || provider; }

async function runWorkflow(state, { call, upload, isActive, onUpdate }) {
  const update = (phase, detail = '', stage) => { if (stage) state.stage = stage; if (isActive()) onUpdate(phase, detail); };
  const stop = (status, detail) => { state.status = status; update('请核对识别结果', detail, 'review'); };
  try {
    state.error = ''; state.status = 'running'; state.failedStage = '';
    if (!state.prepared) {
      state.imageUploaded = 0;
      update('准备上传图片', '正在准备安全上传', 'prepare');
      const requestId = createRequestId();
      const prepared = await call('recognizeNutritionLabel', { action: 'prepare', requestId,
        babyUid: state.babyUid, purpose: state.purpose, mode: state.mode, imageCount: state.paths.length,
        expectedVersion: state.expectedVersion, targetId: state.targetId, sourceSystemFoodId: state.sourceSystemFoodId,
        categoryCatalog: state.categoryCatalog.slice(0, 100) });
      if (!isActive()) return;
      state.requestId = requestId; state.prepared = prepared;
    }
    if (!state.fileIDs) {
      update('上传图片', '已上传 ' + state.imageUploaded + '/' + state.paths.length + ' 张', 'upload');
      const fileIDs = await upload(state.paths, state.prepared, isActive, completed => {
        if (!isActive()) return;
        state.imageUploaded = completed;
        update('上传图片', '已上传 ' + completed + '/' + state.paths.length + ' 张', 'upload');
      });
      if (!isActive()) return;
      state.fileIDs = fileIDs; state.imageUploaded = state.paths.length;
    }
    if (!state.result) {
      update('识别图片', '正在读取名称、分类和可见标签', 'recognize');
      const result = await call('recognizeNutritionLabel', { action: 'recognize', requestId: state.requestId,
        sessionId: state.prepared.sessionId, babyUid: state.babyUid, fileIDs: state.fileIDs });
      if (!isActive()) return;
      state.result = result; state.identityCandidates = result.identityCandidates;
      state.previewEstimate = result.previewEstimate || null;
      if (state.purpose === 'preview') {
        state.mode = result.resolvedMode || result.mode;
        if (state.mode === 'powder_label') state.categoryCatalog = state.powderCatalog;
        // 已自动判断出的类型直接采用，看不清时重拍，不再手选类型。
        if (['uncertain', 'unsupported'].includes(state.mode)) {
          state.needType = true;
          stop('type', '请拍清一种食品或完整包装'); return;
        }
      }
      state.identity = { ...(result.identityCandidates[0] || {}) };
      const conflict = state.initialName && searchText(state.initialName) !== searchText(state.identity.name);
      if (!conflict) state.values.name = state.identity.name || '';
      const packageIdentityMissing = ['food_label', 'powder_label'].includes(state.mode) &&
        !(result.observation.packageEvidence || {}).identity;
      state.needIdentity = !!conflict || !state.identity.name || packageIdentityMissing;
      const original = result.originalBasis;
      if (state.mode !== 'powder_label' && !state.manualFields.size) {
        if (!state.values.unit) state.values.unit = original.unit === 'portion' ? '份' : original.unit || 'g';
        if (!(number(state.values.baseQuantity) > 0)) state.values.baseQuantity = String(original.quantity > 0 ? original.quantity : 100);
        if (original.quantity > 0 && !state.initialBasisEdited) {
          state.values.baseQuantity = String(state.purpose === 'preview' && ['g', 'ml'].includes(original.unit) ? 100 : original.quantity);
        }
      }
      if (state.mode === 'powder_label') {
        const formula = result.observation.formula;
        if (isBlank(state.values.ratioPowder) && isBlank(state.values.ratioWater) && formula.powderGrams > 0 && formula.addedWaterMl > 0) {
          state.values.ratioPowder = String(formula.powderGrams); state.values.ratioWater = String(formula.addedWaterMl); state.ratioSource = 'label';
        }
      }
      // 实物名称先进入浮窗，缺少营养时在浮窗内补全，避免整段流程都停在扫描动画。
      if (state.purpose === 'preview' && state.mode === 'food_object') state.previewShown = true;
      update(state.identity.name ? '已识别：' + state.identity.name : '已读取营养表', '', 'recognize');
    }
    if (state.needType) { stop('type', '请拍清一种食品或完整包装'); return; }
    if (state.needIdentity) {
      if (state.purpose === 'preview' && !state.initialName && ['food_label', 'powder_label'].includes(state.mode)) {
        const observation = state.result.observation;
        offerNutrition(state, observation.nutrients, observation.basis, 'label', '包装标签', observation.formula);
      }
      stop('identity', '请确认食物名称'); return;
    }
    applyClassification(state, state.estimate && state.estimate.classification || state.result.classification);
    if (state.mode !== 'powder_label' && !(targetBasis(state).quantity > 0 && ['g', 'ml', 'portion'].includes(targetBasis(state).unit))) {
      stop('basis', '请补充营养基准份量和记录单位'); return;
    }
    const observation = state.result.observation;
    offerNutrition(state, observation.nutrients, observation.basis, 'label', '包装标签', observation.formula);
    const preview = state.purpose === 'preview' && !state.saveFormOpen;
    if (preview && state.mode === 'food_object' && !state.comparisonVersion && state.previewEstimate &&
        getEstimateEligibility(state).eligible && estimateIdentityKey(state.previewEstimate.identity) === estimateIdentityKey(state.identity)) {
      // 首轮有效估算立即展示；它还不是可保存的比较结果。
      offerNutrition(state, state.previewEstimate.nutrients, state.previewEstimate.basis, 'model_estimate', 'AI估算');
      state.previewEstimateApplied = true;
      if (REQUIRED.every(field => number(state.values[field]) !== null)) {
        state.status = 'preview'; update('识别结果', '', 'ready'); return;
      }
      state.previewShown = true;
    }
    if (preview && ['food_label', 'powder_label'].includes(state.mode)) {
      // 标签已足够展示时立即结束预览，参考核对延后到保存步骤。
      if (REQUIRED.every(field => number(state.values[field]) !== null)) {
        state.status = 'preview'; update('识别结果', '', 'ready'); return;
      }
      if (REQUIRED.some(field => number(state.values[field]) !== null)) state.previewShown = true;
    }
    if (!state.comparisonVersion) {
      update('查找营养参考', '正在查询「' + state.values.name + '」的营养资料', 'reference');
      let result;
      state.referenceWarning = '';
      try {
        result = await call('lookupNutritionReference', { action: state.selectedReferenceId ? 'select' : 'search',
          referenceId: state.selectedReferenceId, sessionId: state.result.sessionId, babyUid: state.babyUid,
          identity: state.identity, targetBasis: targetBasis(state) });
      } catch (error) {
        if (!isActive()) return;
        if (state.purpose !== 'preview' || state.saveFormOpen || error.code === 'FORBIDDEN') throw error;
        // 预览保留图片中已有依据的结果；保存时仍须重新取得服务端比较版本。
        state.referenceWarning = '营养参考暂时无法查询，以下先展示图片识别结果。';
        state.status = 'preview'; update('识别结果', state.referenceWarning, 'ready'); return;
      }
      if (!isActive()) return;
      // 查询成功后再替换预览估算，查询失败时保留已显示的有效营养值。
      if (state.previewEstimateApplied) {
        FIELDS.forEach(field => {
          if ((state.proposals[field] || {}).source === 'model_estimate') delete state.proposals[field];
          if ((state.decisions[field] || {}).source === 'model_estimate') {
            state.values[field] = ''; delete state.decisions[field];
          }
        });
        state.previewEstimateApplied = false;
      }
      state.reference = result.selectedReference; state.referenceCandidates = result.referenceCandidates;
      state.comparisonVersion = result.comparisonVersion; state.comparisonStatus = result.comparison.status;
      state.comparison = result.comparison;
      state.estimate = result.estimate || null;
      if (state.comparisonStatus === 'unavailable') state.referenceWarning = '参考资料服务暂时不可用，以下保留图片识别和手填结果。你可以重试参考查询，或对照原始资料补齐后保存。';
      state.selectedReferenceId = '';
    }
    if (state.comparisonStatus === 'ambiguous' && !state.reference && !state.ignoreReference) {
      stop('reference', '找到多个参考条目，请选择对应食物'); return;
    }
    if (state.reference) {
      const source = state.reference.source;
      const provider = providerName(source.provider);
      offerNutrition(state, state.reference.nutrients, state.reference.basis, 'reference', provider + ' · ' + source.version);
      update('已找到营养参考', state.reference.identity.name + ' · ' + provider);
    }
    const eligibility = getEstimateEligibility(state);
    // 状态由图片自动判断；未知状态不猜测，也不再要求用户填写食物状态。
    if (state.allowEstimate && !state.ignoreEstimate && eligibility.requiredInput === 'identity') {
      state.needIdentity = true;
      stop('identity', eligibility.reason); return;
    }
    const autoEstimate = preview && state.mode === 'food_object' && !state.autoEstimateAttempted;
    if (eligibility.eligible && !state.estimate && (autoEstimate || state.allowEstimate && !state.ignoreEstimate)) {
      state.autoEstimateAttempted = true;
      update('补充营养指标', '正在估算「' + state.values.name + '」缺少的营养指标', 'estimate');
      let result;
      try {
        result = await call('recognizeNutritionLabel', { action: 'estimate', requestId: createRequestId(),
          sessionId: state.result.sessionId, babyUid: state.babyUid, comparisonVersion: state.comparisonVersion });
      } catch (error) {
        if (!isActive()) return;
        if (!preview || error.code === 'FORBIDDEN') throw error;
        state.error = '营养暂未识别，可重试估算或手动填写';
        state.status = 'preview'; update('识别结果', '', 'ready'); return;
      }
      if (!isActive()) return;
      if (result.comparisonVersion !== state.comparisonVersion || !result.estimate || result.estimate.source !== 'model_estimate') {
        throw new Error('营养结果已变化，请重新核对');
      }
      state.estimate = result.estimate;
    }
    if (state.estimate) {
      offerNutrition(state, state.estimate.nutrients, state.estimate.basis, 'model_estimate', 'AI估算');
      applyClassification(state, state.estimate.classification);
    }
    if (state.purpose === 'preview' && !state.saveFormOpen) {
      state.status = 'preview'; update('识别结果', state.estimate ? '含AI估算，请核对后使用' : '可以先查看，再决定是否加入资料库', 'ready'); return;
    }
    state.status = 'ready';
    update('结果已准备', state.estimate ? '含AI估算，请核对后使用' :
      eligibility.eligible ? '请核对字段，缺少的内容可手填' : eligibility.reason, 'ready');
  } catch (error) {
    if (!isActive()) return;
    state.retryRecognitionRequired = error.code === 'AI_UNKNOWN';
    state.failedStage = state.stage; state.status = 'failed'; state.error = error.message || '处理失败，请稍后重试';
    // 网络中断或处理中时复用原会话，取回云端缓存；已明确失败或过期才重新准备。
    const terminal = error.code === 'SESSION_EXPIRED' || (error.code && ['model_request', 'session_save'].includes(error.stage));
    if (!state.result && terminal) { state.prepared = null; state.fileIDs = null; }
    update('处理未完成', state.error, 'error');
  }
}

module.exports = { runWorkflow, providerName };
