const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pageDir = path.join(__dirname, '..', 'miniprogram', 'pkg-records', 'water-record');

test('water-record page uses lemon vessel overlay and looping canvas wave', () => {
  const wxml = fs.readFileSync(path.join(pageDir, 'index.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(pageDir, 'index.js'), 'utf8');
  const wxss = fs.readFileSync(path.join(pageDir, 'index.wxss'), 'utf8');
  const vessel = path.join(pageDir, 'images', 'lemon-water-vessel.png');

  assert.equal(fs.existsSync(vessel), true);
  assert.match(wxml, /<canvas[\s\S]*type="2d"/);
  assert.match(wxml, /lemon-water-vessel\.png/);
  assert.match(wxml, /记喝水/);
  assert.match(wxml, /水位仅表示已记录量/);
  assert.match(wxml, /sheetVisible/);
  assert.match(wxml, /amount-bar/);
  assert.match(wxml, /chip-scroll/);
  assert.match(wxml, /listVisible/);
  assert.match(wxml, /canvasVisible/);
  assert.match(wxml, /water-static/);
  assert.match(wxml, /staticFillPercent/);
  assert.match(wxml, /compact-picker/);
  assert.match(wxml, /compact-input/);
  assert.match(wxml, /notes-area/);
  assert.match(wxml, /sheet-footer/);
  assert.match(wxml, /wx:if="\{\{sheetVisible\}\}"/);
  assert.doesNotMatch(wxml, /推荐|目标|建议饮水/);
  assert.doesNotMatch(wxml, /vesselBob|is-bobbing|ambient-bubble|amount-overlay/);
  assert.match(js, /WaterRecordModel/);
  assert.match(js, /requestAnimationFrame/);
  assert.match(js, /wavePhase/);
  assert.match(js, /VISUAL_HALF_ML/);
  assert.match(js, /VISUAL_MAX_RATIO/);
  assert.match(js, /QUICK_VOLUMES = \[20, 30, 50, 80, 100, 150, 200, 250\]/);
  assert.match(js, /volume \/ \(volume \+ VISUAL_HALF_ML\)/);
  assert.match(js, /playSaveCelebration/);
  assert.match(js, /animateTotalMl/);
  assert.match(js, /setCanvasVisible/);
  assert.match(js, /syncStaticFill/);
  assert.match(js, /buildEditForm/);
  assert.match(js, /openRecordSheetForEditById/);
  assert.match(js, /onNotesInput/);
  assert.match(js, /WATER_TOP/);
  assert.match(js, /WATER_BOTTOM/);
  assert.match(js, /createLinearGradient/);
  assert.match(js, /sampleWaveY/);
  assert.match(js, /amp1/);
  assert.doesNotMatch(js, /vesselBob/);
  assert.doesNotMatch(js, /fillRect\(/);
  assert.match(wxml, /water-drop/);
  assert.match(wxss, /#FFB800/);
  assert.match(wxss, /\.quick-row/);
  assert.match(wxss, /width:\s*100%/);
  assert.match(wxss, /margin:\s*0/);
  assert.match(wxss, /box-sizing:\s*border-box/);
  assert.match(wxss, /\.save-btn::after/);
  assert.match(wxss, /@keyframes drop-fall/);
  assert.match(wxss, /@keyframes amount-pop/);
  assert.doesNotMatch(wxss, /mask-image/);
  assert.doesNotMatch(wxss, /vessel-bob|orb-drift/);
});

test('computeFillRatio never reaches a full vessel', () => {
  const js = fs.readFileSync(path.join(pageDir, 'index.js'), 'utf8');
  const halfMatch = js.match(/const VISUAL_HALF_ML = (\d+)/);
  const maxMatch = js.match(/const VISUAL_MAX_RATIO = ([0-9.]+)/);
  assert.ok(halfMatch && maxMatch, 'visual fill constants should exist');
  const VISUAL_HALF_ML = Number(halfMatch[1]);
  const VISUAL_MAX_RATIO = Number(maxMatch[1]);
  const computeFillRatio = (totalMl) => {
    const volume = Math.max(0, Number(totalMl) || 0);
    if (volume <= 0) return 0;
    return Math.min(VISUAL_MAX_RATIO, volume / (volume + VISUAL_HALF_ML));
  };
  assert.equal(computeFillRatio(0), 0);
  assert.ok(computeFillRatio(VISUAL_HALF_ML) > 0.45 && computeFillRatio(VISUAL_HALF_ML) < 0.55);
  assert.ok(computeFillRatio(2000) < 0.85);
  assert.ok(computeFillRatio(99999) <= VISUAL_MAX_RATIO);
});

test('ui conventions doc covers button alignment rule', () => {
  const doc = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'miniprogram', 'ui-conventions.md'),
    'utf8'
  );
  assert.match(doc, /按钮对齐/);
  assert.match(doc, /width:\s*100%/);
  assert.match(doc, /::after/);
  assert.match(doc, /compact-picker/);
});
