const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function normalizeText(value = '') {
  return String(value || '').trim();
}

function getOpenidSuffix(openid = '') {
  const text = String(openid || '');
  return text ? text.slice(-6) : '';
}

async function assertCreator(openid, babyUid) {
  if (!openid) {
    return { ok: false, message: '缺少用户身份' };
  }
  if (!babyUid) {
    return { ok: false, message: '缺少宝宝标识' };
  }

  const creatorRes = await db.collection('baby_creators').where({
    _openid: openid,
    babyUid
  }).limit(1).get();

  if (!creatorRes.data || creatorRes.data.length === 0) {
    return { ok: false, message: '无权限管理成员' };
  }

  return { ok: true };
}

async function findParticipant(babyUid, participantId) {
  if (!participantId) return null;

  const participantRes = await db.collection('baby_participants').where({
    _id: participantId,
    babyUid
  }).limit(1).get();

  return (participantRes.data && participantRes.data[0]) || null;
}

async function listParticipants(babyUid) {
  const res = await db.collection('baby_participants').where({ babyUid }).get();
  const participants = (res.data || []).map((item) => ({
    _id: item._id,
    displayName: item.displayName || '',
    creatorRemark: item.creatorRemark || '',
    joinedAt: item.joinedAt || item.createdAt || null,
    openidSuffix: getOpenidSuffix(item._openid)
  }));

  return { ok: true, participants };
}

async function updateRemark(event, operatorOpenid) {
  const { babyUid, participantId } = event;
  const participant = await findParticipant(babyUid, participantId);
  if (!participant) {
    return { ok: false, message: '未找到参与者' };
  }

  const creatorRemark = normalizeText(event.creatorRemark).slice(0, 24);
  await db.collection('baby_participants').doc(participant._id).update({
    data: {
      creatorRemark,
      creatorRemarkUpdatedAt: db.serverDate(),
      creatorRemarkUpdatedBy: operatorOpenid,
      updatedAt: db.serverDate()
    }
  });

  return { ok: true, creatorRemark };
}

async function removeParticipant(event, operatorOpenid) {
  const { babyUid, participantId } = event;
  const participant = await findParticipant(babyUid, participantId);
  if (!participant) {
    return { ok: false, message: '未找到参与者' };
  }
  if (participant._openid === operatorOpenid) {
    return { ok: false, message: '不能解除自己的创建者账号' };
  }

  await db.collection('baby_participants').doc(participant._id).remove();

  return { ok: true };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'list';
  const babyUid = event.babyUid || '';

  try {
    const permission = await assertCreator(OPENID, babyUid);
    if (!permission.ok) return permission;

    if (action === 'list') {
      return await listParticipants(babyUid);
    }
    if (action === 'updateRemark') {
      return await updateRemark(event, OPENID);
    }
    if (action === 'remove') {
      return await removeParticipant(event, OPENID);
    }

    return { ok: false, message: '不支持的成员操作' };
  } catch (error) {
    console.error('管理参与者失败:', error);
    return {
      ok: false,
      message: error.message || '成员管理失败'
    };
  }
};

exports._internal = {
  getOpenidSuffix,
  normalizeText
};
