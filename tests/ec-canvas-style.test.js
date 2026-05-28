const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('ec-canvas supports dashed right-axis lines and diamond markers', () => {
  const source = fs.readFileSync(
    require.resolve('../miniprogram/pkg-records/components/ec-canvas/ec-canvas.js'),
    'utf8'
  );

  assert.match(source, /setLineDash/);
  assert.match(source, /lineDash/);
  assert.match(source, /dotShape === 'diamond'/);
  assert.match(source, /axisLabel/);
});

test('ec-canvas supports explicit x-axis label interval', () => {
  const source = fs.readFileSync(
    require.resolve('../miniprogram/pkg-records/components/ec-canvas/ec-canvas.js'),
    'utf8'
  );

  assert.match(source, /xAxisLabelInterval/);
});

test('ec-canvas supports draggable crosshair guide line', () => {
  const source = fs.readFileSync(
    require.resolve('../miniprogram/pkg-records/components/ec-canvas/ec-canvas.js'),
    'utf8'
  );
  const wxml = fs.readFileSync(
    require.resolve('../miniprogram/pkg-records/components/ec-canvas/ec-canvas.wxml'),
    'utf8'
  );

  assert.match(source, /crosshairVisible/);
  assert.match(source, /showCrosshair/);
  assert.match(source, /crosshairX/);
  assert.match(source, /defaultCrosshairIndex/);
  assert.match(source, /keepCrosshairVisible/);
  assert.match(source, /defaultCrosshairTooltipVisible/);
  assert.match(source, /hideTooltipOnly/);
  assert.match(wxml, /bindtouchmove/);
  assert.match(wxml, /crosshair-line/);
});
