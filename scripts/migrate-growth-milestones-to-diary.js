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
const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
const list = Array.isArray(raw) ? raw : (raw.data || raw.list || []);
const mapped = list.map(mapMilestoneToDiary);
fs.writeFileSync(output, JSON.stringify(mapped, null, 2));
console.log(`Wrote ${mapped.length} records to ${output}`);
