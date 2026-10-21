const { number } = require('./lib/core/contracts');
const { isBlank } = require('../../../utils/nutritionComparison');

// 证据仍留在识别草稿中，结果浮窗只投影必要读数和来源标记。
function buildPreviewView(state, rows, { busy, labelWarning }) {
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
    const sourceValue = number(pendingBasis ? row.labelValue : row.value);
    const value = sourceValue === null ? null : sourceValue * (pendingBasis ? 1 : scale);
    const hasValue = value !== null;
    return { path: row.path, label: row.path === 'calories' ? '热量' : row.label,
      value: hasValue ? String(value > 0 && value < 0.01 ? value : Math.round(value * 100) / 100) :
        busy && ['recognize', 'reference', 'estimate'].includes(state.stage) ? '读取中' : '未识别',
      unit: hasValue ? ({ kcal: '千卡', g: '克', mg: '毫克' }[row.unit] || row.unit) : '',
      hasValue, required: row.required, note: pendingBasis ? '基准待确认' : row.source === 'model_estimate' ? 'AI估算' : '' };
  });
  let previewBasis = hasBasis && displayQuantity > 0 && unit ? '每 ' + displayQuantity + ' ' + unit : '基准未识别';
  if (state.mode === 'food_object' && quantity > 0 && state.values.unit === 'g') previewBasis += ' · 可食部分';
  if (labelWarning && rows.every(row => isBlank(row.value))) previewBasis = '标签读数 · 基准待确认';
  const labelMode = !state.needType && ['food_label', 'powder_label'].includes(state.mode);
  const packageEvidence = state.result && state.result.observation.packageEvidence || {};
  const needsProductPhoto = labelMode && !!state.result && !packageEvidence.identity && !state.packageIdentityConfirmed;
  const missingLabelBasis = rows.some(row => isBlank(row.value) && !isBlank(row.labelValue)) &&
    !(basis && basis.quantity > 0 && basis.unit);
  const needsNutritionPhoto = labelMode && !!state.result &&
    (displayRows.some(row => row.required && !row.hasValue) || missingLabelBasis);
  const packagePhotoNeeded = needsProductPhoto || needsNutritionPhoto;
  const previewEmptyNutrition = displayRows.every(row => !row.hasValue);
  const packagePhotoTitle = needsProductPhoto ?
    needsNutritionPhoto ? '名称与营养未识别' : '商品名称未识别' : '部分营养未识别';
  const packagePhotoHint = state.paths.length > 1 ? '可重新拍清对应图片，或手动填写' : '可返回选择双面拍，或手动填写';
  let hint = '';
  if (state.needIdentity) hint = '请确认食物名称';
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
    previewName: state.needType ? state.mode === 'unsupported' ? '未识别到食品' : '没看清图片内容' :
      state.values.name || ((state.identityCandidates || [])[0] || {}).name || '名称未识别',
    unrecognizedHint: '请重拍，一次拍清一种食品',
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
    needsProductPhoto, needsNutritionPhoto, packagePhotoNeeded, previewEmptyNutrition,
    packagePhotoTitle, packagePhotoHint, identityEditorOpen: !!state.identityEditorOpen,
    canRetryReference: !!state.referenceWarning
  };
}
module.exports = { buildPreviewView };
