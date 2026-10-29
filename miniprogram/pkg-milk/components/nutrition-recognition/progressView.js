const { isBlank } = require('../../../utils/nutritionComparison');
const FORM_LABELS = { calories: '热量', protein: '蛋白', fat: '脂肪', carbs: '碳水', fiber: '膳食纤维', sodium: '钠' };

function buildProgressView(state, busy, rows) {
  const stage = state.stage === 'error' ? state.failedStage : state.stage;
  const failed = state.status === 'failed';
  const hasIdentity = !!state.result;
  const identityReview = state.needIdentity || state.identityDeferred || state.status === 'identity';
  const identityVisible = hasIdentity;
  const nutritionVisible = hasIdentity && !state.needIdentity;
  const uploaded = state.imageUploaded || 0;
  const imageDone = !!state.fileIDs || uploaded === state.paths.length;
  const uploadLoading = busy && !imageDone && ['prepare', 'upload'].includes(stage);
  const identityLoading = busy && !hasIdentity && stage === 'recognize';
  const nutritionLoading = busy && !state.saving && ['reference', 'estimate'].includes(stage);
  const missingRequiredNutrition = rows.some(row => row.required && isBlank(row.value));
  const uploadStatus = failed && ['prepare', 'upload'].includes(stage) ? 'error' : imageDone ? 'done' : uploadLoading ? 'loading' : 'waiting';
  const identityStatus = failed && stage === 'recognize' ? 'error' : identityReview ? 'review' :
    hasIdentity ? 'done' : identityLoading ? 'loading' : 'waiting';
  const nutritionStatus = failed && ['reference', 'estimate'].includes(stage) ? 'error' :
    ['ready', 'preview'].includes(state.status) && !identityReview ? state.referenceWarning || missingRequiredNutrition ? 'review' : 'done' :
      ['reference', 'basis'].includes(state.status) ? 'review' : nutritionLoading ? 'loading' : 'waiting';
  const nutrientRows = rows.map(row => ({ ...row, formLabel: FORM_LABELS[row.path],
    loading: nutritionLoading && row.required && isBlank(row.value) && !state.manualFields.has(row.path) }));
  return { imagePaths: state.paths, uploadedCount: uploaded, imageCount: state.paths.length,
    uploadLoading, uploadStatus, identityLoading, identityStatus, identityVisible,
    nutritionVisible, nutritionLoading, nutritionStatus,
    uploadText: uploadStatus === 'error' ? stage === 'prepare' ? '图片尚未上传，识别服务未就绪' : '图片上传失败，请重试' : imageDone ? '图片已上传' : uploadLoading ?
      state.stage === 'prepare' ? '正在准备上传…' : '正在上传图片…' : '等待上传',
    identityText: identityStatus === 'error' ? '识别未完成，请重试' : identityLoading ? '正在识别名称、分类与标签…' :
      state.identityDeferred ? '具体种类待补充，仅暂留本次页面' : state.needIdentity ? state.identityManualRequired ? '请确认具体种类与生熟状态' : '请确认名称' : hasIdentity ? '已识别' :
        state.mode === 'powder_label' ? '等待识别标签' : '等待识别食物',
    nutritionText: state.identityDeferred ? '营养待补充' : rows.some(row => row.validationIssue) ? '包装读数有冲突，请对照包装手动核对' : nutritionStatus === 'error' ? stage === 'reference' ? '营养参考查询未完成，请重试' : '营养估算未完成，可重试或手填' : nutritionLoading ?
      stage === 'reference' ? '正在查找营养参考…' : '正在估算缺少的营养指标…' : state.referenceWarning ? '参考核对待完成' : state.status === 'reference' ? '选择营养参考后继续' :
      state.status === 'basis' ? '请填写记录单位和营养基准份量' : missingRequiredNutrition && ['ready', 'preview'].includes(state.status) ? '营养信息待补充' : nutritionStatus === 'done' ? '识别已完成' : '等待识别营养',
    categoryCreating: busy && state.stage === 'category',
    nutrientRows, requiredNutrientRows: nutrientRows.filter(row => row.required),
    optionalNutrientRows: nutrientRows.filter(row => !row.required) };
}

module.exports = { buildProgressView };
