const ReportModel = require('../models/report');
const { toDateKey } = require('./reportWorkbench');

const textOf = value => value === null || value === undefined ? '' : String(value);
const resultText = row => [row.valueText, row.marker].filter(Boolean).join(' ');
const metricName = row => [row.name, row.abbr !== row.name ? row.abbr : ''].filter(Boolean).join('\n');

function buildReportExportDocument({ report, babyInfo, rows }) {
  const selectedRows = rows.filter(row => row.hasValue);
  const title = ReportModel.getReportTypeName(report.reportType) + '报告';
  const subtitle = [babyInfo?.babyName, toDateKey(report.reportDate), report.labName].filter(Boolean).join(' · ');
  return {
    title, subtitle, fileName: title + '_' + toDateKey(report.reportDate),
    babyUid: babyInfo?.babyUid, singleReport: true,
    nutritionColumns: [{ reportId: report._id || report.id || report.reportId || 'single-report',
      date: toDateKey(report.reportDate), labName: report.labName || '', isBaseline: true }],
    headers: ['检验项目', '检测值', '参考范围'], columnWidths: [34, 28, 38],
    excelColumnWidths: [32, 26, 36],
    bodyColumnStyles: ['body', 'value', 'muted'],
    rows: selectedRows.map(row => [metricName(row), resultText(row), row.rangeText || '—'])
  };
}

function buildComparisonExportDocument({ view, babyInfo, reportType }) {
  if (view.columns.length === 1) {
    const column = view.columns[0];
    return buildReportExportDocument({ babyInfo,
      report: { reportId: column.reportId, reportType, reportDate: column.date, labName: column.labName },
      rows: view.compareRows.map(row => ({ ...row.cells[0], name: row.name, abbr: row.abbr }))
    });
  }
  const title = ReportModel.getReportTypeName(reportType) + (view.canCompare ? '报告对比' : '报告');
  const subtitle = [babyInfo?.babyName, view.canCompare ? '对照：' + view.baselineLabel : '',
    view.compareRows.length + ' 项'].filter(Boolean).join(' · ');
  // 三种格式共用连续矩阵：每份报告一列，每个指标一行，完整保留当前筛选及列顺序。
  return { title, subtitle, fileName: title,
    babyUid: babyInfo?.babyUid, singleReport: false,
    nutritionColumns: view.columns.map(column => ({ ...column })),
    headers: ['检验项目', ...view.columns.map(column => [column.date, column.sameDayLabel,
      column.labName, view.canCompare && column.isBaseline ? '对照' : ''].filter(Boolean).join('\n'))],
    columnWidths: [320, ...view.columns.map(() => 280)],
    excelColumnWidths: [32, ...view.columns.map(() => 34)],
    bodyColumnStyles: ['body', ...view.columns.map(() => 'value')],
    rows: view.compareRows.map(row => {
      const cellsById = new Map(row.cells.map(cell => [cell.reportId, cell]));
      return [metricName(row), ...view.columns.map(column => {
        const cell = cellsById.get(column.reportId);
        if (!cell?.hasValue) return '—';
        const lines = [resultText(cell)];
        if (cell.rangeText) lines.push('范围 ' + cell.rangeText);
        if (view.canCompare && cell.isBaseline) lines.push('对照');
        else if (view.canCompare && cell.deltaComparable) lines.push('较对照 ' + cell.deltaText);
        else if (view.canCompare && cell.deltaReason) lines.push(cell.deltaReason);
        return lines.join('\n');
      })];
    })
  };
}

function appendNutritionSummary(document, summary) {
  const rows = document.rows.map(row => [...row]);
  const filterRowCount = rows.length;
  rows.push(document.headers.map(() => ''));
  const sectionIndex = rows.length;
  const columnsById = new Map(summary.columns.map(column => [column.reportId, column]));
  const columns = document.nutritionColumns;
  if (document.singleReport) {
    const column = columnsById.get(columns[0].reportId);
    rows.push(['检测前7天摄入汇总\n' + (column?.fullDateRange || ''), '日均摄入', '每公斤日均摄入']);
  } else {
    rows.push(['检测前7天摄入汇总', ...columns.map(column => columnsById.get(column.reportId)?.fullDateRange || '')]);
  }
  summary.rows.forEach(row => {
    const label = row.label;
    const cellsById = new Map(row.cells.map(cell => [cell.reportId, cell]));
    if (document.singleReport) {
      const cell = cellsById.get(columns[0].reportId);
      rows.push([label, cell?.validDays ? cell.averageText + ' ' + cell.unit : '—',
        row.valueKind === 'ratio' ? '' : cell?.coefficientDays ? cell.coefficientText + ' ' + cell.coefficientUnit : '—']);
    } else {
      rows.push([label, ...columns.map(column => {
        const cell = cellsById.get(column.reportId);
        if (!cell?.validDays) return '—';
        const lines = [cell.averageText + ' ' + cell.unit];
        if (row.valueKind !== 'ratio') {
          lines.push(cell.coefficientDays ? cell.coefficientText + ' ' + cell.coefficientUnit : '每公斤 —');
        }
        if (cell.isBaseline) lines.push('对照');
        else if (cell.deltaComparable) lines.push(cell.deltaText);
        return lines.join('\n');
      })]);
    }
  });
  return { ...document, rows, filterRowCount, sectionRows: [sectionIndex],
    fileName: document.fileName + '_含饮食汇总' };
}

function callWx(method, options) {
  return new Promise((resolve, reject) => {
    if (typeof wx[method] !== 'function') { reject(new Error('当前微信版本不支持此操作，请升级微信')); return; }
    wx[method]({ ...options, success: resolve, fail: reject });
  });
}

function readJpegFile(filePath) {
  // Latin-1 每个字符对应一个字节，读回后在当前运行环境构造 JPEG 字节数组。
  return new Promise((resolve, reject) => wx.getFileSystemManager().readFile({
    filePath, encoding: 'latin1', success: result => resolve(result.data), fail: reject
  })).then(data => {
    if (typeof data !== 'string') return data;
    const bytes = new Uint8Array(data.length);
    for (let index = 0; index < data.length; index++) bytes[index] = data.charCodeAt(index);
    return bytes;
  });
}

function writeFile(filePath, data) {
  return new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({
    filePath, data, success: resolve, fail: reject
  }));
}

function pageAvailable(page) { return !page._unloaded && !page._exportDisposed; }

async function openExportFile(filePath, fileType) {
  try {
    await callWx('openDocument', { filePath, fileType, showMenu: true });
  } catch (error) {
    if (/cancel/i.test(error.errMsg || '')) return;
    const result = await callWx('showModal', { title: '文件已生成',
      content: '当前设备无法预览，可转发文件后打开。', confirmText: '转发文件', cancelText: '关闭' });
    if (result.confirm) await callWx('shareFileMessage', { filePath });
  }
}

async function showReportExport(page, document) {
  if (page.data.exporting || !pageAvailable(page)) return;
  if (!document.rows?.length) { wx.showToast({ title: '暂无可导出的指标', icon: 'none' }); return; }
  const token = (page._exportToken || 0) + 1;
  page._exportToken = token;
  const isCurrent = () => pageAvailable(page) && page._exportToken === token;
  const endLoading = () => {
    if (page._exportLoadingToken === token) {
      wx.hideLoading();
      delete page._exportLoadingToken;
    }
    loading = false;
  };
  page.setData({ exporting: true });
  let loading = false;
  try {
    const scope = await callWx('showActionSheet', { itemList: ['仅导出报告', '报告＋饮食摄入汇总'] });
    if (!isCurrent()) return;
    const includeNutrition = scope.tapIndex === 1;
    const choice = await callWx('showActionSheet', { itemList: ['导出长图', '导出长版 PDF', '导出 Excel'] });
    if (!isCurrent()) return;
    const format = ['image', 'pdf', 'xlsx'][choice.tapIndex];
    if (!format) return;
    wx.showLoading({ title: includeNutrition ? '加载饮食汇总…' : '正在导出…', mask: true });
    page._exportLoadingToken = token;
    loading = true;
    let exportDocument = document;
    if (includeNutrition) {
      const { loadReportNutritionSummary } = require('./reportNutritionExport');
      const summary = await loadReportNutritionSummary({ babyUid: document.babyUid,
        columns: document.nutritionColumns, isCurrent });
      if (!isCurrent()) return;
      exportDocument = appendNutritionSummary(document, summary);
    }
    const { buildXlsx, buildPdf } = require('./reportExportFormats');
    let filePath = '';
    let image;
    if (format === 'xlsx') {
      const data = buildXlsx({ ...exportDocument, columnWidths: exportDocument.excelColumnWidths });
      filePath = exportPath(exportDocument.fileName, format);
      await writeFile(filePath, data);
    } else {
      const { renderReportImage } = require('./reportExportCanvas');
      wx.showLoading({ title: '正在生成长图…', mask: true });
      image = await renderReportImage(page, { ...exportDocument, isCancelled: () => !isCurrent() });
      if (!isCurrent()) return;
      if (format === 'pdf') {
        const jpeg = await readJpegFile(image.path);
        if (!isCurrent()) return;
        const data = buildPdf({ ...image, jpeg });
        filePath = exportPath(exportDocument.fileName, format);
        await writeFile(filePath, data);
      }
    }
    if (!isCurrent()) return;
    endLoading();
    if (format === 'image') {
      await callWx('previewImage', { urls: [image.path], current: image.path, showmenu: true });
    } else await openExportFile(filePath, format);
  } catch (error) {
    if (!isCurrent() || /cancel/i.test(error.errMsg || '')) return;
    console.error('导出报告失败:', error);
    if (loading) endLoading();
    wx.showToast({ title: error.message || '导出失败，请重试', icon: 'none' });
  } finally {
    if (loading) endLoading();
    if (isCurrent()) page.setData({ exporting: false });
  }
}

function exportPath(name, extension) {
  const safeName = textOf(name || '检测报告').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 48);
  return wx.env.USER_DATA_PATH + '/' + safeName + '_' + Date.now() + '.' + extension;
}

function cancelReportExport(page) {
  page._exportToken = (page._exportToken || 0) + 1;
  if (page._exportLoadingToken) { wx.hideLoading(); delete page._exportLoadingToken; }
  if (pageAvailable(page) && page.data.exporting) page.setData({ exporting: false });
}

module.exports = { buildReportExportDocument, buildComparisonExportDocument, showReportExport, cancelReportExport };
