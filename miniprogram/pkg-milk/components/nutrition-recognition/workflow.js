const { estimateEligibility, number, searchText } = require('./lib/core/index.js');
const { isBlank } = require('../../../utils/nutritionComparison');
const { createRequestId } = require('../../../utils/nutritionRecognition');
const { targetBasis, offerNutrition, applyClassification } = require('./dialogState');
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
      if (state.purpose === 'preview') {
        state.mode = result.resolvedMode || result.mode;
        if (state.mode === 'powder_label') state.categoryCatalog = state.powderCatalog;
        if (['uncertain', 'unsupported'].includes(state.mode)) { state.needType = true; stop('type', '请确认物品类型或补拍后重新识别'); return; }
      }
      state.identity = { ...result.identityCandidates[0] };
      const conflict = state.initialName && searchText(state.initialName) !== searchText(state.identity.name);
      if (!conflict) state.values.name = state.identity.name;
      state.needIdentity = !!conflict;
      const original = result.originalBasis;
      if (state.mode !== 'powder_label' && !state.manualFields.size) {
        if (!state.values.unit) state.values.unit = original.unit === 'portion' ? '份' : original.unit || 'g';
        if (!(number(state.values.baseQuantity) > 0)) state.values.baseQuantity = String(original.quantity > 0 ? original.quantity : 100);
        if (original.quantity > 0 && !state.initialBasisEdited) state.values.baseQuantity = String(original.quantity);
      }
      if (state.mode === 'powder_label') {
        const formula = result.observation.formula;
        if (isBlank(state.values.ratioPowder) && isBlank(state.values.ratioWater) && formula.powderGrams > 0 && formula.addedWaterMl > 0) {
          state.values.ratioPowder = String(formula.powderGrams); state.values.ratioWater = String(formula.addedWaterMl); state.ratioSource = 'label';
        }
      }
      update('已识别：' + state.identity.name, '', 'recognize');
    }
    if (state.needType) { stop('type', '请确认物品类型或补拍后重新识别'); return; }
    if (state.needIdentity) { stop('identity', '识别名称与原名称不同，请确认本次要使用的名称'); return; }
    // 身份或基准重新核对后，旧生熟确认不再有效；下方按当前资格重新判断。
    state.needPreparation = false;
    applyClassification(state, state.estimate && state.estimate.classification || state.result.classification);
    if (state.mode !== 'powder_label' && !(targetBasis(state).quantity > 0 && ['g', 'ml', 'portion'].includes(targetBasis(state).unit))) {
      stop('basis', '请补充营养基准份量和记录单位'); return;
    }
    const observation = state.result.observation;
    offerNutrition(state, observation.nutrients, observation.basis, 'label', '包装标签', observation.formula);
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
      state.reference = result.selectedReference; state.referenceCandidates = result.referenceCandidates;
      state.comparisonVersion = result.comparisonVersion; state.comparisonStatus = result.comparison.status;
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
    if (state.purpose === 'preview' && !state.saveFormOpen) {
      state.status = 'preview'; update('识别结果', '可以先查看，再决定是否加入资料库', 'ready'); return;
    }
    const eligibility = estimateEligibility({ mode: state.mode, identity: state.identity, observation,
      reference: state.reference, basis: targetBasis(state) });
    const generic = ['青菜', '绿叶菜', '蔬菜', '水果', '肉', '食物', 'vegetable', 'greens', 'food'].includes(searchText(state.identity.name));
    if (state.mode !== 'powder_label' && !state.reference && generic && !state.ignoreEstimate) {
      state.needIdentity = true; stop('identity', '请确认具体食材名称后继续'); return;
    }
    if (state.mode !== 'powder_label' && !['raw', 'boiled', 'stir_fried'].includes(state.identity.preparation) &&
        eligibility.reason.includes('生鲜') && !state.ignoreEstimate) {
      state.needPreparation = true; stop('preparation', '请确认生鲜、水煮或炒制后继续'); return;
    }
    const selectedProtein = state.proteinOptions[state.values.proteinTypeIndex];
    const specialProtein = state.mode !== 'powder_label' && ((selectedProtein && selectedProtein.value === 'special') ||
      (!selectedProtein && state.proteinSuggestion && state.proteinSuggestion.special));
    if (eligibility.eligible && !specialProtein && !state.estimate && state.allowEstimate && !state.ignoreEstimate) {
      update('补充营养指标', '正在估算「' + state.values.name + '」缺少的营养指标', 'estimate');
      const result = await call('recognizeNutritionLabel', { action: 'estimate', requestId: createRequestId(),
        sessionId: state.result.sessionId, babyUid: state.babyUid, comparisonVersion: state.comparisonVersion });
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
    state.status = 'ready';
    update('结果已准备', specialProtein ? '特殊蛋白需核对标签或产品资料，缺少的指标可手填' :
      state.estimate ? '含AI估算，请核对后使用' : '请核对字段，缺少的内容可手填', 'ready');
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
