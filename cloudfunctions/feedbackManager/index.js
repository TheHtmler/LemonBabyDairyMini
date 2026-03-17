const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const DEVELOPER_OPENIDS = [
  'oYCao7fijm22dyl6C-tcYJo_G69A'
];

function isDeveloperOpenid(openid = '') {
  return DEVELOPER_OPENIDS.includes((openid || '').trim());
}

async function resolveBabyName(babyUid = '', babyName = '') {
  const trimmedName = (babyName || '').trim();
  if (trimmedName) {
    return trimmedName;
  }

  const trimmedBabyUid = (babyUid || '').trim();
  if (!trimmedBabyUid) {
    return '';
  }

  const res = await db.collection('baby_info').where({
    babyUid: trimmedBabyUid
  }).limit(1).get();

  return (res.data?.[0]?.name || '').trim();
}

async function submitFeedback(event = {}, openid = '') {
  const {
    type = '其他',
    content = '',
    contact = '',
    babyUid = '',
    babyName = '',
    userRole = '',
    userNickname = '',
    appVersion = '1.0.0',
    source = 'miniprogram',
    submitRoute = '',
    systemInfo = {},
    miniProgramInfo = {}
  } = event;

  const trimmedContent = (content || '').trim();
  const trimmedContact = (contact || '').trim();
  const resolvedBabyName = await resolveBabyName(babyUid, babyName);

  if (!openid) {
    return { ok: false, message: '缺少用户身份' };
  }

  if (!trimmedContent) {
    return { ok: false, message: '反馈内容不能为空' };
  }

  if (trimmedContent.length < 5) {
    return { ok: false, message: '反馈内容至少 5 个字' };
  }

  const result = await db.collection('feedback_messages').add({
    data: {
      type,
      content: trimmedContent,
      contact: trimmedContact,
      babyUid,
      babyName: resolvedBabyName,
      userRole,
      userNickname,
      openid,
      appVersion,
      source,
      submitRoute,
      systemInfo: {
        brand: systemInfo.brand || '',
        model: systemInfo.model || '',
        platform: systemInfo.platform || '',
        system: systemInfo.system || '',
        language: systemInfo.language || '',
        version: systemInfo.version || '',
        SDKVersion: systemInfo.SDKVersion || ''
      },
      miniProgramInfo: {
        envVersion: miniProgramInfo.envVersion || '',
        version: miniProgramInfo.version || ''
      },
      status: 'new',
      createdAt: db.serverDate(),
      clientCreatedAt: new Date().toISOString()
    }
  });

  return {
    ok: true,
    id: result._id
  };
}

async function listFeedbacks(event = {}, openid = '') {
  if (!isDeveloperOpenid(openid)) {
    return { ok: false, message: '无权限查看反馈列表' };
  }

  const statusFilter = event.statusFilter || 'all';
  let query = db.collection('feedback_messages');

  if (statusFilter !== 'all') {
    query = query.where({ status: statusFilter });
  }

  const res = await query.orderBy('createdAt', 'desc').limit(100).get();

  return {
    ok: true,
    data: res.data || []
  };
}

async function updateFeedbackStatus(event = {}, openid = '') {
  if (!isDeveloperOpenid(openid)) {
    return { ok: false, message: '无权限更新反馈状态' };
  }

  const { id = '', status = '' } = event;

  if (!id) {
    return { ok: false, message: '缺少反馈记录标识' };
  }

  if (!['new', 'processed'].includes(status)) {
    return { ok: false, message: '状态参数无效' };
  }

  await db.collection('feedback_messages').doc(id).update({
    data: {
      status,
      updatedAt: db.serverDate()
    }
  });

  return { ok: true };
}

async function deleteFeedback(event = {}, openid = '') {
  if (!isDeveloperOpenid(openid)) {
    return { ok: false, message: '无权限删除反馈' };
  }

  const { id = '' } = event;

  if (!id) {
    return { ok: false, message: '缺少反馈记录标识' };
  }

  await db.collection('feedback_messages').doc(id).remove();

  return { ok: true };
}

exports.main = async (event = {}, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || '';

  try {
    if (action === 'submit') {
      return await submitFeedback(event, OPENID);
    }

    if (action === 'list') {
      return await listFeedbacks(event, OPENID);
    }

    if (action === 'updateStatus') {
      return await updateFeedbackStatus(event, OPENID);
    }

    if (action === 'delete') {
      return await deleteFeedback(event, OPENID);
    }

    return { ok: false, message: '不支持的操作类型' };
  } catch (error) {
    console.error('feedbackManager failed:', error);
    return {
      ok: false,
      message: error.message || '反馈服务处理失败'
    };
  }
};
