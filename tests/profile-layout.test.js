const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('profile info card and menu card share the same outer width', () => {
  const wxss = fs.readFileSync('miniprogram/pages/profile/index.wxss', 'utf8');

  assert.match(wxss, /\.user-info\s*\{[\s\S]*width:\s*100%/);
  assert.match(wxss, /\.user-info\s*\{[\s\S]*box-sizing:\s*border-box/);
  assert.match(wxss, /\.menu-container\s*\{[\s\S]*width:\s*100%/);
});
