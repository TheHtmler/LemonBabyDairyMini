const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('avatar upload calls content security check before resolving avatar url', () => {
  const source = fs.readFileSync('miniprogram/pkg-misc/baby-info/index.js', 'utf8');

  assert.match(source, /async verifyUploadedAvatarSafety\(avatarFileId\)/);
  assert.match(source, /name:\s*'checkAvatarSecurity'/);
  assert.match(source, /await this\.verifyUploadedAvatarSafety\(result\.fileID\)/);
  assert.match(source, /头像含有违规内容，请更换后再试/);
});

test('profile avatar upload also checks content security before saving avatar', () => {
  const source = fs.readFileSync('miniprogram/pages/profile/index.js', 'utf8');

  assert.match(source, /async verifyUploadedAvatarSafety\(avatarFileId\)/);
  assert.match(source, /name:\s*'checkAvatarSecurity'/);
  assert.match(source, /await this\.verifyUploadedAvatarSafety\(result\.fileID\)/);
  assert.match(source, /头像含有违规内容，请更换后再试/);
});

test('avatar security cloud function uses imgSecCheck and returns user-facing violation message', () => {
  const source = fs.readFileSync('cloudfunctions/checkAvatarSecurity/index.js', 'utf8');
  const config = JSON.parse(fs.readFileSync('cloudfunctions/checkAvatarSecurity/config.json', 'utf8'));

  assert.deepEqual(config.permissions.openapi, ['security.imgSecCheck']);
  assert.match(source, /cloud\.openapi\.security\.imgSecCheck/);
  assert.match(source, /downloadFile\(\{\s*fileID:\s*avatarFileId\s*\}\)/);
  assert.match(source, /deleteFile\(\{\s*fileList:\s*\[avatarFileId\]\s*\}\)/);
  assert.match(source, /头像含有违规内容，请更换后再试/);
});
