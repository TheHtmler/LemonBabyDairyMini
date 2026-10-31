const cloud = require('wx-server-sdk');
const { createFeedbackThreadService, conversationVersion } = require('./thread');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database({ throwOnNotFound: false });
const command = db.command;
const FEEDBACK_TYPES = ['功能建议', '问题反馈', '体验吐槽', '其他'];
const USER_FIELDS = {
  _id: true, type: true, content: true, status: true, createdAt: true,
  clientCreatedAt: true, replyContent: true, repliedAt: true,
  replyVersion: true, readReplyVersion: true, hasUnreadReply: true,
  conversationVersion: true, followUpCount: true, lastUserContent: true,
  lastMessageContent: true, lastMessageRole: true, lastMessageAt: true
};

const DEVELOPER_OPENIDS = [
  'oYCao7fijm22dyl6C-tcYJo_G69A'
];

function isDeveloperOpenid(openid = '') {
  return DEVELOPER_OPENIDS.includes(text(openid));
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function fail(message, code = 'INVALID_ARGUMENT') {
  const error = new Error(message);
  error.code = code;
  error.isFeedbackError = true;
  throw error;
}

function requireAdmin(openid) {
  if (!isDeveloperOpenid(openid)) fail('当前账号无权管理反馈', 'FORBIDDEN');
}

function requireId(id) {
  if (typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id)) fail('反馈记录标识无效');
  return id;
}

function version(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function dateText(value) {
  const date = value instanceof Date ? value : new Date(value?.$date || value);
  return value && Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function toUserFeedback(item) {
  const replyVersion = version(item.replyVersion);
  const readReplyVersion = Math.min(version(item.readReplyVersion), replyVersion);
  return {
    _id: item._id,
    type: text(item.type) || '其他',
    content: text(item.content),
    status: item.status === 'processed' ? 'processed' : 'new',
    createdAt: dateText(item.createdAt) || dateText(item.clientCreatedAt),
    replyContent: text(item.replyContent),
    repliedAt: dateText(item.repliedAt),
    replyVersion,
    readReplyVersion,
    hasUnreadReply: replyVersion > readReplyVersion,
    conversationVersion: conversationVersion(item),
    followUpCount: version(item.followUpCount),
    lastUserContent: text(item.lastUserContent),
    lastMessageContent: text(item.lastMessageContent),
    lastMessageRole: item.lastMessageRole === 'admin' ? 'admin' : 'user',
    lastMessageAt: dateText(item.lastMessageAt)
  };
}

function toAdminFeedback(item) {
  const { lastReplyRequestId, lastReplyRequestFingerprint, ...metadata } = item;
  return { ...metadata, ...toUserFeedback(item) };
}

async function readFeedback(database, id, includeDeleting = false) {
  const result = await database.collection('feedback_messages').doc(id).get();
  if (!result.data || !result.data._id) {
    fail('该反馈不存在或暂时无法查看', 'NOT_FOUND');
  }
  if (result.data.deleting && !includeDeleting) fail('该反馈正在删除，请稍后重试', 'NOT_FOUND');
  return result.data;
}

async function checkText(content, openid) {
  let result;
  try {
    result = await cloud.openapi.security.msgSecCheck({ version: 2, scene: 2, openid, content });
  } catch (error) {
    if (Number(error.errCode || error.errcode) === 87014) fail('内容未通过安全检查，请调整后提交', 'CONTENT_REJECTED');
    console.error('反馈文本安全检查调用失败:', error.errCode || error.code || 'UNKNOWN');
    fail('内容安全检查暂不可用，请稍后重试', 'SECURITY_CHECK_FAILED');
  }
  const code = Number(result && (result.errCode || result.errcode)) || 0;
  const suggestion = result && result.result && result.result.suggest;
  if (code === 87014 || suggestion === 'risky' || suggestion === 'review') {
    fail('内容未通过安全检查，请调整后提交', 'CONTENT_REJECTED');
  }
  if (code !== 0 || suggestion !== 'pass') fail('内容安全检查暂不可用，请稍后重试', 'SECURITY_CHECK_FAILED');
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

  const trimmedContent = text(content);
  const trimmedContact = text(contact).slice(0, 100);

  if (!openid) {
    return { ok: false, message: '缺少用户身份' };
  }

  if (!trimmedContent) {
    return { ok: false, message: '反馈内容不能为空' };
  }

  if (trimmedContent.length < 5) {
    return { ok: false, message: '反馈内容至少 5 个字' };
  }

  if (trimmedContent.length > 500) fail('反馈内容不能超过 500 字');
  if (!FEEDBACK_TYPES.includes(type)) fail('反馈类型无效');
  await checkText(trimmedContent, openid);
  const resolvedBabyName = await resolveBabyName(text(babyUid), text(babyName));
  const device = systemInfo && typeof systemInfo === 'object' ? systemInfo : {};
  const mini = miniProgramInfo && typeof miniProgramInfo === 'object' ? miniProgramInfo : {};

  const result = await db.collection('feedback_messages').add({
    data: {
      type,
      content: trimmedContent,
      contact: trimmedContact,
      babyUid: text(babyUid),
      babyName: resolvedBabyName,
      userRole: text(userRole),
      userNickname: text(userNickname).slice(0, 100),
      openid,
      appVersion: text(appVersion).slice(0, 100),
      source: text(source).slice(0, 100),
      submitRoute: text(submitRoute).slice(0, 200),
      systemInfo: {
        brand: text(device.brand).slice(0, 100),
        model: text(device.model).slice(0, 100),
        platform: text(device.platform).slice(0, 100),
        system: text(device.system).slice(0, 100),
        language: text(device.language).slice(0, 100),
        version: text(device.version).slice(0, 100),
        SDKVersion: text(device.SDKVersion).slice(0, 100)
      },
      miniProgramInfo: {
        envVersion: text(mini.envVersion).slice(0, 100),
        version: text(mini.version).slice(0, 100)
      },
      status: 'new',
      replyContent: '',
      replyVersion: 0,
      readReplyVersion: 0,
      hasUnreadReply: false,
      conversationVersion: 0,
      followUpCount: 0,
      lastUserContent: trimmedContent,
      lastUserEntryAt: db.serverDate(),
      lastMessageContent: trimmedContent,
      lastMessageRole: 'user',
      lastMessageAt: db.serverDate(),
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
  if (!['all', 'new', 'processed'].includes(statusFilter)) fail('状态筛选无效');
  const query = () => statusFilter === 'all' ? db.collection('feedback_messages')
    : db.collection('feedback_messages').where({ status: statusFilter });
  // 新追问需要浮到前面；创建时间分支同时覆盖尚无活动时间的既有记录。
  const [created, active] = await Promise.all([
    query().orderBy('createdAt', 'desc').limit(100).get(),
    query().orderBy('lastMessageAt', 'desc').limit(100).get()
  ]);
  const rows = new Map();
  [...(created.data || []), ...(active.data || [])].forEach(item => rows.set(item._id, item));
  const activityTime = item => new Date(dateText(item.lastMessageAt) || dateText(item.createdAt)).getTime() || 0;
  const items = [...rows.values()].sort((a, b) => activityTime(b) - activityTime(a) || b._id.localeCompare(a._id)).slice(0, 100);

  return {
    ok: true,
    data: items.map(toAdminFeedback)
  };
}

async function listMine(event, openid) {
  const conditions = [{ openid }, { createdAt: command.gte(new Date(0)) }];
  if (event.cursor != null) {
    const cursor = event.cursor;
    if (!cursor || !Number.isSafeInteger(cursor.createdAt) || cursor.createdAt < 0
      || !Number.isFinite(new Date(cursor.createdAt).getTime())) fail('分页参数无效');
    requireId(cursor.id);
    const date = new Date(cursor.createdAt);
    conditions.push(command.or([
      { createdAt: command.lt(date) },
      { createdAt: date, _id: command.lt(cursor.id) }
    ]));
  }
  const result = await db.collection('feedback_messages')
    .where(command.and(conditions)).field(USER_FIELDS)
    .orderBy('createdAt', 'desc').orderBy('_id', 'desc').limit(21).get();
  const items = result.data || [];
  const page = items.slice(0, 20).map(toUserFeedback);
  const last = page[page.length - 1];
  return {
    ok: true,
    data: page,
    nextCursor: items.length > 20 && last
      ? { createdAt: new Date(last.createdAt).getTime(), id: last._id } : null
  };
}

async function getDetail(event, openid) {
  return threadService.getDetail(event, openid);
}

async function getUnreadCount(openid) {
  const [unread, pending] = await Promise.all([
    db.collection('feedback_messages').where({ openid, hasUnreadReply: true }).count(),
    // 管理员待办按真实处理状态统计，不受列表筛选或最多 100 条展示限制影响。
    isDeveloperOpenid(openid)
      ? db.collection('feedback_messages').where({ status: 'new' }).count()
      : Promise.resolve({ total: 0 })
  ]);
  return { ok: true, count: unread.total || 0, adminPendingCount: pending.total || 0 };
}

async function markReplyRead(event, openid) {
  const id = requireId(event.id);
  const seen = event.seenReplyVersion;
  if (!Number.isSafeInteger(seen) || seen < 1) fail('已读版本无效');
  const data = await db.runTransaction(async transaction => {
    const item = await readFeedback(transaction, id);
    if (item.openid !== openid) fail('该反馈不存在或暂时无法查看', 'NOT_FOUND');
    const currentVersion = version(item.replyVersion);
    if (seen > currentVersion) fail('已读版本无效');
    // 只确认实际展示的版本，事务重试时保留更晚发布的未读回复。
    const readReplyVersion = Math.max(version(item.readReplyVersion), seen);
    const hasUnreadReply = currentVersion > readReplyVersion;
    const cleared = currentVersion > version(item.readReplyVersion) && !hasUnreadReply;
    await transaction.collection('feedback_messages').doc(id).update({
      data: { readReplyVersion, hasUnreadReply }
    });
    return { _id: id, readReplyVersion, replyVersion: currentVersion, hasUnreadReply, cleared };
  });
  return { ok: true, data };
}

async function updateFeedbackStatus(event = {}, openid = '') {
  if (!isDeveloperOpenid(openid)) {
    return { ok: false, message: '无权限更新反馈状态' };
  }

  const id = requireId(event.id);
  const status = event.status;
  if (!Number.isSafeInteger(event.baseConversationVersion) || event.baseConversationVersion < 0) fail('处理记录版本无效');

  if (!['new', 'processed'].includes(status)) {
    return { ok: false, message: '状态参数无效' };
  }

  await db.runTransaction(async transaction => {
    const item = await readFeedback(transaction, id);
    if (conversationVersion(item) !== event.baseConversationVersion) {
      fail('处理记录已有更新，请刷新列表后再操作', 'CONFLICT');
    }
    if (status === 'processed' && !text(item.replyContent)) {
      fail('请先填写处理说明', 'REPLY_REQUIRED');
    }
    await transaction.collection('feedback_messages').doc(id).update({
      data: { status, updatedAt: db.serverDate() }
    });
  });

  return { ok: true };
}

async function deleteFeedback(event = {}, openid = '') {
  if (!isDeveloperOpenid(openid)) {
    return { ok: false, message: '无权限删除反馈' };
  }

  const id = requireId(event.id);

  await threadService.deleteEntries(id);
  await db.collection('feedback_messages').doc(id).remove();

  return { ok: true };
}

const threadService = createFeedbackThreadService({
  db, command, readFeedback, requireAdmin, requireId, version, text, fail,
  dateText, toUserFeedback, toAdminFeedback, checkText
});

exports.main = async (event = {}, context) => {
  const { OPENID } = cloud.getWXContext();

  try {
    if (!OPENID) fail('缺少用户身份', 'UNAUTHENTICATED');
    if (!event || typeof event !== 'object') fail('请求参数无效');
    const action = event.action || '';
    if (action === 'listMine') return await listMine(event, OPENID);
    if (action === 'getDetail') return await getDetail(event, OPENID);
    if (action === 'getUnreadCount') return await getUnreadCount(OPENID);
    if (action === 'listEntries') return await threadService.listEntries(event, OPENID);
    if (action === 'appendEntry') return await threadService.appendEntry(event, OPENID);
    if (action === 'markReplyRead') return await markReplyRead(event, OPENID);
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
    if (!error.isFeedbackError) console.error('反馈服务处理失败:', error);
    return {
      ok: false,
      code: error.isFeedbackError ? error.code : 'SERVICE_ERROR',
      message: error.isFeedbackError ? error.message : '反馈服务暂时不可用，请稍后重试'
    };
  }
};
