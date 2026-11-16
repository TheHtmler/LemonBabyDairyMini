// 将手工样例组织成血报告的原行表和行号映射，不读取真实患者数据。
function bloodReportResponse(items, finishReason = 'stop') {
  const rows = items.map((item, index) => item && typeof item === 'object'
    ? [String(index + 1), item.name ?? null, item.value ?? null,
      item.ref_range ?? item.refRange ?? null, item.unit ?? null, item.flag ?? null]
    : item);
  const matches = items.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const key = Object.hasOwn(item, 'indicator_key') ? item.indicator_key : item.indicatorKey;
    return key === undefined ? [] : [[item.needs_review === true ? null : key, String(index + 1)]];
  });
  return { choices: [{ finish_reason: finishReason, message: { content: JSON.stringify({ rows, matches }) } }] };
}

module.exports = { bloodReportResponse };
