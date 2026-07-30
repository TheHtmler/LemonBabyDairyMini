function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeUnit(unit) {
  return String(unit == null ? '' : unit).trim();
}

function formatDosageText(total) {
  if (total == null || !Number.isFinite(total)) return '';
  const rounded = Math.round(total * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

function buildMedicationDayStats(records) {
  const list = Array.isArray(records) ? records.filter(Boolean) : [];
  if (list.length === 0) return [];

  const groups = new Map();
  list.forEach((record) => {
    const id = record.medicationId != null ? String(record.medicationId).trim() : '';
    const name = String(record.medicationName || '').trim() || '未命名药物';
    const key = id || name;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        medicationName: name,
        count: 0,
        dosages: [],
        units: []
      });
    }
    const group = groups.get(key);
    group.count += 1;
    if (!group.medicationName || group.medicationName === '未命名药物') {
      if (name && name !== '未命名药物') group.medicationName = name;
    }
    group.dosages.push(toNumber(record.dosage));
    group.units.push(normalizeUnit(record.unit));
  });

  return Array.from(groups.values())
    .map((group) => {
      const uniqueUnits = [...new Set(group.units.filter(Boolean))];
      const allBlank = group.units.every((u) => !u);
      const sameUnit = allBlank || uniqueUnits.length <= 1;
      const unit = sameUnit ? (uniqueUnits[0] || group.units[0] || '') : '';
      const totalDosage = sameUnit
        ? group.dosages.reduce((sum, d) => sum + d, 0)
        : null;
      return {
        key: group.key,
        medicationName: group.medicationName,
        totalDosage,
        dosageText: formatDosageText(totalDosage),
        unit: totalDosage == null ? '' : unit,
        count: group.count
      };
    })
    .sort((a, b) => a.medicationName.localeCompare(b.medicationName));
}

module.exports = {
  buildMedicationDayStats
};
