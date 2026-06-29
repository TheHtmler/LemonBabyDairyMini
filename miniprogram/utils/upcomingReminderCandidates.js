function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && typeof value.getTime === 'function') {
    const date = new Date(value.getTime());
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateTimeFromParts(dateKey, timeText) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  const [hour, minute] = String(timeText || '').split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateTime(date) {
  const d = toDate(date);
  if (!d) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function firstPositiveNumber(values = []) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return 0;
}

function sourceId(record = {}, fallback = '') {
  return record._id || record.id || record.recordId || fallback;
}

function truncate(text, maxLength = 20) {
  const value = String(text || '').trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function milkVolume(record = {}) {
  const summary = record.nutritionSummary || {};
  const direct = firstPositiveNumber([
    summary.totalVolume,
    record.totalVolume,
    record.volume
  ]);
  if (direct > 0) return direct;

  const components = Array.isArray(record.formulaComponents) ? record.formulaComponents : [];
  return components.reduce((sum, component = {}) => {
    const volume = component.kind === 'breast_milk'
      ? Number(component.volume)
      : Number(component.waterVolume);
    return sum + (Number.isFinite(volume) && volume > 0 ? volume : 0);
  }, 0);
}

function milkPartText(record = {}) {
  const components = Array.isArray(record.formulaComponents) ? record.formulaComponents : [];
  const parts = components
    .map((component = {}) => {
      if (component.kind === 'breast_milk') {
        const volume = Number(component.volume);
        return volume > 0 ? `母乳${Math.round(volume)}ml` : '';
      }
      if (component.kind === 'formula_powder') {
        const volume = Number(component.waterVolume);
        const name = component.powderName || (component.proteinRole === 'special' ? '特奶' : '奶粉');
        return volume > 0 ? `${name}${Math.round(volume)}ml` : '';
      }
      return '';
    })
    .filter(Boolean);
  if (parts.length) {
    const total = milkVolume(record);
    return total > 0 ? `${Math.round(total)}ml · ${parts.join(' + ')}` : parts.join(' + ');
  }

  const volume = milkVolume(record);
  return volume > 0 ? `${Math.round(volume)}ml` : '已记录的奶';
}

function buildMilkCandidate(record = {}, now) {
  const dueAt = toDate(record.startDateTime) || dateTimeFromParts(record.date, record.startTime);
  if (!dueAt || dueAt.getTime() <= now.getTime()) return null;

  const id = sourceId(record, `${record.date || ''}_${record.startTime || ''}`);
  return {
    type: 'milk',
    sourceType: 'milk',
    sourceRecordId: id,
    sourceKey: `milk:${id}`,
    dueAt,
    dueAtMs: dueAt.getTime(),
    timeText: formatDateTime(dueAt),
    title: '宝宝喂奶提醒',
    content: '该喂奶啦',
    note: milkPartText(record)
  };
}

function foodRecordDueAt(record = {}) {
  return toDate(record.recordedAt)
    || toDate(record.actualDateTime)
    || dateTimeFromParts(record.date, record.mealTime || record.recordedAt || record.time);
}

function groupFoodRecords(records = []) {
  const groups = new Map();
  (records || []).forEach((record = {}, index) => {
    if ((record.status || 'active') !== 'active') return;
    const dueAt = foodRecordDueAt(record);
    if (!dueAt) return;
    const key = record.mealBatchId || sourceId(record, `food_${index}`);
    const group = groups.get(key) || { key, dueAt, records: [] };
    if (dueAt.getTime() < group.dueAt.getTime()) group.dueAt = dueAt;
    group.records.push(record);
    groups.set(key, group);
  });
  return Array.from(groups.values());
}

function buildFoodCandidate(group, now) {
  if (!group || !group.dueAt || group.dueAt.getTime() <= now.getTime()) return null;
  const records = group.records || [];
  const first = records[0] || {};
  const names = records
    .map((record = {}) => record.foodName || record.nameSnapshot || record.foodSnapshot?.name || '')
    .filter(Boolean);
  const mealLabel = first.mealLabel || '辅食';
  const noteParts = [mealLabel, names.slice(0, 3).join('、')].filter(Boolean);

  return {
    type: 'food',
    sourceType: 'food',
    sourceRecordId: group.key,
    sourceKey: `food:${group.key}`,
    dueAt: group.dueAt,
    dueAtMs: group.dueAt.getTime(),
    timeText: formatDateTime(group.dueAt),
    title: '宝宝辅食提醒',
    content: '该吃辅食啦',
    note: noteParts.join(' · ') || '已记录的辅食'
  };
}

function buildMedicationCandidate(record = {}, now) {
  const dueAt = toDate(record.actualDateTime) || dateTimeFromParts(record.date, record.actualTime);
  if (!dueAt || dueAt.getTime() <= now.getTime()) return null;

  const id = sourceId(record, `${record.medicationId || 'med'}_${record.actualTime || ''}`);
  const name = record.medicationName || record.name || '药物';
  const dose = [record.dosage, record.unit].filter(Boolean).join('');

  return {
    type: 'medication',
    sourceType: 'medication',
    sourceRecordId: id,
    sourceKey: `medication:${id}`,
    dueAt,
    dueAtMs: dueAt.getTime(),
    timeText: formatDateTime(dueAt),
    title: '宝宝用药提醒',
    content: truncate(`${name}该用药啦`),
    note: dose ? `${name} ${dose}` : name
  };
}

function sortCandidates(candidates = []) {
  return candidates
    .filter(Boolean)
    .sort((a, b) => a.dueAtMs - b.dueAtMs);
}

function buildUpcomingReminderCandidates({
  milkRecords = [],
  foodIntakeRecords = [],
  medicationRecords = [],
  now = new Date()
} = {}) {
  const current = toDate(now) || new Date();
  const milkList = sortCandidates((milkRecords || []).map((record) => buildMilkCandidate(record, current)));
  const foodList = sortCandidates(groupFoodRecords(foodIntakeRecords).map((group) => buildFoodCandidate(group, current)));
  const medicationList = sortCandidates((medicationRecords || []).map((record) => buildMedicationCandidate(record, current)));
  const all = sortCandidates([...milkList, ...foodList, ...medicationList]);

  return {
    milk: milkList[0] || null,
    food: foodList[0] || null,
    medication: medicationList[0] || null,
    milkList,
    foodList,
    medicationList,
    all
  };
}

function pickUpcomingReminderCandidate(candidates = {}, type = '') {
  return candidates[type] || null;
}

module.exports = {
  buildUpcomingReminderCandidates,
  pickUpcomingReminderCandidate,
  formatDateTime
};
