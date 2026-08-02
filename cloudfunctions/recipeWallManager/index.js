const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const { validatePublishPayload, escapeRegExp, RECIPE_WALL_TAG_OPTIONS } = require('./recipeWallUtils');

const DEVELOPER_OPENIDS = [
  'oYCao7fijm22dyl6C-tcYJo_G69A'
];

function isDeveloperOpenid(openid = '') {
  return DEVELOPER_OPENIDS.includes((openid || '').trim());
}

function isSecurityViolation(result = {}) {
  return result.errCode === 87014
    || result.errcode === 87014
    || result.code === 87014;
}

function inferContentType(fileID = '') {
  const lower = String(fileID || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function clampPage(page, pageSize) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(20, Math.max(1, Number(pageSize) || 10));
  return { page: safePage, pageSize: safeSize, skip: (safePage - 1) * safeSize };
}

async function deleteFiles(fileList = []) {
  const list = [...new Set((fileList || []).filter(Boolean))];
  if (!list.length) return;
  try {
    await cloud.deleteFile({ fileList: list });
  } catch (error) {
    console.error('deleteFiles failed', error);
  }
}

async function checkText(content, openid) {
  const res = await cloud.openapi.security.msgSecCheck({
    version: 2,
    scene: 3,
    openid,
    content: String(content || '').slice(0, 2500)
  });
  if (isSecurityViolation(res)) {
    const err = new Error('TEXT_SECURITY_VIOLATION');
    err.code = 'TEXT_SECURITY_VIOLATION';
    throw err;
  }
  if (res && res.errCode && res.errCode !== 0) {
    const err = new Error('SECURITY_CHECK_FAILED');
    err.code = 'SECURITY_CHECK_FAILED';
    throw err;
  }
  return res;
}

async function checkImage(fileID) {
  const fileRes = await cloud.downloadFile({ fileID });
  const res = await cloud.openapi.security.imgSecCheck({
    media: {
      contentType: inferContentType(fileID),
      value: fileRes.fileContent
    }
  });
  if (isSecurityViolation(res)) {
    const err = new Error('IMAGE_SECURITY_VIOLATION');
    err.code = 'IMAGE_SECURITY_VIOLATION';
    throw err;
  }
  if (res && res.errCode && res.errCode !== 0) {
    const err = new Error('SECURITY_CHECK_FAILED');
    err.code = 'SECURITY_CHECK_FAILED';
    throw err;
  }
  return res;
}

async function getLikedPostIdSet(openid, postIds = []) {
  const ids = [...new Set((postIds || []).filter(Boolean))];
  if (!openid || !ids.length) return new Set();

  const likeRes = await db.collection('recipe_wall_likes').where({
    _openid: openid,
    postId: _.in(ids)
  }).limit(100).get();

  return new Set((likeRes.data || []).map((row) => row.postId));
}

async function publish(event, openid) {
  const validated = validatePublishPayload(event);
  if (!validated.ok) return { ok: false, message: validated.message };

  const { data } = validated;
  const fileIds = [
    data.coverFileId,
    ...data.steps.map((step) => step.imageFileId).filter(Boolean)
  ];

  try {
    const textBlob = [
      data.title,
      data.description || '',
      ...(data.tags || []),
      ...data.ingredients.map((item) => `${item.foodName || item.name}${item.amount}`),
      ...data.steps.map((step) => step.text),
      data.difficulty || '',
      data.cookingMinutes ? `${data.cookingMinutes}分钟` : ''
    ].join('\n');
    await checkText(textBlob, openid);
    for (const fileID of fileIds) {
      await checkImage(fileID);
    }
  } catch (error) {
    await deleteFiles(fileIds);
    if (error.code === 'TEXT_SECURITY_VIOLATION' || error.code === 'IMAGE_SECURITY_VIOLATION') {
      return { ok: false, message: '含有违规内容，请修改后再发', code: error.code };
    }
    console.error('security check failed', error);
    return { ok: false, message: '内容安全检测失败，请稍后重试', code: 'SECURITY_CHECK_FAILED' };
  }

  const addRes = await db.collection('recipe_wall_posts').add({
    data: {
      ...data,
      status: 'published',
      likeCount: 0,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  });

  return { ok: true, postId: addRes._id };
}

async function list(event, openid) {
  const { page, pageSize, skip } = clampPage(event.page, event.pageSize);
  const keyword = String(event.keyword || '').trim().slice(0, 40);
  const tag = String(event.tag || '').trim();
  if (tag && !RECIPE_WALL_TAG_OPTIONS.includes(tag)) {
    return { ok: false, message: '标签无效' };
  }

  const conditions = [{ status: 'published' }];
  if (tag) {
    conditions.push({ tags: tag });
  }
  if (keyword) {
    conditions.push({
      searchText: db.RegExp({
        regexp: escapeRegExp(keyword),
        options: 'i'
      })
    });
  }

  const whereQuery = conditions.length === 1 ? conditions[0] : _.and(conditions);
  const res = await db.collection('recipe_wall_posts')
    .where(whereQuery)
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get();

  const rows = res.data || [];
  const likedSet = await getLikedPostIdSet(openid, rows.map((row) => row._id));
  const list = rows.map((row) => ({
    ...row,
    liked: likedSet.has(row._id)
  }));

  return {
    ok: true,
    list,
    hasMore: rows.length === pageSize,
    page,
    pageSize,
    keyword,
    tag
  };
}

async function listMine(event, openid) {
  const { page, pageSize, skip } = clampPage(event.page, event.pageSize);
  const res = await db.collection('recipe_wall_posts')
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get();

  const rows = res.data || [];
  return { ok: true, list: rows, hasMore: rows.length === pageSize, page, pageSize };
}

async function adminList(event, openid) {
  if (!isDeveloperOpenid(openid)) {
    return { ok: false, message: '无权限' };
  }
  const { page, pageSize, skip } = clampPage(event.page, event.pageSize);
  const res = await db.collection('recipe_wall_posts')
    .where({ status: 'published' })
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get();
  const rows = res.data || [];
  return { ok: true, list: rows, hasMore: rows.length === pageSize, page, pageSize };
}

async function detail(event, openid) {
  const postId = String(event.postId || '').trim();
  if (!postId) return { ok: false, message: '缺少帖子' };

  const postRes = await db.collection('recipe_wall_posts').doc(postId).get();
  const post = postRes.data;
  if (!post) {
    return { ok: false, message: '内容不可用', code: 'UNAVAILABLE' };
  }

  const isOwner = post._openid === openid;
  if (post.status === 'taken_down' && !isOwner) {
    return { ok: false, message: '内容不可用', code: 'UNAVAILABLE' };
  }

  const likedSet = await getLikedPostIdSet(openid, [postId]);
  return {
    ok: true,
    post,
    liked: likedSet.has(postId)
  };
}

async function toggleLike(event, openid) {
  const postId = String(event.postId || '').trim();
  if (!postId) return { ok: false, message: '缺少帖子' };

  const postRes = await db.collection('recipe_wall_posts').doc(postId).get();
  const post = postRes.data;
  if (!post || post.status !== 'published') {
    return { ok: false, message: '帖子不可点赞' };
  }

  const likeRes = await db.collection('recipe_wall_likes').where({
    _openid: openid,
    postId
  }).limit(1).get();

  const existed = likeRes.data && likeRes.data[0];
  if (existed) {
    await db.collection('recipe_wall_likes').doc(existed._id).remove();
    const next = Math.max(0, (Number(post.likeCount) || 0) - 1);
    await db.collection('recipe_wall_posts').doc(postId).update({
      data: { likeCount: next, updatedAt: db.serverDate() }
    });
    return { ok: true, liked: false, likeCount: next };
  }

  await db.collection('recipe_wall_likes').add({
    data: {
      postId,
      createdAt: db.serverDate()
    }
  });
  const next = (Number(post.likeCount) || 0) + 1;
  await db.collection('recipe_wall_posts').doc(postId).update({
    data: { likeCount: next, updatedAt: db.serverDate() }
  });
  return { ok: true, liked: true, likeCount: next };
}

async function deleteOwn(event, openid) {
  const postId = String(event.postId || '').trim();
  if (!postId) return { ok: false, message: '缺少帖子' };

  const postRes = await db.collection('recipe_wall_posts').doc(postId).get();
  const post = postRes.data;
  if (!post) return { ok: false, message: '帖子不存在' };
  if (post._openid !== openid) return { ok: false, message: '无权删除' };

  await db.collection('recipe_wall_posts').doc(postId).remove();
  return { ok: true };
}

async function takeDown(event, openid) {
  if (!isDeveloperOpenid(openid)) {
    return { ok: false, message: '无权限' };
  }
  const postId = String(event.postId || '').trim();
  if (!postId) return { ok: false, message: '缺少帖子' };

  const postRes = await db.collection('recipe_wall_posts').doc(postId).get();
  if (!postRes.data) return { ok: false, message: '帖子不存在' };

  await db.collection('recipe_wall_posts').doc(postId).update({
    data: {
      status: 'taken_down',
      updatedAt: db.serverDate()
    }
  });
  return { ok: true };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, message: '缺少用户身份' };

  const action = event.action || '';
  try {
    if (action === 'publish') return await publish(event, OPENID);
    if (action === 'list') return await list(event, OPENID);
    if (action === 'listMine') return await listMine(event, OPENID);
    if (action === 'adminList') return await adminList(event, OPENID);
    if (action === 'detail') return await detail(event, OPENID);
    if (action === 'toggleLike') return await toggleLike(event, OPENID);
    if (action === 'deleteOwn') return await deleteOwn(event, OPENID);
    if (action === 'takeDown') return await takeDown(event, OPENID);
    return { ok: false, message: '未知操作' };
  } catch (error) {
    console.error('recipeWallManager error', action, error);
    return { ok: false, message: '服务异常，请稍后重试' };
  }
};

exports._internal = {
  isDeveloperOpenid,
  isSecurityViolation,
  inferContentType
};
