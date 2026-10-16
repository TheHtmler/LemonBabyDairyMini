const { isBlank } = require('../../../utils/nutritionComparison');
const FORM_LABELS = { calories: '热量', protein: '蛋白', fat: '脂肪', carbs: '碳水', fiber: '膳食纤维', sodium: '钠' };

function buildProgressView(state, busy, rows) {
  const stage = state.stage === 'error' ? state.failedStage : state.stage;
  const failed = state.status === 'failed';
  const hasIdentity = !!state.result;
  const identityReview = state.needIdentity || state.needPreparation || ['identity', 'preparation'].includes(state.status);
  const identityVisible = hasIdentity;
  const nutritionVisible = hasIdentity && !state.needIdentity;
  const uploaded = state.imageUploaded || 0;
  const imageDone = !!state.fileIDs || uploaded === state.paths.length;
  const uploadLoading = busy && !imageDone && ['prepare', 'upload'].includes(stage);
  const identityLoading = busy && !hasIdentity && stage === 'recognize';
  const nutritionLoading = busy && ['reference', 'estimate'].includes(stage);
  const uploadStatus = failed && ['prepare', 'upload'].includes(stage) ? 'error' : imageDone ? 'done' : uploadLoading ? 'loading' : 'waiting';
  const identityStatus = failed && stage === 'recognize' ? 'error' : identityReview ? 'review' :
    hasIdentity ? 'done' : identityLoading ? 'loading' : 'waiting';
  const nutritionStatus = failed && ['reference', 'estimate'].includes(stage) ? 'error' :
    state.status === 'ready' && !identityReview && state.comparisonVersion > 0 ? 'done' :
      ['reference', 'basis', 'preparation'].includes(state.status) || hasIdentity && !identityReview && !state.comparisonVersion && !busy ? 'review' : nutritionLoading ? 'loading' : 'waiting';
  const statusText = { waiting: '等待中', loading: '处理中', done: '已完成', review: '待确认', error: '未完成' };
  const steps = [
    { key: 'upload', label: '上传图片', status: uploadStatus },
    { key: 'identity', label: state.mode === 'powder_label' ? '识别标签' : '识别食物', status: identityStatus },
    { key: 'nutrition', label: '识别营养', status: nutritionStatus }
  ].map((item, index) => ({ ...item, number: index + 1, text: statusText[item.status] }));
  const nutrientRows = rows.map(row => ({ ...row, formLabel: FORM_LABELS[row.path],
    loading: nutritionLoading && isBlank(row.value) && !state.manualFields.has(row.path) }));
  return { steps, imagePaths: state.paths, uploadedCount: uploaded, imageCount: state.paths.length,
    uploadLoading, uploadStatus, identityLoading, identityStatus, identityVisible,
    nutritionVisible, nutritionLoading, nutritionStatus,
    uploadText: uploadStatus === 'error' ? stage === 'prepare' ? '图片尚未上传，识别服务未就绪' : '图片上传失败，请重试' : imageDone ? '图片已上传' : uploadLoading ?
      state.stage === 'prepare' ? '正在准备上传…' : '正在上传图片…' : '等待上传',
    identityText: identityStatus === 'error' ? '识别未完成，请重试' : identityLoading ? '正在识别名称、分类与标签…' :
      state.needIdentity ? '请确认名称' : state.needPreparation ? '请选择食物状态后继续' : hasIdentity ? '已识别' :
        state.mode === 'powder_label' ? '等待识别标签' : '等待识别食物',
    nutritionText: nutritionStatus === 'error' ? stage === 'reference' ? '营养参考查询未完成，请重试' : '营养估算未完成，可重试或手填' : nutritionLoading ?
      stage === 'reference' ? '正在查找营养参考…' : '正在估算缺少的营养指标…' : state.status === 'reference' ? '选择营养参考后继续' :
      state.status === 'basis' ? '请填写记录单位和营养基准份量' : nutritionStatus === 'done' ? '识别已完成' : '等待识别营养',
    categoryCreating: busy && state.stage === 'category',
    nutrientRows, requiredNutrientRows: nutrientRows.filter(row => row.required),
    optionalNutrientRows: nutrientRows.filter(row => !row.required) };
}

module.exports = { buildProgressView };
