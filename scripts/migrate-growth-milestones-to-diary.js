#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { mapMilestoneToDiary } = require('../miniprogram/utils/growthDiaryUtils');

const input = process.argv[2];
const output = process.argv[3] || path.join(process.cwd(), 'growth_diary.import.json');
if (!input) {
  console.error('Usage: node scripts/migrate-growth-milestones-to-diary.js <milestones.json> [out.json]');
  process.exit(1);
}

/**
 * 云开发控制台导出走 NDJSON（每行一条）或 JSON 数组，两种都支持。
 */
function parseExport(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];

  // 优先按标准 JSON（数组 / { data|list }）解析
  try {
    const raw = JSON.parse(trimmed);
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.data)) return raw.data;
      if (Array.isArray(raw.list)) return raw.list;
    }
  } catch (_) {
    // 再试 NDJSON
  }

  const list = [];
  const lines = trimmed.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      list.push(JSON.parse(line));
    } catch (err) {
      throw new Error(`NDJSON parse failed at line ${i + 1}: ${err.message}`);
    }
  }
  return list;
}

const list = parseExport(fs.readFileSync(input, 'utf8'));
const mapped = list.map(mapMilestoneToDiary);
// 云开发「导入」要求 JSON Lines（每行一条 JSON），不能用数组
const ndjson = `${mapped.map((row) => JSON.stringify(row)).join('\n')}\n`;
fs.writeFileSync(output, ndjson);
console.log(`Wrote ${mapped.length} records (JSON Lines) to ${output}`);
