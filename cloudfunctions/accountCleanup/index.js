const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const BABY_SCOPED_COLLECTIONS = [
  'feeding_records',
  'feeding_records_v2',
  'food_intake_records',
  'medication_records',
  'treatment_records',
  'bowel_records',
  'growth_records',
  'growth_records_v2',
  'growth_milestones',
  'medications',
  'nutrition_settings',
  'milk_nutrition_profiles',
  'daily_summary_v2',
  'day_calendar_marks',
  'participant_unbind_logs',
  'audit_logs'
];

function ok(extra = {}) {
  return { ok: true, ...extra };
}

function fail(message, extra = {}) {
  return { ok: false, message, ...extra };
}

function isMissingCollectionError(error) {
  const message = String(error?.message || error?.errMsg || '');
  return error?.errCode === -502005
    || /collection.*(not exist|does not exist)|集合.*(不存在|未找到)/i.test(message);
}

async function getCreator(openid, babyUid) {
  if (!openid || !babyUid) return null;
  const res = await db.collection('baby_creators').where({
    _openid: openid,
    babyUid
  }).limit(1).get();
  return (res.data && res.data[0]) || null;
}

async function getParticipant(openid, babyUid) {
  if (!openid || !babyUid) return null;
  const res = await db.collection('baby_participants').where({
    _openid: openid,
    babyUid
  }).limit(1).get();
  return (res.data && res.data[0]) || null;
}

async function getBabyInfo(babyUid) {
  const res = await db.collection('baby_info').where({ babyUid }).limit(1).get();
  return (res.data && res.data[0]) || null;
}

async function removeByBabyUid(collectionName, babyUid) {
  try {
    const res = await db.collection(collectionName).where({ babyUid }).remove();
    return {
      collectionName,
      removed: res?.stats?.removed || 0
    };
  } catch (error) {
    if (isMissingCollectionError(error)) {
      return {
        collectionName,
        removed: 0,
        skipped: true
      };
    }
    throw error;
  }
}

async function deleteAvatarFile(babyInfo) {
  const fileId = babyInfo && babyInfo.avatarFileId;
  if (!fileId) return null;

  try {
    await cloud.deleteFile({ fileList: [fileId] });
    return fileId;
  } catch (error) {
    console.error('删除宝宝头像文件失败:', error);
    return null;
  }
}

async function cancelCreatorAccount(openid, babyUid) {
  const creator = await getCreator(openid, babyUid);
  if (!creator) {
    return fail('只有创建者可以注销账号');
  }

  const babyInfo = await getBabyInfo(babyUid);
  const deletedAvatarFileId = await deleteAvatarFile(babyInfo);
  const removals = [];

  for (const collectionName of BABY_SCOPED_COLLECTIONS) {
    removals.push(await removeByBabyUid(collectionName, babyUid));
  }

  removals.push(await removeByBabyUid('baby_participants', babyUid));
  removals.push(await removeByBabyUid('baby_creators', babyUid));
  removals.push(await removeByBabyUid('baby_info', babyUid));

  return ok({
    action: 'cancelCreatorAccount',
    babyUid,
    deletedAvatarFileId,
    removals
  });
}

async function unbindParticipant(openid, babyUid) {
  const participant = await getParticipant(openid, babyUid);
  if (!participant) {
    return fail('未找到可解绑的参与者身份');
  }

  const res = await db.collection('baby_participants').where({
    babyUid,
    _openid: openid
  }).remove();

  return ok({
    action: 'unbindParticipant',
    babyUid,
    removed: res?.stats?.removed || 0
  });
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || '';
  const babyUid = event.babyUid || '';

  if (!OPENID) {
    return fail('缺少用户身份');
  }
  if (!babyUid) {
    return fail('缺少宝宝标识');
  }

  try {
    if (action === 'cancelCreatorAccount') {
      return await cancelCreatorAccount(OPENID, babyUid);
    }
    if (action === 'unbindParticipant') {
      return await unbindParticipant(OPENID, babyUid);
    }

    return fail('不支持的账号操作');
  } catch (error) {
    console.error('账号清理失败:', error);
    return fail(error.message || '账号清理失败');
  }
};

exports._internal = {
  BABY_SCOPED_COLLECTIONS,
  isMissingCollectionError
};
