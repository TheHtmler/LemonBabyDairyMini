const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const pageJs = path.join('miniprogram', 'pages', 'data-records-v2', 'index.js');
const pageWxml = path.join('miniprogram', 'pages', 'data-records-v2', 'index.wxml');
const pageWxss = path.join('miniprogram', 'pages', 'data-records-v2', 'index.wxss');

test('data-records page wires medicationDayStats into processMedicationData', () => {
  const source = fs.readFileSync(pageJs, 'utf8');
  assert.match(source, /medicationDayStats/);
  assert.match(source, /buildMedicationDayStats/);
  assert.match(source, /medicationStats/);
  assert.match(source, /processMedicationData/);
});

test('applyDailyRecordTabDetails medication path calls processMedicationData', () => {
  const source = fs.readFileSync(pageJs, 'utf8');
  const fnMatch = source.match(/applyDailyRecordTabDetails\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*\},/);
  assert.ok(fnMatch, 'applyDailyRecordTabDetails function body should exist');
  const body = fnMatch[1];
  const medicationBranch = body.match(/if\s*\(\s*tab\s*===\s*['"]medication['"]\s*\)\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(medicationBranch, 'medication branch should exist in applyDailyRecordTabDetails');
  assert.match(medicationBranch[1], /processMedicationData/);
  assert.doesNotMatch(medicationBranch[1], /medicationRecords:\s*details\.medicationRecords/);
});

test('medication tab renders stats row from medicationStats', () => {
  const template = fs.readFileSync(pageWxml, 'utf8');
  assert.match(template, /medication-stats-row/);
  assert.match(template, /medicationStats/);
  assert.match(template, /medication-stat-pill/);
  assert.match(template, /dosageText/);
});

test('medication stats styles exist', () => {
  const styles = fs.readFileSync(pageWxss, 'utf8');
  assert.match(styles, /\.medication-stats-row/);
  assert.match(styles, /\.medication-stat-pill/);
});
