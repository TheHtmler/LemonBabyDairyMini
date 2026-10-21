const { FIELDS, UNITS, REQUIRED, number, convertBasis, searchText, normalizeCategoryCatalog,
  normalizeClassification, classificationIdentityKey, matchCategory, recommendCategories, estimateEligibility } = require('./lib/core/index.js');
const { FIELD_NAMES, isBlank } = require('../../../utils/nutritionComparison');
const SOURCE_NAMES = { label: '包装标签', reference: '营养参考', model_estimate: 'AI估算', manual: '手填' };
const FORM_FIELDS = ['name', 'category', 'categoryLevel2', 'unit', 'baseQuantity', 'proteinTypeIndex', 'image'];

function formKey(draft = {}, mode) {
  const nutrition = mode === 'powder_label' ? draft.nutritionPer100g || {} : draft;
  return JSON.stringify(FORM_FIELDS.map(field => draft[field] ?? '').concat(FIELDS.map(field => nutrition[field] ?? ''),
    [(draft.mixRatio || {}).powder ?? '', (draft.mixRatio || {}).water ?? '']));
}

function createDialogState(properties, paths) {
  const draft = properties.draft || {};
  const mode = ['powder_label', 'food_object', 'auto'].includes(properties.mode) ? properties.mode : 'food_label';
  const nutrition = mode === 'powder_label' ? draft.nutritionPer100g || {} : draft;
  const values = { name: draft.name || '', category: draft.category || '', categoryLevel2: draft.categoryLevel2 || '',
    unit: draft.unit || '', baseQuantity: draft.baseQuantity == null ? '100' : String(draft.baseQuantity),
    proteinTypeIndex: Number.isInteger(Number(draft.proteinTypeIndex)) && Number(draft.proteinTypeIndex) >= 0 ? Number(draft.proteinTypeIndex) : -1,
    ratioPowder: String((draft.mixRatio || {}).powder ?? ''), ratioWater: String((draft.mixRatio || {}).water ?? '') };
  const decisions = {}; const manualFields = new Set();
  FIELDS.forEach(field => {
    values[field] = isBlank(nutrition[field]) ? '' : String(nutrition[field]);
    if (!isBlank(values[field])) { decisions[field] = { path: field, source: 'manual' }; manualFields.add(field); }
  });
  return { mode, requestedMode: mode, recognitionKind: properties.recognitionKind || '',
    purpose: properties.purpose || 'form', powderCatalog: normalizeCategoryCatalog(properties.powderCategoryOptions || []),
    allowEstimate: false, ignoreEstimate: true, saveFormOpen: false, previewShown: false, previewBasisMode: 'standard',
    dirty: false, babyUid: properties.babyUid, expectedVersion: properties.expectedVersion,
    targetId: properties.targetId, sourceSystemFoodId: properties.sourceSystemFoodId,
    initialName: values.name, initialFormKey: formKey(draft, mode),
    initialBasisEdited: mode !== 'powder_label' && (!!draft.unit || (!isBlank(draft.baseQuantity) && number(draft.baseQuantity) !== 100)),
    paths, values, decisions, manualFields,
    categoryCatalog: normalizeCategoryCatalog(properties.categoryOptions), proteinOptions: properties.proteinOptions || [],
    categoryManual: !!values.category, proteinManual: values.proteinTypeIndex >= 0,
    categorySuggestion: null, proteinSuggestion: null, extraCategories: [], categoryRejected: false,
    editedFields: new Set(), proposals: {}, referenceCandidates: [], identityCandidates: [],
    identity: null, comparisonVersion: 0, ratioSource: 'manual', status: 'starting', stage: 'prepare', imageUploaded: 0, error: '',
    needIdentity: false, packageIdentityConfirmed: false, identityEditorOpen: false,
    ignoreReference: false };
}

function targetBasis(state) {
  return state.mode === 'powder_label' ? { quantity: 100, unit: 'g', material: 'dry_powder' } :
    { quantity: number(state.values.baseQuantity), unit: state.values.unit === '份' ? 'portion' : state.values.unit, material: 'food' };
}

function getEstimateEligibility(state, identity = state.identity) {
  const selectedProtein = state.proteinOptions[state.values.proteinTypeIndex];
  const specialProtein = state.mode !== 'powder_label' && ((selectedProtein && selectedProtein.value === 'special') ||
    (!selectedProtein && state.proteinSuggestion && state.proteinSuggestion.special));
  if (specialProtein) return { eligible: false, fields: [], requiredInput: '',
    reason: '特殊蛋白需核对标签或产品资料，缺少的指标可手填。' };
  return estimateEligibility({ mode: state.mode, identity, observation: state.result && state.result.observation,
    reference: state.reference, basis: targetBasis(state) });
}

function offerNutrition(state, nutrients, basis, source, sourceText, formula) {
  const converted = convertBasis(nutrients, basis, targetBasis(state), formula);
  if (!converted) return;
  FIELDS.forEach(field => {
    if (field === 'sodium' && state.mode === 'powder_label') return;
    const entry = converted[field];
    if (!entry || entry.state !== 'present' || number(entry.value) === null || state.proposals[field]) return;
    state.proposals[field] = { value: entry.value, source, sourceText: sourceText || SOURCE_NAMES[source] };
    if (!state.manualFields.has(field)) {
      state.values[field] = String(Math.round(entry.value * 1000000) / 1000000);
      state.decisions[field] = { path: field, source };
    }
  });
}

function clearProposals(state) {
  FIELDS.forEach(field => {
    if (state.decisions[field] && state.decisions[field].source !== 'manual') {
      state.values[field] = ''; delete state.decisions[field];
    }
  });
  state.proposals = {}; state.reference = null; state.estimate = null; state.comparisonVersion = 0;
  state.previewEstimate = null; state.previewEstimateApplied = false;
  state.comparison = null; state.comparisonStatus = ''; state.referenceWarning = ''; state.duplicateReview = null; state.duplicateDecision = null;
  state.binding = null;
  state.ignoreReference = false; state.error = '';
  state.categorySuggestion = null; state.proteinSuggestion = null;
  state.newCategoryName = undefined;
  if (!state.categoryManual) state.values.category = '';
  if (!state.proteinManual) state.values.proteinTypeIndex = -1;
}

function applyClassification(state, suggestion) {
  if (state.mode === 'powder_label' || !suggestion || !suggestion.identity ||
      classificationIdentityKey(suggestion.identity) !== classificationIdentityKey(state.identity)) return;
  const catalog = state.categoryCatalog.concat(state.extraCategories);
  const classification = normalizeClassification(suggestion, state.identity, catalog);
  if (!classification) return;
  const candidates = recommendCategories(classification.category, state.identity, catalog);
  const category = candidates.length && (candidates.length === 1 || candidates[0].score > candidates[1].score) ? candidates[0] : null;
  state.categorySuggestion = classification.category || candidates.length ?
    { name: classification.category, matched: category, candidates } : null;
  if (!state.categoryManual) state.values.category = category ? category.value : '';
  const index = state.proteinOptions.findIndex(option => option.value === classification.proteinSource && option.quality === classification.proteinQuality);
  state.proteinSuggestion = index >= 0 ? { index, label: state.proteinOptions[index].label,
    special: classification.proteinSource === 'special', source: classification.proteinQualitySource } : null;
  if (!state.proteinManual) state.values.proteinTypeIndex = index >= 0 && !state.proteinSuggestion.special ? index : -1;
}

function editNutrition(state, field, value) {
  state.values[field] = value;
  state.editedFields.add(field);
  state.manualFields.add(field);
  if (isBlank(value)) delete state.decisions[field];
  else state.decisions[field] = { path: field, source: 'manual' };
}

function buildRows(state) {
  const observation = state.result && state.result.observation;
  return FIELDS.filter(field => field !== 'sodium' || state.mode !== 'powder_label').map(field => {
    const decision = state.decisions[field]; const proposal = state.proposals[field];
    const source = decision && decision.source;
    const sourceText = source === 'manual' ? state.editedFields.has(field) ? '手填' : '保留原值' :
      proposal && proposal.sourceText || SOURCE_NAMES[source] || '';
    const observed = observation && observation.nutrients[field];
    const labelValue = ['food_label', 'powder_label'].includes(state.mode) && observed &&
      observed.state === 'present' && number(observed.value) !== null && !state.manualFields.has(field) ?
      String(Math.round(observed.value * 1000000) / 1000000) : '';
    return { path: field, label: FIELD_NAMES[field], unit: UNITS[field], value: state.values[field],
      required: REQUIRED.includes(field), source: source || '', sourceText, labelValue,
      hasSuggestion: !!proposal && source === 'manual', suggestion: proposal ? String(Math.round(proposal.value * 1000000) / 1000000) : '',
      suggestionSource: proposal && proposal.sourceText || '' };
  });
}

function labelFillWarning(state, rows) {
  if (state.needType || state.needIdentity || !rows.some(row => isBlank(row.value) && row.labelValue !== '')) return '';
  const observation = state.result && state.result.observation;
  if (!observation || convertBasis(observation.nutrients, observation.basis, targetBasis(state), observation.formula)) return '';
  const basis = observation.basis;
  if (!(basis.quantity > 0) || !basis.unit) {
    return '计量基准未识别，请核对表头';
  }
  if (state.mode === 'powder_label') {
    return '干粉营养表未识别';
  }
  const unit = { g: '克', ml: '毫升', portion: '份' }[basis.unit] || basis.unit;
  return '请将填写单位改为' + unit;
}

function validateDialog(state, options) {
  const missing = [];
  if (!String(state.values.name || '').trim()) missing.push('名称');
  if (!String(state.values.category || '').trim()) missing.push('分类');
  else if (!matchCategory(state.values.category, state.categoryCatalog.concat(state.extraCategories))) missing.push('选择或创建本地分类');
  REQUIRED.forEach(field => { if (number(state.values[field]) === null) missing.push(FIELD_NAMES[field]); });
  ['fiber', 'sodium'].forEach(field => {
    if (field === 'sodium' && state.mode === 'powder_label') return;
    if (!isBlank(state.values[field]) && number(state.values[field]) === null) missing.push(FIELD_NAMES[field] + '格式');
  });
  if (state.mode === 'powder_label') {
    if (!(number(state.values.ratioPowder) > 0)) missing.push('粉量');
    if (!(number(state.values.ratioWater) > 0)) missing.push('水量');
  } else {
    const basis = targetBasis(state);
    if (!(basis.quantity > 0) || !['g', 'ml', 'portion'].includes(basis.unit)) missing.push('计量基准');
    if (state.values.proteinTypeIndex < 0 || !options.proteinOptions[state.values.proteinTypeIndex]) missing.push('蛋白来源');
  }
  if (!state.result || !(state.comparisonVersion > 0) || state.needIdentity ||
      searchText(state.values.name) !== searchText(state.identity && state.identity.name)) missing.push('完成名称和营养核对');
  return missing;
}

function resultPatch(state) {
  const patch = { name: String(state.values.name).trim(), category: state.values.category };
  FIELDS.forEach(field => { if (field !== 'sodium' || state.mode !== 'powder_label') patch[field] = state.values[field]; });
  if (state.mode === 'powder_label') patch.mixRatio = { powder: state.values.ratioPowder, water: state.values.ratioWater };
  else Object.assign(patch, { unit: state.values.unit, baseQuantity: state.values.baseQuantity,
    categoryLevel2: state.values.categoryLevel2, proteinTypeIndex: state.values.proteinTypeIndex });
  return patch;
}

module.exports = { createDialogState, formKey, targetBasis, offerNutrition, clearProposals, editNutrition,
  buildRows, validateDialog, resultPatch, applyClassification, getEstimateEligibility, labelFillWarning };
