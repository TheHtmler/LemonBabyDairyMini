const { buildFormulaPowderComponent } = require('./feedingRecordV2Utils');

const AMINO_ACIDS = [
  { key: 'valine', label: '缬氨酸', mmaPa: true },
  { key: 'isoleucine', label: '异亮氨酸', mmaPa: true },
  { key: 'methionine', label: '蛋氨酸', mmaPa: true },
  { key: 'threonine', label: '苏氨酸', mmaPa: true },
  { key: 'leucine', label: '亮氨酸' },
  { key: 'lysine', label: '赖氨酸' },
  { key: 'phenylalanine', label: '苯丙氨酸' },
  { key: 'tryptophan', label: '色氨酸' },
  { key: 'histidine', label: '组氨酸' }
];
const DAILY_AMINO_ACIDS = AMINO_ACIDS.filter(({ key, mmaPa }) => mmaPa || key === 'leucine');
let systemReferencesByCode;

function array(value) {
  return Array.isArray(value) ? value : [];
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nonnegative(value) {
  if (typeof value === 'string') {
    const input = value.trim();
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(input)) return null;
    value = Number(input);
  }
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeUnit(value) {
  const unit = trimmed(value);
  if (unit.toLowerCase() === 'g' || unit === '克') return 'g';
  if (unit.toLowerCase() === 'ml' || unit === '毫升') return 'ml';
  return unit;
}

function recordTimestamp(value) {
  const time = value?.$date ?? value;
  if (Number.isFinite(time)) return time;
  if (time instanceof Date) return Number.isFinite(time.getTime()) ? time.getTime() : null;
  const input = trimmed(time);
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(input)) return null;
  const parsed = Date.parse(input.replace(' ', 'T'));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSource(input) {
  const name = trimmed(input?.name);
  return name ? {
    name,
    version: trimmed(input.version),
    recordId: trimmed(input.recordId),
    url: trimmed(input.url)
  } : null;
}

function normalizeProfile(input) {
  const basis = normalizeUnit(input?.basis);
  const source = normalizeSource(input?.source);
  if (!['g', 'ml'].includes(basis) || !source) return null;

  const values = {};
  AMINO_ACIDS.forEach(({ key }) => {
    const value = nonnegative(input.values?.[key]);
    if (value !== null) values[key] = value;
  });
  if (!Object.keys(values).length) return null;

  const powderGramsPer100ml = nonnegative(input.powderGramsPer100ml);
  const estimateSource = input.estimated !== true && normalizeSource(input.estimateSource);
  const confirmedFoodPreparation = basis === 'g' && ['raw', 'cooked'].includes(input.confirmedFoodPreparation)
    ? input.confirmedFoodPreparation : '';
  return {
    basis,
    values,
    ...(input.estimated === true ? { estimated: true } : {}),
    ...(estimateSource ? {
      estimateSource,
      estimatedKeys: Object.keys(values).filter(key => array(input.estimatedKeys).includes(key))
    } : {}),
    ...(basis === 'ml' && powderGramsPer100ml > 0 ? { powderGramsPer100ml } : {}),
    ...(confirmedFoodPreparation ? { confirmedFoodPreparation } : {}),
    source
  };
}

function getManualAminoAcidError(values, { allowEmpty = false } = {}) {
  let hasValue = false;
  for (const { key, label } of AMINO_ACIDS) {
    const value = values?.[key];
    const empty = value == null || (typeof value === 'string' && !value.trim());
    if (empty) continue;
    if (nonnegative(value) === null) return `请填写有效的${label}含量。`;
    hasValue = true;
  }
  return hasValue || allowEmpty ? '' : '请至少填写一项已知的氨基酸含量。';
}

function applyAminoReference(candidate, values, previousEstimates, {
  basis, allowPreparationConfirmation = false, savedPreparation = ''
}) {
  const canApply = candidate?.canApply === true;
  const confirmedFoodPreparation = canApply ? savedPreparation
    : allowPreparationConfirmation && ['raw', 'cooked'].includes(candidate?.preparationToConfirm)
      ? candidate.preparationToConfirm : '';
  if (!canApply && !confirmedFoodPreparation) throw new Error(candidate?.matchReason || '这条参考未通过高匹配校验。');
  const profile = normalizeProfile({ ...candidate.profile, confirmedFoodPreparation });
  if (!profile?.estimated || !profile.source.recordId) throw new Error('这条参考资料无法应用，请重新搜索。');
  if (profile.basis !== basis) throw new Error('公开资料按克计量，当前食物按毫升计量。可按当前单位手填。');

  const error = getManualAminoAcidError(values, { allowEmpty: true });
  if (error) throw new Error(error);
  const manualValues = {};
  for (const { key } of AMINO_ACIDS) {
    const value = nonnegative(values?.[key]);
    if (value !== null && value !== previousEstimates?.[key]) manualValues[key] = value;
  }
  // 手填项目优先。更换参考时整份替换旧参考，避免混用不同样品。
  const estimatedKeys = Object.keys(profile.values).filter(key => manualValues[key] === undefined);
  if (!estimatedKeys.length) return null;
  if (!Object.keys(manualValues).length) return profile;
  return {
    basis,
    values: { ...profile.values, ...manualValues },
    source: { name: '手动填写' },
    estimateSource: profile.source,
    estimatedKeys,
    ...(profile.confirmedFoodPreparation ? { confirmedFoodPreparation: profile.confirmedFoodPreparation } : {})
  };
}

function nutritionSignature(nutrition) {
  return ['calories', 'protein', 'fat', 'carbs', 'fiber', 'sodium']
    .map(field => nonnegative(nutrition?.[field]));
}

function foodBasis(food) {
  const basis = food.nutritionBasis || food.servingBasis || {};
  return [
    nonnegative(basis.quantity ?? food.baseQuantity) || 100,
    normalizeUnit(basis.unit || food.baseUnit) || (food.isLiquid ? 'ml' : 'g')
  ];
}

function foodIdentity(food, name) {
  const recognition = food.recognitionMeta;
  return [
    name,
    trimmed(recognition?.confirmedIdentity?.preparation),
    trimmed(recognition?.finalBasis?.material),
    ...foodBasis(food),
    ...nutritionSignature(food.nutritionPerBasis || food.nutritionPer100g || food.nutritionPerUnit)
  ];
}

function foodEntry({ id, name, snapshot, quantity = null, unit, at = null, date = '' }) {
  const foodCode = trimmed(snapshot.sourceFoodCode || snapshot.origin?.foodCode || snapshot.foodCode);
  const preparation = trimmed(snapshot.recognitionMeta?.confirmedIdentity?.preparation);
  const [basisQuantity, basisUnit] = foodBasis(snapshot);
  const isSystemFood = snapshot.sourceType === 'system';
  const isSystemCopy = snapshot.sourceType === 'user_override' && !!snapshot.sourceSystemFoodId;
  const declaredBasis = snapshot.nutritionBasis || snapshot.servingBasis;
  const declaredUnit = normalizeUnit(declaredBasis?.unit || snapshot.baseUnit);
  const declaredQuantity = nonnegative(declaredBasis?.quantity ?? snapshot.baseQuantity);
  const nutrition = snapshot.nutritionPerBasis || snapshot.nutritionPer100g || snapshot.nutritionPerUnit;
  const composition = {};
  if (declaredQuantity > 0 && declaredUnit === 'g') {
    const amounts = { protein: nutrition?.protein, fat: nutrition?.fat, water: snapshot.nutritionExtra?.water };
    for (const [field, value] of Object.entries(amounts)) {
      const amount = nonnegative(value);
      if (amount !== null) composition[field] = amount / declaredQuantity * 100;
    }
  }
  return {
    key: id && name ? JSON.stringify(['food', id, ...foodIdentity(snapshot, name)]) : '',
    kind: 'food',
    catalogId: id,
    name: name || '名称缺失的辅食',
    foodCode,
    sourceType: snapshot.sourceType || '',
    isSystemFood,
    searchTarget: { name, preparation, basis: unit, composition },
    ...(foodCode && (isSystemFood || isSystemCopy) && declaredQuantity > 0 && declaredUnit &&
      !snapshot.recognitionMeta?.identityEdited && !preparation ? {
        referenceBaseline: {
          unit: declaredUnit,
          quantity: declaredQuantity,
          nutrients: nutritionSignature(nutrition)
        }
      } : {}),
    identityLabel: [foodCode && `食品编号 ${foodCode}`, preparation, `成分基准 ${basisQuantity} ${basisUnit}`].filter(Boolean).join(' · '),
    quantity,
    unit,
    at,
    date
  };
}

function getSystemAminoReference(entry) {
  if (!entry?.referenceBaseline || !entry.foodCode) return null;
  if (!systemReferencesByCode) {
    const references = require('../data/aminoAcidReferences');
    systemReferencesByCode = new Map(references.map(reference => [reference.code, reference]));
  }
  const reference = systemReferencesByCode.get(entry.foodCode);
  if (!reference || reference.name !== entry.name) return null;
  const { baseline, profile } = reference;
  const current = entry.referenceBaseline;
  // 系统副本只有食品身份和成分基准仍与核对样品一致，才继承估算资料。
  if (profile.basis !== entry.unit || baseline.unit !== current.unit || baseline.quantity !== current.quantity ||
    !baseline.nutrients.every((value, index) => value === current.nutrients[index])) return null;
  return reference;
}

function getAminoProfileForField(saved, fallback, key) {
  if (!saved) return fallback;
  if (saved.estimatedKeys?.includes(key)) return { ...saved, estimated: true, source: saved.estimateSource };
  // 已编辑的副本保留保存时的值，包括用户清空的选填项。
  if (saved.estimateSource || saved.values[key] !== undefined) return saved;
  if (saved.estimated && (!fallback || saved.basis !== fallback.basis ||
    !['name', 'version', 'recordId'].every(field => saved.source[field] === fallback.source[field]))) return saved;
  return fallback || saved;
}

function fromFoodCatalog(food = {}) {
  return foodEntry({
    id: trimmed(food?._id || food?.id),
    name: trimmed(food?.name),
    snapshot: food || {},
    unit: foodBasis(food || {})[1]
  });
}

function ingredientSignature(item) {
  const snapshot = item?.foodSnapshot || {};
  const foodId = trimmed(item?.foodId);
  const name = trimmed(snapshot.name || item?.foodName);
  const quantity = nonnegative(item?.quantity);
  const unit = normalizeUnit(item?.unit);
  if (!foodId || !name || !(quantity > 0) || !unit) return null;
  return JSON.stringify([foodId, quantity, unit, ...foodIdentity(snapshot, name)]);
}

function recipeEntry(record, recipe, quantity, unit, at) {
  const name = trimmed(recipe?.recipeName || record.foodName || record.foodSnapshot?.name);
  const id = trimmed(recipe?.recipeId || record.recipeId);
  const batchWeightG = nonnegative(recipe?.batchWeightG || recipe?.yieldWeightG);
  const ingredients = array(recipe?.ingredientsSnapshot).map(ingredientSignature);
  const confirmedBatch = ingredients.length && ingredients.every(Boolean) && batchWeightG > 0;
  const percent = recipe?.intakeMode === 'percent';
  const entry = {
    key: id && name && confirmedBatch
      ? JSON.stringify(['recipe', id, name, batchWeightG, ingredients.sort()])
      : '',
    kind: 'food',
    sourceType: 'recipe',
    name: name || '名称缺失的食谱成品',
    foodCode: '',
    // 食谱百分比换算使用原料重量，无法确认成品实吃重量。
    quantity: percent ? nonnegative(recipe.intakePercent) : quantity,
    unit: percent ? '%' : unit,
    identityLabel: confirmedBatch ? `该批成品 ${batchWeightG} g` : '',
    date: record.date || '',
    at
  };
  if (percent) entry.unsupportedReason = '按比例记录的食谱缺少成品实吃克数';
  else if (!confirmedBatch) entry.unsupportedReason = '缺少食谱原料或批次信息';
  return entry;
}

function powderEntry(component, quantity = null, at = null, date = '') {
  const id = trimmed(component.powderId);
  const name = trimmed(component.powderName);
  const foodCode = trimmed(component.sourcePowderCode);
  // 旧资料缺 ID 时会用数组下标补出 ID，无法据此确认产品身份。
  const hasProductId = id && !/^formula_powder_\d+$/.test(id);
  const recognition = component.recognitionMeta?.confirmedIdentity || {};
  const powder = nonnegative(component.mixRatioSnapshot?.powder);
  const water = nonnegative(component.mixRatioSnapshot?.water);
  const protein = nonnegative(component.nutritionSnapshot?.protein);
  const signature = [
    name,
    trimmed(component.category),
    trimmed(component.proteinRole),
    foodCode,
    powder,
    water,
    ...['brand', 'series', 'stage', 'barcode'].map(key => trimmed(recognition[key])),
    ...nutritionSignature(component.nutritionSnapshot)
  ];
  return {
    key: hasProductId && name ? JSON.stringify(['powder', id, ...signature]) : '',
    kind: 'powder',
    name: name || '名称缺失的配方粉',
    foodCode,
    identityLabel: [
      recognition.brand, recognition.stage, recognition.barcode || foodCode,
      powder > 0 && water > 0 && `标准配比 ${powder} g 粉 / ${water} mL 水`,
      protein !== null && `干粉蛋白质 ${protein} g/100 g`
    ].filter(Boolean).join(' · '),
    quantity,
    unit: 'g',
    at,
    date
  };
}

function fromPowderCatalog(powder = {}) {
  if (!powder) return powderEntry({});
  if (powder.isVirtualBreastMilk || (powder._id || powder.id) === '__virtual_breast_milk__') {
    return breastMilkEntry();
  }
  return powderEntry(buildFormulaPowderComponent({ ...powder, id: powder.id || powder._id }));
}

function breastMilkEntry(quantity = null, at = null) {
  return { key: 'breast_milk', kind: 'breast_milk', name: '母乳', foodCode: '', quantity, unit: 'ml', at };
}

function legacyMilkEntry(record, at) {
  const splitVolume = (nonnegative(record.naturalMilkVolume) || 0) + (nonnegative(record.specialMilkVolume) || 0);
  const quantity = nonnegative(record.consumedBottleVolume) ?? (
    nonnegative(record.totalMilkVolume) || splitVolume || nonnegative(record.nutritionSummary?.totalVolume) || null
  );
  return {
    key: '',
    kind: 'powder',
    name: '旧奶量记录',
    foodCode: '',
    quantity,
    unit: 'ml',
    at,
    unsupportedReason: '奶量记录缺少成分及实际摄入明细'
  };
}

function collectIntakes({ foodIntakeRecords, milkRecords } = {}) {
  const entries = [];
  array(foodIntakeRecords).forEach(record => {
    if (!record || (record.status && record.status !== 'active') || record.deletedAt) return;
    const quantity = nonnegative(record.quantity);
    if (quantity === 0) return;
    const at = recordTimestamp(record.createdAt);
    const unit = normalizeUnit(record.unit);
    const snapshot = record.foodSnapshot || {};
    const recordId = trimmed(record._id);
    if (record.recipeSource || record.sourceType === 'recipe') {
      entries.push({ ...recipeEntry(record, record.recipeSource, quantity, unit, at), recordId });
      return;
    }
    entries.push({ ...foodEntry({
      id: trimmed(record.foodId),
      name: trimmed(snapshot.name || record.foodName || record.nameSnapshot),
      snapshot,
      quantity,
      unit,
      at,
      date: record.date || ''
    }), recordId });
  });
  array(milkRecords).forEach(record => {
    if (!record || (record.status && record.status !== 'active') || record.deletedAt) return;
    const at = recordTimestamp(record.createdAt);
    const components = array(record.formulaComponents);
    if (!components.length) {
      const entry = legacyMilkEntry(record, at);
      if (entry.quantity !== 0) entries.push(entry);
      return;
    }

    // 奶量记录已经按剩奶折算过 formulaComponents。
    components.forEach((component, componentIndex) => {
      const locator = { recordId: trimmed(record._id), componentIndex };
      if (component?.kind === 'breast_milk') {
        const quantity = nonnegative(component.volume);
        if (quantity !== 0) entries.push({ ...breastMilkEntry(quantity, at), ...locator });
      } else if (component?.kind === 'formula_powder') {
        const quantity = nonnegative(component.powderWeight);
        if (quantity !== 0) entries.push({ ...powderEntry(component, quantity, at, record.date || ''), ...locator });
      } else {
        entries.push({ ...legacyMilkEntry(record, at), name: '成分不明的奶量记录', quantity: null });
      }
    });
  });
  return entries;
}

function explicitlyApplied(versions, date, at) {
  if (!date) return null;
  let selected = null;
  let latestAppliedAt = -Infinity;
  array(versions).forEach(version => {
    if (!array(version?.dates).includes(date)) return;
    const appliedAt = version.appliedAtByDate?.[date] ?? version.effectiveAt;
    if (!Number.isFinite(appliedAt) || appliedAt < latestAppliedAt) return;
    if (Number.isFinite(at) && at > appliedAt) return;
    selected = version;
    latestAppliedAt = appliedAt;
  });
  return selected;
}

function applicableAt(versions, at) {
  if (!Number.isFinite(at)) return null;
  let selected = null;
  array(versions).forEach(version => {
    if (!Number.isFinite(version?.effectiveAt) || version.effectiveAt > at) return;
    if (!selected || version.effectiveAt >= selected.effectiveAt) selected = version;
  });
  return selected;
}

function profileForVersions(entry, versions, date) {
  // 补算仅覆盖当时已存在的记录，之后补录的记录沿用创建时的版本。
  const version = explicitlyApplied(versions, date, entry.at) || applicableAt(versions, entry.at);
  return normalizeProfile(version?.profile);
}

function selectProfile(entry, archive, date) {
  if (!entry?.key) return null;
  const item = array(archive).find(value => value?.key === entry.key);
  return profileForVersions(entry, item?.versions, date);
}

function sameProfile(version, profile) {
  return Boolean(version) && JSON.stringify(normalizeProfile(version.profile)) === JSON.stringify(profile);
}

function applyProfiles(archive, updates, { effectiveAt, date } = {}) {
  const entries = array(archive);
  if (!Number.isFinite(effectiveAt)) return entries;
  const day = trimmed(date);
  if (day) {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00.000Z`) : NaN;
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== day) return entries;
  }

  const requested = new Map();
  array(updates).forEach(update => {
    const key = trimmed(update?.key);
    const profile = normalizeProfile(update?.profile);
    if (key && profile) requested.set(key, profile);
  });
  if (!requested.size) return entries;
  const next = new Map(entries.map(entry => [entry?.key, entry]));
  requested.forEach((profile, key) => {
    const item = next.get(key);
    const versions = array(item?.versions);
    const active = applicableAt(versions, effectiveAt);
    if (sameProfile(active, profile)) {
      if (!day || explicitlyApplied(versions, day) === active) return;
      const updated = {
        ...active,
        dates: [...new Set([...array(active.dates), day])],
        appliedAtByDate: { ...active.appliedAtByDate, [day]: effectiveAt }
      };
      next.set(key, { ...item, versions: versions.map(version => version === active ? updated : version) });
      return;
    }
    const version = { effectiveAt, profile, dates: day ? [day] : [] };
    if (day) version.appliedAtByDate = { [day]: effectiveAt };
    next.set(key, {
      ...item,
      key,
      versions: [...versions, version]
    });
  });
  return [...next.values()];
}

function profileAmountBasis(entry, profile) {
  if (!profile) return null;
  if (entry.unit === profile.basis) return 100;
  // 厂家明确每 100 mL 成品所需的干粉克数时，可直接按实吃干粉量折算。
  if (entry.kind === 'powder' && entry.unit === 'g' && profile.basis === 'ml') {
    return profile.powderGramsPer100ml || null;
  }
  return null;
}

function missingReason(entry, quantity, profile, amountBasis) {
  if (entry.unsupportedReason) return entry.unsupportedReason;
  if (!entry.key) return '缺少可确认的食物或产品身份';
  if (quantity === null) return '缺少实际摄入量';
  if (!entry.unit) return '缺少实际摄入单位';
  if (!['g', 'ml'].includes(entry.unit)) return `请先在原记录填写可换算的实际份量（当前单位 ${entry.unit}）`;
  if (!profile) return '';
  if (amountBasis) return '';
  if (entry.kind === 'powder' && profile.basis === 'ml') return '缺少厂家每 100 mL 成品所需的干粉克数';
  return `摄入单位 ${entry.unit} 无法换算为资料单位 ${profile.basis}`;
}

function canSupplementIntake(entry) {
  return !!entry?.recordId && !!entry.key && !entry.unsupportedReason
    && nonnegative(entry.quantity) > 0 && ['g', 'ml'].includes(entry.unit);
}

function summarizeIntakes(entries, archive, date) {
  const byKey = new Map(array(archive).map(item => [item?.key, item?.versions]));
  const intakes = array(entries).filter(entry => entry && nonnegative(entry.quantity) !== 0).map(entry => {
    const quantity = nonnegative(entry.quantity);
    const saved = entry.key ? profileForVersions(entry, byKey.get(entry.key), date) : null;
    const fallback = saved?.estimateSource ? null : getSystemAminoReference(entry)?.profile;
    return { entry, quantity, saved, fallback };
  });
  const rows = DAILY_AMINO_ACIDS.map(({ key, label }) => {
    const contributions = [];
    const missing = [];
    let totalMg = null;
    intakes.forEach(({ entry, quantity, saved, fallback }, intakeIndex) => {
      const { name, unit } = entry;
      const profile = getAminoProfileForField(saved, fallback, key);
      const amount = profile?.values[key];
      const amountBasis = profileAmountBasis(entry, profile);
      const reason = missingReason(entry, quantity, profile, amountBasis);
      const mg = quantity / amountBasis * amount;
      if (reason || amount === undefined || !Number.isFinite(mg + (totalMg ?? 0))) {
        missing.push({
          intakeIndex,
          ...(canSupplementIntake(entry) && (reason || amount === undefined)
            ? { recordId: entry.recordId, componentIndex: entry.componentIndex ?? '' } : {}),
          name,
          quantity,
          unit,
          reason: reason || (amount === undefined ? '' : '摄入量超出可计算范围')
        });
        return;
      }
      totalMg = (totalMg ?? 0) + mg;
      contributions.push({
        name, quantity, unit, mg, source: profile.source,
        catalogId: entry.catalogId || '',
        estimated: profile.estimated === true
      });
    });

    let status = 'empty';
    if (intakes.length) {
      if (!contributions.length) status = 'missing';
      else status = missing.length ? 'partial' : 'complete';
    }
    return { key, label, totalMg, status, estimated: contributions.some(item => item.estimated), contributions, missing };
  });
  return { hasIntakes: intakes.length > 0, rows };
}

module.exports = {
  AMINO_ACIDS,
  getManualAminoAcidError,
  applyAminoReference,
  normalizeProfile,
  getSystemAminoReference,
  getAminoProfileForField,
  fromFoodCatalog,
  fromPowderCatalog,
  collectIntakes,
  canSupplementIntake,
  selectProfile,
  applyProfiles,
  summarizeIntakes
};
