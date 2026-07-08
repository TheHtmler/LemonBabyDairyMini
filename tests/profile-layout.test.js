const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('profile info card and menu sections share the same outer width', () => {
  const wxss = fs.readFileSync('miniprogram/pages/profile/index.wxss', 'utf8');
  const wxml = fs.readFileSync('miniprogram/pages/profile/index.wxml', 'utf8');

  assert.match(wxss, /\.profile-container\s*\{[\s\S]*width:\s*100%/);
  assert.match(wxss, /\.user-info\s*\{[\s\S]*width:\s*100%/);
  assert.match(wxss, /\.user-info\s*\{[\s\S]*box-sizing:\s*border-box/);
  assert.match(wxss, /\.menu-sections\s*\{[\s\S]*width:\s*100%/);
  assert.match(wxss, /\.menu-container\s*\{[\s\S]*width:\s*100%/);
  assert.match(wxss, /\.menu-section-header/);
  assert.match(wxss, /\.menu-section-accent/);
  assert.match(wxml, /visibleMenuGroups/);
  assert.match(wxml, /menu-section-title/);
  assert.match(wxml, /menu-section-header/);
});
