const { OCR_MODES } = require('./ocrConfig');
const { parseRefRange } = require('./refRangeParser');

function boxToPos(box, index = 0) {
  if (!box) {
    return { top: index * 24, left: 0, width: 0, height: 20 };
  }

  if (Array.isArray(box) && box.length === 4 && typeof box[0] === 'number') {
    const [x1, y1, x2, y2] = box;
    return {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1) || 20
    };
  }

  if (Array.isArray(box) && Array.isArray(box[0])) {
    const xs = box.map((point) => Number(point[0]) || 0);
    const ys = box.map((point) => Number(point[1]) || 0);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return {
      left,
      top,
      width: Math.max(...xs) - left,
      height: Math.max(...ys) - top || 20
    };
  }

  if (box && typeof box === 'object') {
    return {
      left: Number(box.left ?? box.x ?? 0),
      top: Number(box.top ?? box.y ?? 0),
      width: Number(box.width ?? box.w ?? 0),
      height: Number(box.height ?? box.h ?? 20) || 20
    };
  }

  return { top: index * 24, left: 0, width: 0, height: 20 };
}

function normalizeStructuredItem(item = {}) {
  const name = `${item.name
    || item.label
    || item.indicatorName
    || item.indicator_name
    || item.displayName
    || item.display_name
    || item.metricName
    || item.metric_name
    || ''}`.trim();
  const { minRange, maxRange } = parseRefRange(item.ref_range ?? item.refRange);

  return {
    name,
    value: `${item.value ?? ''}`.trim(),
    unit: item.unit ?? null,
    refRange: item.ref_range ?? item.refRange ?? null,
    minRange,
    maxRange,
    flag: item.flag ?? null,
    confidence: item.confidence ?? null,
    source: item.source || null,
    indicatorKey: `${item.indicatorKey || item.indicator_key || item.key || item.code || item.metricKey || item.metric_key || ''}`.trim() || null
  };
}

function adaptFormatReportResponse(response = {}) {
  const structuredItems = (Array.isArray(response.items) ? response.items : [])
    .map(normalizeStructuredItem)
    .filter((item) => item.name || item.value);

  const rawLines = Array.isArray(response.raw_ocr?.lines) ? response.raw_ocr.lines : [];

  return {
    mode: OCR_MODES.FORMAT_REPORT,
    client: response.client || '',
    reportType: response.report_type || '',
    parserVersion: response.parser_version || '',
    itemCount: response.item_count ?? structuredItems.length,
    warnings: Array.isArray(response.warnings) ? response.warnings : [],
    structuredItems,
    lines: rawLines,
    rawText: response.raw_ocr?.text || response.text || ''
  };
}

function adaptGenericOcrResponse(response = {}) {
  const lines = Array.isArray(response.lines) ? response.lines : [];

  return {
    mode: OCR_MODES.GENERIC,
    client: response.client || '',
    reportType: '',
    parserVersion: '',
    itemCount: lines.length,
    warnings: [],
    structuredItems: [],
    lines,
    rawText: response.text || ''
  };
}

function linesToOcrItems(lines = []) {
  return (lines || [])
    .map((line, index) => ({
      text: `${line?.text || ''}`.trim(),
      confidence: line?.confidence ?? line?.score,
      pos: boxToPos(line?.box, index)
    }))
    .filter((item) => item.text);
}

function adaptOcrResponse(response = {}, mode = OCR_MODES.FORMAT_REPORT) {
  if (mode === OCR_MODES.GENERIC) {
    const adapted = adaptGenericOcrResponse(response);
    return {
      ...adapted,
      items: linesToOcrItems(adapted.lines)
    };
  }

  const adapted = adaptFormatReportResponse(response);
  return {
    ...adapted,
    items: linesToOcrItems(adapted.lines)
  };
}

module.exports = {
  OCR_MODES,
  boxToPos,
  parseRefRange,
  normalizeStructuredItem,
  adaptFormatReportResponse,
  adaptGenericOcrResponse,
  adaptOcrResponse,
  linesToOcrItems
};
