// 格式层只处理传入内容，不访问页面、文件系统或网络，兼容小程序运行环境。
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// 不依赖 Node Buffer 或浏览器 TextEncoder，孤立代理项统一替换为合法字符。
function utf8(value) {
  const bytes = [];
  for (const character of String(value)) {
    let code = character.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return new Uint8Array(bytes);
}

function concatenate(parts) {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  parts.forEach(part => { result.set(part, offset); offset += part.byteLength; });
  return result.buffer;
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  CRC_TABLE[index] = value >>> 0;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// 使用无压缩 ZIP：文件数量固定且较少，避免引入压缩库和小程序运行时依赖。
function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  files.forEach(file => {
    const name = utf8(file.name);
    const data = utf8(file.content);
    const checksum = crc32(data);
    if (offset + 30 + name.length + data.length > 0xffffffff) throw new Error('导出内容过大，无法生成工作簿');
    const local = new Uint8Array(30);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(12, 0x0021, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localParts.push(local, name, data);

    const central = new Uint8Array(46);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(14, 0x0021, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  });
  const centralLength = centralParts.reduce((total, part) => total + part.length, 0);
  if (offset + centralLength > 0xffffffff) throw new Error('导出内容过大，无法生成工作簿');
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralLength, true);
  endView.setUint32(16, offset, true);
  return concatenate([...localParts, ...centralParts, end]);
}

function cellText(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (text.length > 32767) throw new Error('单元格文字超过 Excel 的长度限制');
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');
}

function escapeXml(value) {
  return value.replace(/_x([0-9a-f]{4})_/gi, '_x005F_x$1_')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function columnName(index) {
  let name = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
}

function textWidth(value) {
  return Array.from(value).reduce((width, character) => width + (character.codePointAt(0) > 255 ? 2 : 1), 0);
}

function rowHeight(values, widths, minimum) {
  const lines = values.reduce((maximum, value, index) => Math.max(maximum,
    value.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(textWidth(line) / Math.max(1, widths[index] - 2))), 0)), 1);
  return Math.min(409, Math.max(minimum, lines * 15 + 10));
}

function sheetRow(values, index, style, widths, minimum) {
  const cells = values.map((value, column) => '<c r="' + columnName(column) + index + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' + escapeXml(value) + '</t></is></c>').join('');
  return '<row r="' + index + '" ht="' + rowHeight(values, widths, minimum) + '" customHeight="1">' + cells + '</row>';
}

function buildStyles() {
  const alignment = '<alignment vertical="center" wrapText="1"/>';
  return XML_HEADER + '<styleSheet xmlns="' + SHEET_NS + '">'
    + '<fonts count="4"><font><sz val="11"/><name val="Calibri"/><color rgb="FF263A2B"/></font><font><b/><sz val="18"/><name val="Calibri"/><color rgb="FF263A2B"/></font><font><sz val="10"/><name val="Calibri"/><color rgb="FF5F6D5C"/></font><font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF376C55"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFE0E5D9"/></bottom><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="4"><xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">' + alignment + '</xf>'
    + '<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1" applyAlignment="1">' + alignment + '</xf>'
    + '<xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1" applyAlignment="1">' + alignment + '</xf>'
    + '<xf numFmtId="49" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyAlignment="1">' + alignment + '</xf></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}

// 所有内容使用内联文本单元格，不创建公式或外部链接；数字零不会因真假判断丢失。
function buildXlsx(options = {}) {
  const { title, subtitle, headers, rows, columnWidths = [], sectionRows = [], filterRowCount } = options;
  if (!Array.isArray(headers) || !headers.length || headers.length > 16384 || !Array.isArray(rows)) throw new Error('工作簿需要有效的表头和数据行');
  if (!Array.isArray(columnWidths)) throw new Error('列宽必须为数组');
  if (!Array.isArray(sectionRows) || sectionRows.some(index => !Number.isInteger(index) || index < 0 || index >= rows.length)) throw new Error('工作簿分区行标识无效');
  const sections = new Set(sectionRows);
  const filterRows = filterRowCount === undefined ? rows.length : filterRowCount;
  if (!Number.isInteger(filterRows) || filterRows < 0 || filterRows > rows.length) throw new Error('工作簿筛选行数无效');
  const heading = headers.map(cellText);
  const content = rows.map(row => {
    if (!Array.isArray(row) || row.length > headers.length) throw new Error('数据行列数不能超过表头');
    return heading.map((value, index) => cellText(row[index]));
  });
  const titleText = cellText(title);
  const subtitleText = cellText(subtitle);
  const headerRow = subtitleText ? 3 : 2;
  const lastRow = headerRow + content.length;
  const lastFilterRow = headerRow + filterRows;
  if (lastRow > 1048576) throw new Error('数据行超过 Excel 的行数限制');
  const widths = heading.map((value, index) => {
    const configured = Number(columnWidths[index]);
    if (Number.isFinite(configured) && configured > 0) return Math.max(8, Math.min(80, configured));
    const widest = [value, ...content.map(row => row[index])].reduce((maximum, text) =>
      Math.max(maximum, ...text.split('\n').map(textWidth)), 0);
    return Math.max(index === 0 ? 20 : 14, Math.min(42, widest + 2));
  });
  const lastColumn = columnName(heading.length - 1);
  const mergedWidth = widths.reduce((total, width) => total + width, 0);
  const sheetRows = [sheetRow([titleText], 1, 1, [mergedWidth], 32)];
  if (subtitleText) sheetRows.push(sheetRow([subtitleText], 2, 2, [mergedWidth], 30));
  sheetRows.push(sheetRow(heading, headerRow, 3, widths, 32));
  content.forEach((row, index) => {
    const sectionHeader = sections.has(index);
    sheetRows.push(sheetRow(row, headerRow + index + 1, sectionHeader ? 3 : 0, widths, sectionHeader ? 32 : 28));
  });
  const mergedRows = heading.length > 1 ? [1, ...(subtitleText ? [2] : [])] : [];
  const columns = widths.map((width, index) => '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' + width + '" customWidth="1"/>').join('');
  const sheet = XML_HEADER + '<worksheet xmlns="' + SHEET_NS + '"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:' + lastColumn + lastRow + '"/>'
    + '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="' + headerRow + '" topLeftCell="B' + (headerRow + 1) + '" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="B' + (headerRow + 1) + '" sqref="B' + (headerRow + 1) + '"/></sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="28"/><cols>' + columns + '</cols><sheetData>' + sheetRows.join('') + '</sheetData>'
    + '<autoFilter ref="A' + headerRow + ':' + lastColumn + lastFilterRow + '"/>'
    + (mergedRows.length ? '<mergeCells count="' + mergedRows.length + '">' + mergedRows.map(row => '<mergeCell ref="A' + row + ':' + lastColumn + row + '"/>').join('') + '</mergeCells>' : '')
    + '<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
  return buildZip([
    { name: '[Content_Types].xml', content: XML_HEADER + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', content: XML_HEADER + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + REL_NS + '/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', content: XML_HEADER + '<workbook xmlns="' + SHEET_NS + '" xmlns:r="' + REL_NS + '"><sheets><sheet name="报告分析" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', content: XML_HEADER + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + REL_NS + '/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="' + REL_NS + '/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', content: buildStyles() },
    { name: 'xl/worksheets/sheet1.xml', content: sheet }
  ]);
}

// 从帧头读取实际图像参数，避免误将非 JPEG 数据写入 PDF。
function jpegInfo(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new Error('PDF 页面需要完整的 JPEG 图像');
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) break;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length < 8) break;
      const bits = bytes[offset + 2];
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const components = bytes[offset + 7];
      if (!width || !height || bits !== 8 || ![1, 3].includes(components) || length !== 8 + components * 3) throw new Error('PDF 仅支持 8 位 RGB 或灰度 JPEG 页面');
      return { width, height, colorSpace: components === 1 ? '/DeviceGray' : '/DeviceRGB' };
    }
    offset += length;
  }
  throw new Error('无法读取 JPEG 页面尺寸');
}

// 单张长图完整填满连续页面，固定宽度并按比例延伸高度；交叉引用按字节计数。
function buildPdf(image) {
  if (!image || Array.isArray(image) || !Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0) throw new Error('PDF 需要一张尺寸为正数的图片');
  const jpeg = image.jpeg instanceof Uint8Array ? image.jpeg : image.jpeg instanceof ArrayBuffer ? new Uint8Array(image.jpeg) : null;
  if (!jpeg) throw new Error('PDF 页面图像必须为二进制 JPEG');
  const info = jpegInfo(jpeg);
  if (image.width !== info.width || image.height !== info.height) throw new Error('PDF 页面尺寸与 JPEG 图像不一致');
  const pageWidth = 595.28;
  const pageHeight = pageWidth * image.height / image.width;
  // 不裁切、不分页，也不缩成普通 A4 高度；超出基础 PDF 页面限制时明确拒绝。
  if (pageHeight > 14400) throw new Error('长图超过 PDF 单页高度上限（14400 pt），请减少导出内容');
  const heightText = pageHeight.toFixed(3);
  const content = utf8('q\n595.28 0 0 ' + heightText + ' 0 0 cm\n/Im0 Do\nQ\n');
  const objects = [
    [utf8('<< /Type /Catalog /Pages 2 0 R >>')],
    [utf8('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')],
    [utf8('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 ' + heightText + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>')],
    [utf8('<< /Type /XObject /Subtype /Image /Width ' + info.width + ' /Height ' + info.height + ' /ColorSpace ' + info.colorSpace + ' /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.byteLength + ' >>\nstream\n'), jpeg, utf8('\nendstream')],
    [utf8('<< /Length ' + content.byteLength + ' >>\nstream\n'), content, utf8('endstream')]
  ];
  const parts = [new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10])];
  let offset = parts[0].byteLength;
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(offset);
    const entry = [utf8((index + 1) + ' 0 obj\n'), ...object, utf8('\nendobj\n')];
    entry.forEach(part => { parts.push(part); offset += part.byteLength; });
  });
  if (offset >= 10000000000) throw new Error('PDF 超过交叉引用表的长度限制');
  const xref = 'xref\n0 ' + offsets.length + '\n0000000000 65535 f \n'
    + offsets.slice(1).map(value => String(value).padStart(10, '0') + ' 00000 n \n').join('');
  parts.push(utf8(xref + 'trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + offset + '\n%%EOF\n'));
  return concatenate(parts);
}

module.exports = { buildXlsx, buildPdf };
