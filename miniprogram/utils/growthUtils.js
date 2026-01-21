function parseDateString(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function calculateAgeMonths(birthdayStr, recordDateStr) {
  const birthday = parseDateString(birthdayStr);
  const recordDate = parseDateString(recordDateStr);
  if (!birthday || !recordDate) return null;
  let months = (recordDate.getFullYear() - birthday.getFullYear()) * 12;
  months += recordDate.getMonth() - birthday.getMonth();
  if (recordDate.getDate() < birthday.getDate()) {
    months -= 1;
  }
  return Math.max(0, months);
}

function interpolateMonthlySeries(points, maxMonth) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.month - b.month);
  const output = [];
  let cursor = 0;
  for (let month = 0; month <= maxMonth; month += 1) {
    while (cursor < sorted.length - 1 && sorted[cursor + 1].month < month) {
      cursor += 1;
    }
    const current = sorted[cursor];
    const next = sorted[cursor + 1];
    if (!next || current.month === month) {
      output.push({ month, ...current.values });
      continue;
    }
    const span = next.month - current.month;
    if (span <= 0) {
      output.push({ month, ...current.values });
      continue;
    }
    const ratio = (month - current.month) / span;
    const values = {};
    Object.keys(current.values).forEach((key) => {
      const start = current.values[key];
      const end = next.values[key];
      values[key] = +(start + (end - start) * ratio).toFixed(1);
    });
    output.push({ month, ...values });
  }
  return output;
}

module.exports = {
  parseDateString,
  calculateAgeMonths,
  interpolateMonthlySeries
};
