const { number } = require('./lib/core/contracts');
const { isBlank, formatNutritionValue } = require('../../../utils/nutritionComparison');
const { getIdentityRequirement, targetBasis } = require('./dialogState');

// 证据仍留在识别草稿中，结果浮窗只投影必要读数和来源标记。
function buildPreviewView(state, rows, { busy, labelWarning }) {
  const requirement = state.result ? getIdentityRequirement(state) : {};
  const visualMode = ['food_object', 'uncertain'].includes(state.mode);
  const identityReview = !!state.needIdentity && visualMode && !!requirement.canConfirm;
  const needIdentityPreparation = !!state.needIdentity && visualMode && (state.identityManualRequired || requirement.required);
  const basis = state.result && state.result.originalBasis;
  const hasBasis = state.reference || state.estimate || (basis && basis.quantity > 0) || state.mode === 'food_object';
  const unit = state.mode === 'powder_label' ? '克干粉' : ({ g: '克', ml: '毫升', 份: '份' }[state.values.unit] || '');
  const quantity = state.mode === 'powder_label' ? 100 : number(state.values.baseQuantity);
  const canSwitchBasis = state.mode === 'food_label' && basis && basis.material === 'food' &&
    ['g', 'ml'].includes(basis.unit) && basis.unit === state.values.unit && basis.quantity > 0 &&
    basis.quantity !== 100 && quantity > 0 && !labelWarning && rows.some(row => number(row.value) !== null);
  const previewBasisMode = canSwitchBasis && state.previewBasisMode === 'label' ? 'label' : 'standard';
  const displayQuantity = canSwitchBasis ? previewBasisMode === 'label' ? basis.quantity : 100 : quantity;
  const scale = canSwitchBasis ? displayQuantity / quantity : 1;
  const displayRows = rows.map(row => {
    const pendingBasis = isBlank(row.value) && !isBlank(row.labelValue);
    // 展示值仅保留一位小数，切换份量仍从原始数值换算，避免二次舍入。
    const sourceValue = number(pendingBasis ? state.result.observation.nutrients[row.path].value : row.rawValue ?? row.value);
    const value = sourceValue === null ? null : sourceValue * (pendingBasis ? 1 : scale);
    const hasValue = value !== null;
    return { path: row.path, label: row.path === 'calories' ? '热量' : row.label,
      value: hasValue ? formatNutritionValue(value) :
        row.validationIssue ? '待核对' : identityReview ? '待补充' : busy && ['recognize', 'reference', 'estimate'].includes(state.stage) ? '读取中' : '未识别',
      unit: hasValue ? ({ kcal: '千卡', g: '克', mg: '毫克' }[row.unit] || row.unit) : '',
      hasValue, required: row.required, isEstimate: hasValue && !row.validationIssue && !pendingBasis && row.source === 'model_estimate',
      note: row.retainedValueReview ? '保留原值，请核对包装' : row.validationIssue ? '请对照包装手动填写' : pendingBasis ? '基准待确认' : '' };
  });
  let previewBasis = hasBasis && displayQuantity > 0 && unit ? '每 ' + displayQuantity + ' ' + unit : '基准未识别';
  if (state.mode === 'food_object' && quantity > 0 && state.values.unit === 'g') previewBasis += ' · 可食部分';
  if (labelWarning && rows.every(row => isBlank(row.value))) previewBasis = '标签读数 · 基准待确认';
  if (identityReview) previewBasis = '营养待补充';
  let hint = '';
  if (state.identityDeferred) hint = '营养待补充';
  else if (state.needIdentity) hint = needIdentityPreparation ? '确认具体种类与生熟状态后，再查询营养' : '请确认食物名称';
  else if (state.status === 'basis') hint = '请确认计量基准';
  else if (labelWarning) hint = labelWarning;
  else if (state.referenceWarning) hint = '营养查询失败，请重试';
  const protein = state.proteinOptions[state.values.proteinTypeIndex];
  let previewProteinType = '';
  if (state.mode !== 'powder_label') {
    const quality = protein && protein.value === 'natural' && { premium: '优质蛋白', regular: '普通蛋白' }[protein.quality];
    previewProteinType = quality ? (state.proteinManual ? '' : 'AI建议 · ') + quality :
      protein && protein.value === 'special' ? '特殊蛋白' :
        state.proteinSuggestion && state.proteinSuggestion.special ? '特殊蛋白待确认' : '类型未识别';
  }
  const previewScanning = state.purpose === 'preview' && !state.saveFormOpen && busy && !state.previewShown;
  const frame = state.previewFrame;
  const frameValid = frame && ['left', 'top', 'width', 'height'].every(key => Number.isFinite(frame[key])) &&
    frame.width > 0 && frame.height > 0 && frame.left >= 0 && frame.top >= 0 &&
    frame.left + frame.width <= 100.01 && frame.top + frame.height <= 100.01;
  const scanSize = frameValid && Number.isFinite(frame.scanSize) && frame.scanSize > 0 ? frame.scanSize : 56;
  return {
    previewPhoto: state.paths[previewScanning || state.coverImageIndex < 0 ? 0 : state.coverImageIndex] || state.paths[0] || '',
    previewScanning,
    previewPhotoStyle: previewScanning && frameValid ?
      'left:' + frame.left + '%;top:' + frame.top + '%;width:' + frame.width + '%;height:' + frame.height + '%;border-radius:12px;' : '',
    scanFeedbackStyle: previewScanning && frameValid ?
      'left:' + frame.left + '%;top:' + frame.top + '%;width:' + frame.width + '%;height:' + frame.height + '%;' : '',
    scanOrbitStyle: previewScanning && frameValid ?
      'width:' + Math.min(scanSize, 48) + 'vw;height:' + Math.min(scanSize, 48) + 'vw;' : '',
    scanPhase: { prepare: '准备中', upload: '上传中', recognize: '识别中', reference: '整理营养', estimate: '估算中' }[state.stage] || '识别中',
    previewName: identityReview ? (requirement.coarseCategory || '食物') + ' · 种类待确认' : state.needType ? state.mode === 'unsupported' ? '未识别到食品' : '没看清图片内容' :
      state.values.name || ((state.identityCandidates || [])[0] || {}).name || '名称未识别',
    unrecognizedHint: requirement.reason === 'multiple_products' ? '请重拍，一次只拍一种食品或同一商品的包装' : '请重拍，一次拍清一种食品',
    previewBasis, previewBasisMode,
    previewBasisOptions: canSwitchBasis ? [
      { value: 'standard', label: '每 100 ' + unit },
      { value: 'label', label: '标签每 ' + basis.quantity + ' ' + unit }
    ] : [],
    previewNutritionHint: hint,
    previewCalories: displayRows.find(row => row.path === 'calories'),
    previewProtein: displayRows.find(row => row.path === 'protein'), previewProteinType,
    previewMacros: ['carbs', 'fat'].map(path => displayRows.find(row => row.path === path)).filter(Boolean),
    previewExtras: displayRows.filter(row => ['fiber', 'sodium'].includes(row.path)),
    identityEditorOpen: !!state.identityEditorOpen,
    identityReview, identityDeferred: !!state.identityDeferred, needIdentityPreparation,
    identityCoarseCategory: requirement.coarseCategory || '食物', identityVisibleFeatures: requirement.visibleFeatures || [],
    identityPreparationIndex: Math.max(0, ['', 'raw', 'boiled', 'stir_fried', 'other'].indexOf(state.identityPreparation)),
    identityNote: state.identityNote || '',
    canRetryReference: !!state.referenceWarning
  };
}
function buildDuplicateComparison(state, candidate, rows) {
  const names = { existingName: candidate.name || '已有食物',
    currentName: String(state.values.name || '').trim() || (state.identity || {}).name || '本次食物' };
  const saved = candidate.nutrition;
  if (!saved) return { itemId: candidate.itemId, ...names, unavailable: true };
  const currentBasis = targetBasis(state); const savedBasis = saved.basis || {};
  const unit = value => value === '份' ? 'portion' : value;
  const compatible = ['g', 'ml'].includes(currentBasis.unit) && currentBasis.unit === unit(savedBasis.unit) &&
    currentBasis.material === savedBasis.material && currentBasis.quantity > 0 && savedBasis.quantity > 0 &&
    Number.isFinite(100 / currentBasis.quantity) && Number.isFinite(100 / savedBasis.quantity);
  const basisText = basis => basis.quantity > 0 && basis.unit ?
    '每 ' + basis.quantity + ' ' + ({ g: '克', ml: '毫升', portion: '份', 份: '份' }[basis.unit] || basis.unit) : '基准未记录';
  const sources = { label: '包装标签', reference: '营养参考', manual: '手填', model_estimate: 'AI估算' };
  return { itemId: candidate.itemId, ...names, compatible,
    basis: compatible ? '每 100 ' + (currentBasis.unit === 'g' ? '克' : '毫升') : '',
    existingBasis: basisText(savedBasis), currentBasis: basisText(currentBasis),
    rows: rows.map(row => {
      const oldValue = number((saved.values || {})[row.path]);
      const newValue = row.validationIssue ? null : number(row.rawValue ?? row.value);
      const previous = oldValue === null ? null : number(oldValue * (compatible ? 100 / savedBasis.quantity : 1));
      const current = newValue === null ? null : number(newValue * (compatible ? 100 / currentBasis.quantity : 1));
      const previousText = previous === null ? '—' : formatNutritionValue(previous); const currentText = current === null ? '—' : formatNutritionValue(current);
      return { path: row.path, label: row.label, unit: row.unit,
        previous: previousText, current: currentText,
        previousIsEstimate: previous !== null && (saved.fieldSources || {})[row.path] === 'model_estimate',
        currentIsEstimate: current !== null && row.source === 'model_estimate',
        previousSource: previous === null ? '未记录' : sources[(saved.fieldSources || {})[row.path]] || '',
        currentSource: current === null ? row.validationIssue ? '待核对' : '未识别' : sources[row.source] || '',
        changed: compatible && previous !== null && current !== null && previousText !== currentText };
    }) };
}
module.exports = { buildPreviewView, buildDuplicateComparison };
