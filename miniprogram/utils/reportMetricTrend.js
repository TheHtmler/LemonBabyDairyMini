function formatAxisValue(value) {
  const magnitude = Math.abs(value);
  if (magnitude >= 1e6 || (magnitude > 0 && magnitude < 0.001)) return value.toExponential(2);
  return String(Number(value.toPrecision(6)));
}

function referenceBounds({ referenceMin, referenceMax } = {}) {
  const hasMin = Number.isFinite(referenceMin);
  const hasMax = Number.isFinite(referenceMax);
  if (hasMin && hasMax) return referenceMin <= referenceMax ? [referenceMin, referenceMax] : [];
  if (hasMin) return [referenceMin];
  return hasMax ? [referenceMax] : [];
}

function buildReportMetricTrend(cells, width, height, activeIndex) {
  const values = cells.map(cell => cell.numericValue).filter(Number.isFinite);
  if (values.length < 2 || width < 120 || height < 80) return null;
  const domain = values.concat(cells.flatMap(referenceBounds));
  const max = Math.max(...domain);
  const min = Math.min(...domain);
  const scale = Math.max(Math.abs(max), Math.abs(min)) || 1;
  const bottom = height - 38;
  const top = 16;
  const left = 60;
  const right = width - 28;
  const step = (right - left) / (cells.length - 1);
  const xAt = index => left + step * index;
  const toY = value => min === max ? (top + bottom) / 2
    : bottom - ((value / scale - min / scale) / (max / scale - min / scale)) * (bottom - top);

  const selected = cells[activeIndex];
  const bounds = referenceBounds(selected);
  const references = new Set(bounds);
  const referenceLines = [...references].map(value => ({ value, y: toY(value) }));
  const ticks = [];
  for (const value of new Set([...references, min, min / 2 + max / 2, max])) {
    const y = toY(value);
    if (!ticks.some(tick => Math.abs(tick.y - y) < 14)) {
      ticks.push({ y, label: formatAxisValue(value), reference: references.has(value) });
    }
  }
  const labelCount = Math.min(cells.length, 4);
  const multipleYears = cells[0].date.slice(0, 4) !== cells[cells.length - 1].date.slice(0, 4);
  const labels = Array.from({ length: labelCount }, (_, label) => {
    const index = Math.round(label * (cells.length - 1) / (labelCount - 1));
    return { index, x: xAt(index), text: cells[index].date.slice(multipleYears ? 2 : 5) };
  });
  const points = [];
  const segments = [];
  cells.forEach(({ numericValue }, index) => {
    if (!Number.isFinite(numericValue)) return;
    const point = { index, x: xAt(index), y: toY(numericValue) };
    const previous = points[points.length - 1];
    // 缺失值和带比较符的结果保留横轴位置，两侧的数值点不相连。
    if (previous?.index === index - 1) {
      const dy = point.y - previous.y;
      segments.push({ index, x: previous.x, y: previous.y,
        length: Math.hypot(step, dy), angle: Math.atan2(dy, step) * 180 / Math.PI });
    }
    points.push(point);
  });

  const referenceText = bounds.length === 2 ? bounds.join('–')
    : bounds.length === 1 ? (Number.isFinite(selected.referenceMin) ? '≥' : '≤') + bounds[0] : '';
  return { left, step, plotWidth: right - left, dateY: bottom + 12,
    ticks, labels, points, segments, referenceLines, referenceText };
}

module.exports = { buildReportMetricTrend };
