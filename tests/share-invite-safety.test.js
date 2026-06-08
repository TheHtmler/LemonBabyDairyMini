const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readMiniProgramFile(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, `../miniprogram/${relativePath}`), 'utf8');
}

function extractPageShareHandler(source) {
  const match = source.match(/\n\s*onShareAppMessage\s*\([^)]*\)\s*\{[\s\S]{0,600}?\n\s{2}\},?/);
  return match ? match[0] : '';
}

test('ordinary page shares do not carry invite codes', () => {
  [
    'pages/profile/index.js',
    'pages/data-records-v2/index.js',
    'pages/analysis-report/index.js'
  ].forEach((filePath) => {
    const handler = extractPageShareHandler(readMiniProgramFile(filePath));
    assert.ok(handler, `${filePath} should expose page share handler`);
    assert.doesNotMatch(handler, /inviteCode/, `${filePath} page share should not read inviteCode`);
    assert.doesNotMatch(handler, /getShareInfo/, `${filePath} page share should not use invitation share`);
    assert.doesNotMatch(handler, /role-selection\/index\?inviteCode=/, `${filePath} page share should not include inviteCode path`);
  });
});

test('dedicated invite surfaces still provide invite-code sharing', () => {
  const shareData = readMiniProgramFile('pkg-misc/share-data/index.js');
  const babyInfo = readMiniProgramFile('pkg-misc/baby-info/index.js');

  assert.match(shareData, /role-selection\/index\?inviteCode=/);
  assert.match(babyInfo, /onShareInviteCode\(\)/);
  assert.match(babyInfo, /InvitationModel\.getShareInfo/);
});

test('invite link join flow asks for confirmation before adding participant', () => {
  const roleSelection = readMiniProgramFile('pages/role-selection/index.js');
  const joinBody = roleSelection.match(/async joinByInviteCode\(inviteCode\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const confirmIndex = joinBody.indexOf('wx.showModal');
  const addIndex = joinBody.indexOf('InvitationModel.addParticipant');

  assert.ok(confirmIndex >= 0, 'join flow should show a confirmation modal');
  assert.ok(addIndex >= 0, 'join flow should add participant after confirmation');
  assert.ok(confirmIndex < addIndex, 'confirmation should happen before adding participant');
});
