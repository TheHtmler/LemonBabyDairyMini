const DEVELOPER_OPENIDS = [
  'oYCao7fijm22dyl6C-tcYJo_G69A'
];

function isDeveloperOpenid(openid = '') {
  return DEVELOPER_OPENIDS.includes((openid || '').trim());
}

module.exports = {
  DEVELOPER_OPENIDS,
  isDeveloperOpenid
};
