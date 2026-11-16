const BASE_WIDTH = 1240;
const IMAGE_MARGIN = 64;
const NAME_COLUMN_WIDTH = 320;
const DATA_COLUMN_WIDTH = 280;
const MAX_IMAGE_SIDE = 8192;
const MAX_IMAGE_PIXELS = 16000000;
const MIN_BODY_FONT_SIZE = 12;
const TOO_MUCH_CONTENT = '内容过多，请减少报告数量或导出Excel';
const CELL_PADDING = 16;
const BODY_FONT_SIZE = 24;
const BODY_LINE_HEIGHT = 34;
const activePages = new WeakSet();

const toText = value => value === null || value === undefined ? '' : String(value);

function throwIfCancelled(document) {
  if (document && typeof document.isCancelled === 'function' && document.isCancelled()) {
    throw new Error('导出已取消');
  }
}

function setFont(context, size, bold = false) {
  // 使用系统中文字体回退，保留希腊字母、上下限符号与单位原文。
  context.font = (bold ? '600 ' : '400 ') + size + 'px sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'top';
}

function wrapText(context, value, width) {
  const lines = [];
  const paragraphs = toText(value).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  paragraphs.forEach(paragraph => {
    let line = '';
    // 按 Unicode 码点遍历，避免把辅助平面字符拆成两个无效字符。
    for (const character of paragraph) {
      const candidate = line + character;
      if (line && context.measureText(candidate).width > width) {
        lines.push(line);
        line = character;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  });
  return lines;
}

function getColumnWidths(count, contentWidth, requestedWidths) {
  const weights = Array.from({ length: count }, (_, index) => {
    const fallback = index === 0 ? NAME_COLUMN_WIDTH : DATA_COLUMN_WIDTH;
    const value = Array.isArray(requestedWidths) ? requestedWidths[index] : fallback;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  });
  const largest = Math.max(...weights);
  const normalized = weights.map(value => value / largest);
  const total = normalized.reduce((sum, value) => sum + value, 0);
  const widths = normalized.map(value => contentWidth * value / total);
  // 极端列宽配置不应挤成无法辨认的竖排，改用完整保留所有列的默认比例。
  if (widths.some(width => width < 120)) {
    const defaultTotal = NAME_COLUMN_WIDTH + DATA_COLUMN_WIDTH * (count - 1);
    return widths.map((_, index) => contentWidth * (index === 0 ? NAME_COLUMN_WIDTH : DATA_COLUMN_WIDTH) / defaultTotal);
  }
  return widths;
}

function getRenderSize(width, height) {
  const scale = Math.min(1, MAX_IMAGE_SIDE / width, MAX_IMAGE_SIDE / height,
    Math.sqrt(MAX_IMAGE_PIXELS / width / height));
  if (!Number.isFinite(scale) || BODY_FONT_SIZE * scale < MIN_BODY_FONT_SIZE) {
    throw new Error(TOO_MUCH_CONTENT);
  }
  return { width: Math.floor(width * scale), height: Math.floor(height * scale), scale };
}

function wrapCells(context, cells, widths) {
  return widths.map((width, index) => wrapText(context, cells[index], width - CELL_PADDING * 2));
}

function buildLayout(context, document) {
  if (!document || !Array.isArray(document.headers) || !document.headers.length || !Array.isArray(document.rows)) {
    throw new Error('报告导出内容不完整，请重试');
  }
  const columnCount = document.headers.length;
  if (document.rows.some(row => !Array.isArray(row) || row.length > columnCount)) {
    throw new Error('报告表格列数不一致，无法导出');
  }
  const sectionRows = document.sectionRows === undefined ? [] : document.sectionRows;
  if (!Array.isArray(sectionRows) || sectionRows.some(index => !Number.isInteger(index) || index < 0 || index >= document.rows.length)) {
    throw new Error('报告分区行标识无效');
  }
  const sections = new Set(sectionRows);
  const width = Math.max(BASE_WIDTH, IMAGE_MARGIN * 2 + NAME_COLUMN_WIDTH + DATA_COLUMN_WIDTH * (columnCount - 1));
  // 先检查宽度，避免为明显超出内存或可读性限制的列数继续排版。
  getRenderSize(width, IMAGE_MARGIN * 2);
  const contentWidth = width - IMAGE_MARGIN * 2;
  const widths = getColumnWidths(columnCount, contentWidth, document.columnWidths);
  setFont(context, 40, true);
  const titleLines = wrapText(context, toText(document.title) || '报告', contentWidth);
  setFont(context, BODY_FONT_SIZE);
  const subtitle = toText(document.subtitle);
  const subtitleLines = subtitle ? wrapText(context, subtitle, contentWidth) : [];
  const headingBottom = IMAGE_MARGIN + titleLines.length * 54 + 16
    + (subtitleLines.length ? subtitleLines.length * BODY_LINE_HEIGHT + 20 : 0);
  setFont(context, BODY_FONT_SIZE, true);
  const headerCells = wrapCells(context, document.headers, widths);
  const headerHeight = Math.max(...headerCells.map(lines => lines.length)) * BODY_LINE_HEIGHT + CELL_PADDING * 2;
  let cursor = headingBottom + headerHeight;
  getRenderSize(width, cursor + IMAGE_MARGIN);
  const rows = document.rows.map((row, index) => {
    throwIfCancelled(document);
    const sectionHeader = sections.has(index);
    // 分区标题按实际粗体测量，后续行从完整标题高度之后连续排布。
    setFont(context, BODY_FONT_SIZE, sectionHeader);
    const cells = wrapCells(context, row, widths);
    const lineCount = Math.max(...cells.map(lines => lines.length));
    const rowHeight = lineCount * BODY_LINE_HEIGHT + CELL_PADDING * 2;
    const result = { cells, y: cursor, height: rowHeight, sectionHeader };
    cursor += rowHeight;
    getRenderSize(width, cursor + IMAGE_MARGIN);
    return result;
  });
  setFont(context, BODY_FONT_SIZE);
  const footnote = toText(document.footnote);
  const noteLines = footnote ? wrapText(context, footnote, contentWidth) : [];
  const noteTop = cursor + 24;
  if (noteLines.length) cursor = noteTop + noteLines.length * BODY_LINE_HEIGHT;
  const height = cursor + IMAGE_MARGIN;
  const output = getRenderSize(width, height);
  return { width, height, contentWidth, widths, titleLines, subtitleLines, headingBottom,
    headerCells, headerHeight, rows, noteLines, noteTop, output };
}

function drawLines(context, lines, x, y, lineHeight, width, scale) {
  lines.forEach((line, index) => {
    context.fillText(line, x * scale, (y + index * lineHeight) * scale, width * scale);
  });
}

function drawCells(context, cells, layout, y, height, header = false) {
  const scale = layout.output.scale;
  context.fillStyle = header ? '#edf2ec' : '#ffffff';
  context.fillRect(IMAGE_MARGIN * scale, y * scale, layout.contentWidth * scale, height * scale);
  context.strokeStyle = '#d6ded5';
  context.lineWidth = scale;
  context.strokeRect(IMAGE_MARGIN * scale, y * scale, layout.contentWidth * scale, height * scale);
  context.fillStyle = '#283b32';
  setFont(context, BODY_FONT_SIZE * scale, header);
  let x = IMAGE_MARGIN;
  cells.forEach((lines, index) => {
    const width = layout.widths[index];
    if (index) {
      context.beginPath();
      context.moveTo(x * scale, y * scale);
      context.lineTo(x * scale, (y + height) * scale);
      context.stroke();
    }
    drawLines(context, lines, x + CELL_PADDING, y + CELL_PADDING, BODY_LINE_HEIGHT, width - CELL_PADDING * 2, scale);
    x += width;
  });
}

function drawImage(context, layout, document) {
  const { width, height, scale } = layout.output;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#283b32';
  setFont(context, 40 * scale, true);
  drawLines(context, layout.titleLines, IMAGE_MARGIN, IMAGE_MARGIN, 54, layout.contentWidth, scale);
  context.fillStyle = '#59675f';
  setFont(context, BODY_FONT_SIZE * scale);
  drawLines(context, layout.subtitleLines, IMAGE_MARGIN, IMAGE_MARGIN + layout.titleLines.length * 54 + 16,
    BODY_LINE_HEIGHT, layout.contentWidth, scale);
  drawCells(context, layout.headerCells, layout, layout.headingBottom, layout.headerHeight, true);
  layout.rows.forEach(row => {
    throwIfCancelled(document);
    drawCells(context, row.cells, layout, row.y, row.height, row.sectionHeader);
  });
  context.fillStyle = '#59675f';
  setFont(context, BODY_FONT_SIZE * scale);
  drawLines(context, layout.noteLines, IMAGE_MARGIN, layout.noteTop, BODY_LINE_HEIGHT, layout.contentWidth, scale);
}

function getCanvas(page) {
  return new Promise((resolve, reject) => {
    const query = typeof page.createSelectorQuery === 'function'
      ? page.createSelectorQuery() : wx.createSelectorQuery().in(page);
    query.select('#report-export-canvas').fields({ node: true, size: true }).exec(results => {
      const canvas = results && results[0] && results[0].node;
      if (!canvas || typeof canvas.getContext !== 'function') {
        reject(new Error('导出画布尚未就绪，请重试'));
        return;
      }
      resolve(canvas);
    });
  });
}

function exportCanvas(canvas, page, width, height) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas, x: 0, y: 0, width, height,
      destWidth: width, destHeight: height, fileType: 'jpg', quality: 0.92,
      success: result => result.tempFilePath ? resolve(result.tempFilePath) : reject(new Error('未能生成报告图片，请重试')),
      fail: error => reject(new Error(error.errMsg || '生成报告图片失败，请重试'))
    }, page);
  });
}

/** 将完整报告矩阵连续绘制成一张本地 JPEG，返回临时路径及实际像素尺寸。 */
async function renderReportImage(page, document) {
  if (!page || !['object', 'function'].includes(typeof page)) throw new Error('导出页面无效');
  throwIfCancelled(document);
  if (activePages.has(page)) throw new Error('报告正在导出，请稍候');
  activePages.add(page);
  let canvas;
  try {
    canvas = await getCanvas(page);
    throwIfCancelled(document);
    // 先以最小画布测量，尺寸通过限制检查后才分配完整位图。
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前环境不支持报告图片导出');
    const layout = buildLayout(context, document);
    throwIfCancelled(document);
    const { width, height } = layout.output;
    canvas.width = width;
    canvas.height = height;
    drawImage(context, layout, document);
    throwIfCancelled(document);
    const path = await exportCanvas(canvas, page, width, height);
    throwIfCancelled(document);
    return { path, width, height };
  } finally {
    // 文件生成结束后释放大位图；页面已销毁时忽略节点清理失败。
    try {
      if (canvas) { canvas.width = 1; canvas.height = 1; }
    } catch (_) {}
    activePages.delete(page);
  }
}

module.exports = { renderReportImage };
