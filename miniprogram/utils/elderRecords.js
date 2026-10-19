const { buildTimeline, milkRecordVolumes } = require('./homeDashboard');
const { createFeedingDisplayFromV2 } = require('./dataRecordsV2Adapter');

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function quantityText(value, unit = '') {
  if (!hasValue(value)) return '';
  if (typeof value === 'number' && !Number.isFinite(value)) return '';
  return `${String(value).trim()}${unit ? ` ${unit}` : ''}`;
}

function resolveRecordTime(...values) {
  for (const value of values) {
    if (!hasValue(value)) continue;
    if (typeof value === 'string') {
      const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (match) {
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        const seconds = Number(match[3] || 0);
        if (hours < 24 && minutes < 60 && seconds < 60) {
          return {
            time: `${String(hours).padStart(2, '0')}:${match[2]}`,
            sortValue: hours * 3600 + minutes * 60 + seconds
          };
        }
        continue;
      }
    }
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return {
        time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
        sortValue: date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()
      };
    }
  }
  return { time: '--:--', sortValue: -1 };
}

function activeRecords(records) {
  return (Array.isArray(records) ? records : []).filter((record) => (
    record && record.status !== 'deleted' && record.status !== 'archived' && !record.deletedAt
  ));
}

function buildMilkItems(record) {
  const hasPreparedComponents = Array.isArray(record.preparedComponents) && record.preparedComponents.length > 0;
  const components = hasPreparedComponents ? record.preparedComponents : (record.formulaComponents || []);
  return components.map((component, index) => {
    // 类型标签沿用普通模式；长辈列表按“粉量、水量”的顺序展示。
    const item = createFeedingDisplayFromV2({ formulaComponents: [component] }).milkSummaryItems[0];
    if (!item) return null;
    const amount = (value, unit) => Number.isFinite(Number(value)) && Number(value) > 0
      ? `${Number(Number(value).toFixed(2))}${unit}` : '';
    return {
      ...item, id: index,
      badge: { special: '特奶', regular: '普奶', energy: '能量粉', breast: '' }[item.badgeClass] ?? item.badge,
      amountText: component.kind === 'breast_milk'
        ? amount(component.volume, 'ml')
        : [amount(component.powderWeight, ' g'), amount(component.waterVolume, 'ml')].filter(Boolean).join(' ')
    };
  }).filter(Boolean);
}

function buildFoodMeals(foodRecords) {
  const meals = new Map();
  activeRecords(foodRecords).forEach((record, index) => {
    if (record.type === 'milk' || record.milkType) return;
    // 与普通模式使用同一餐次编号；没有编号的历史记录各自保留，避免误合并。
    const key = record.mealBatchId ? `meal:${record.mealBatchId}` : `single:${record._id || record.id || index}`;
    const time = resolveRecordTime(record.mealTime, record.time, record.recordedAt, record.recordTime);
    if (!meals.has(key)) {
      meals.set(key, { id: `food:${key}`, type: 'food', label: '食物', ...time, content: '', items: [],
        mealBatchId: record.mealBatchId || '', recordIds: [], recordVersions: {}, mealNotes: new Set() });
    }
    const meal = meals.get(key);
    if (record._id || record.id) {
      const recordId = String(record._id || record.id);
      meal.recordIds.push(recordId);
      meal.recordVersions[recordId] = record.updatedAt ? JSON.stringify(record.updatedAt) : '';
    }
    if (!meal.content && hasValue(record.mealLabel)) meal.content = String(record.mealLabel).trim();
    if (meal.sortValue < 0 && time.sortValue >= 0) Object.assign(meal, time);
    if (hasValue(record.mealNote)) meal.mealNotes.add(String(record.mealNote).trim());
    meal.items.push({
      id: String(record._id || record.id || index),
      name: record.foodName || (record.foodSnapshot && record.foodSnapshot.name) || record.nameSnapshot || '食物',
      amount: quantityText(record.quantity, record.unit || '') || '未填写数量',
      notes: hasValue(record.notes) ? String(record.notes).trim() : '',
      sortOrder: hasValue(record.sortOrder) && Number.isFinite(Number(record.sortOrder)) ? Number(record.sortOrder) : index
    });
  });
  return Array.from(meals.values()).map(({ mealNotes, ...meal }) => ({
    ...meal,
    recordId: meal.recordIds[0] || '',
    canManage: meal.recordIds.length === meal.items.length && meal.recordIds.length > 0,
    content: meal.content || '食物记录',
    items: meal.items.sort((first, second) => first.sortOrder - second.sortOrder),
    notes: Array.from(mealNotes).join('；')
  }));
}

// 仅把已有记录转换为展示数据，不写入记录，也不改变普通模式的统计口径。
function buildElderRecords(daily = {}) {
  const records = [];
  const append = (type, label, record, index, content, timeValues, notes = record.notes) => {
    records.push({
      id: `${type}:${record._id || record.id || index}`,
      recordId: record._id || record.id || '',
      recordVersion: record.updatedAt ? JSON.stringify(record.updatedAt) : '',
      canManage: !!(record._id || record.id),
      type,
      label,
      ...resolveRecordTime(...timeValues),
      content,
      notes: hasValue(notes) ? String(notes).trim() : ''
    });
  };

  activeRecords(daily.milkRecords).forEach((record, index) => {
    const milkItems = buildMilkItems(record);
    const content = milkItems.map(item => `${item.name}${item.badge ? ' ' + item.badge : ''}：${item.amountText}`).join('；')
      || quantityText(record.consumedBottleVolume ?? milkRecordVolumes(record).total, 'ml') || '喂奶记录';
    append('milk', '喂奶', record, index, content, [record.startTime, record.startDateTime]);
    records[records.length - 1].milkItems = milkItems;
  });

  activeRecords(daily.medicationRecords).forEach((record, index) => {
    const dosage = quantityText(record.dosage, record.unit || '');
    const content = [record.medicationName || '药物', dosage || '未填写剂量'].join(' · ');
    append('medication', '用药', record, index, content, [record.actualTime, record.actualDateTime]);
  });

  activeRecords(daily.waterRecords).forEach((record, index) => {
    append('water', '喝水', record, index,
      quantityText(record.volumeMl, 'ml') || '未填写水量',
      [record.timeString, record.recordTime, record.time]);
  });

  activeRecords(daily.bowelRecords).forEach((record, index) => {
    // 复用普通首页的便便描述，缺失时间只用于取描述，不作为显示时间。
    const event = buildTimeline({ bowelRecords: [{ ...record, timeString: '00:00', notes: '' }] })[0];
    const content = event ? [event.title, event.desc].filter(Boolean).join(' · ') : '排便记录';
    append('bowel', '便便', record, index, content, [record.timeString, record.recordTime, record.time]);
  });

  records.push(...buildFoodMeals(daily.foodIntakeRecords));

  activeRecords(daily.treatmentRecords).forEach((record, index) => {
    const event = buildTimeline({ treatmentRecords: [{ ...record, startTime: '00:00', notes: '' }] })[0];
    append('treatment', '治疗', record, index, event ? event.title.replace(/^治疗 · /, '') : '治疗记录',
      [record.startTime, record.actualTime, record.startDateTime, record.time]);
  });

  activeRecords(daily.sleepRecords).forEach((record, index) => {
    const event = buildTimeline({ sleepRecords: [{ ...record, startTime: '00:00', notes: '' }] })[0];
    append('sleep', '睡眠', record, index, event ? event.title.replace(/^睡眠 · /, '') : '睡眠记录',
      [record.startTime, record.startDateTime]);
  });

  return records.sort((first, second) => second.sortValue - first.sortValue);
}

module.exports = { buildElderRecords };
