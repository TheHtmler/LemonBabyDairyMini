// 多宝宝绑定关系的小工具：一个微信账号可作为创建者/参与者绑定多个宝宝。
// 注意：宝宝之间的数据（食物、食谱、奶粉等）是相互隔离的，
// 需要迁移时走 utils/babyDataImport.js 的一次性导入，不做实时共享。

function uniqueBabyUids(values = []) {
  const seen = new Set();
  const result = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const babyUid = String(value || '').trim();
    if (!babyUid || seen.has(babyUid)) return;
    seen.add(babyUid);
    result.push(babyUid);
  });
  return result;
}

function conditionLabel(condition = '') {
  if (condition === 'PA') return '丙酸血症';
  if (condition === 'other') return '其他';
  return '甲基丙二酸血症';
}

// 注销/删除某个宝宝后，从可访问列表里挑出下一个要切换的宝宝
function pickNextBaby(babies = [], removedBabyUid = '') {
  const removed = String(removedBabyUid || '').trim();
  return (Array.isArray(babies) ? babies : []).find((item) => item && item.babyUid && item.babyUid !== removed) || null;
}

module.exports = {
  uniqueBabyUids,
  conditionLabel,
  pickNextBaby
};
