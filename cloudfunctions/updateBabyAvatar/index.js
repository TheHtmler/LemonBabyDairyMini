const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event = {}, context) => {
  const { OPENID } = cloud.getWXContext();
  const { babyUid, avatarFileId, avatarUrl } = event || {};

  if (!OPENID) {
    return { ok: false, message: '缺少用户身份' };
  }
  if (!babyUid || !avatarFileId || !avatarUrl) {
    return { ok: false, message: '参数缺失' };
  }

  const creatorRes = await db.collection('baby_creators').where({
    _openid: OPENID,
    babyUid
  }).limit(1).get();

  const participantRes = creatorRes.data && creatorRes.data.length > 0
    ? { data: [] }
    : await db.collection('baby_participants').where({
      _openid: OPENID,
      babyUid
    }).limit(1).get();

  const hasPermission =
    (creatorRes.data && creatorRes.data.length > 0) ||
    (participantRes.data && participantRes.data.length > 0);

  if (!hasPermission) {
    return { ok: false, message: '无权限更新头像' };
  }

  const babyRes = await db.collection('baby_info').where({ babyUid }).limit(1).get();
  if (babyRes.data && babyRes.data.length > 0) {
    await db.collection('baby_info').doc(babyRes.data[0]._id).update({
      data: {
        avatarUrl,
        avatarFileId,
        updatedAt: db.serverDate()
      }
    });
  } else {
    await db.collection('baby_info').add({
      data: {
        babyUid,
        avatarUrl,
        avatarFileId,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });
  }

  return { ok: true };
};
