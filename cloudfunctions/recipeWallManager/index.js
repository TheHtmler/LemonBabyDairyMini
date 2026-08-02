const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const {
  validatePublishPayload,
  normalizeDraftPayload,
  escapeRegExp
} = require('./recipeWallUtils');

const DEVELOPER_OPENIDS = [
  'oYCao7fijm22dyl6C-tcYJo_G69A'
];

function isDeveloperOpenid(openid = '') {
  return DEVELOPER_OPENIDS.includes((openid || '').trim());
}

function isPostOwner(post = {}, openid = '') {
  if (!openid || !post) return false;
  return post.authorOpenid === openid || post._openid === openid;
}

function normalizeListFilter(filter = '') {
  if (filter === 'liked' || filter === 'mine') return filter;
  return 'all';
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

function securityError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

async function checkText(content, openid) {
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      version: 2,
      scene: 3,
      openid,
      content: String(content || '').slice(0, 2500)
    });
    if (isSecurityViolation(res)) {
      throw securityError('TEXT_SECURITY_VIOLATION', '文本含有违规内容');
    }
    if (res && res.errCode && res.errCode !== 0) {
      throw securityError('SECURITY_CHECK_FAILED', `文本安全检测失败(${res.errCode})`);
    }
    return res;
  } catch (error) {
    if (error.code === 'TEXT_SECURITY_VIOLATION' || error.code === 'SECURITY_CHECK_FAILED') throw error;
    if (isSecurityViolation(error)) {
      throw securityError('TEXT_SECURITY_VIOLATION', '文本含有违规内容');
    }
    console.error('msgSecCheck threw', error);
    throw securityError(
      'SECURITY_CHECK_FAILED',
      '文本安全接口调用失败，请确认云函数已开通 contentSecurity'
    );
  }
}

async function checkImage(fileID) {
  try {
    const fileRes = await cloud.downloadFile({ fileID });
    const buffer = fileRes.fileContent;
    const size = buffer ? (buffer.length || buffer.byteLength || 0) : 0;
    // 微信 imgSecCheck 限制约 1MB
    if (size > 1024 * 1024) {
      throw securityError('IMAGE_TOO_LARGE', '图片过大，请压缩到 1MB 以内再发');
    }
    const res = await cloud.openapi.security.imgSecCheck({
      media: {
        contentType: inferContentType(fileID),
        value: buffer
      }
    });
    if (isSecurityViolation(res)) {
      throw securityError('IMAGE_SECURITY_VIOLATION', '图片含有违规内容');
    }
    if (res && res.errCode && res.errCode !== 0) {
      throw securityError('SECURITY_CHECK_FAILED', `图片安全检测失败(${res.errCode})`);
    }
    return res;
  } catch (error) {
    if ([
      'IMAGE_SECURITY_VIOLATION',
      'SECURITY_CHECK_FAILED',
      'IMAGE_TOO_LARGE'
    ].includes(error.code)) throw error;
    if (isSecurityViolation(error)) {
      throw securityError('IMAGE_SECURITY_VIOLATION', '图片含有违规内容');
    }
    console.error('imgSecCheck threw', fileID, error);
    throw securityError(
      'SECURITY_CHECK_FAILED',
      '图片安全接口调用失败，请确认云函数已开通 contentSecurity'
    );
  }
}

function slimIngredientForDb(item = {}) {
  const nutrition = item.nutrition && typeof item.nutrition === 'object'
    ? {
      calories: Number(item.nutrition.calories) || 0,
      protein: Number(item.nutrition.protein) || 0,
      carbs: Number(item.nutrition.carbs) || 0,
      fat: Number(item.nutrition.fat) || 0,
      naturalProtein: Number(item.nutrition.naturalProtein) || 0,
      specialProtein: Number(item.nutrition.specialProtein) || 0,
      fiber: Number(item.nutrition.fiber) || 0,
      sodium: Number(item.nutrition.sodium) || 0
    }
    : null;
  return {
    foodId: String(item.foodId || ''),
    foodName: String(item.foodName || item.name || ''),
    name: String(item.foodName || item.name || ''),
    quantity: Number(item.quantity) || 0,
    unit: String(item.unit || 'g'),
    amount: String(item.amount || ''),
    nutrition
  };
}

function toDbPublishData(data = {}, openid = '') {
  return {
    title: data.title || '',
    description: data.description || '',
    coverFileId: data.coverFileId || '',
    ingredients: (data.ingredients || []).map(slimIngredientForDb),
    steps: (data.steps || []).map((step) => ({
      text: String(step.text || ''),
      imageFileId: String(step.imageFileId || '')
    })),
    tags: Array.isArray(data.tags) ? data.tags.map((tag) => String(tag || '')).filter(Boolean) : [],
    searchText: data.searchText || '',
    cookingMinutes: data.cookingMinutes == null ? null : Number(data.cookingMinutes) || null,
    difficulty: data.difficulty || '',
    totalNutrition: {
      calories: Number(data.totalNutrition?.calories) || 0,
      protein: Number(data.totalNutrition?.protein) || 0,
      carbs: Number(data.totalNutrition?.carbs) || 0,
      fat: Number(data.totalNutrition?.fat) || 0
    },
    babyName: data.babyName || '',
    authorDisplayName: data.authorDisplayName || '',
    babyUid: data.babyUid || '',
    authorAvatar: data.authorAvatar || '',
    authorOpenid: openid,
    status: 'published'
  };
}

function queryUserLikesByField(field, openid, extraWhere = {}) {
  return db.collection('recipe_wall_likes').where({
    [field]: openid,
    ...extraWhere
  });
}

async function getLikedPostIdSet(openid, postIds = []) {
  const ids = [...new Set((postIds || []).filter(Boolean))];
  if (!openid || !ids.length) return new Set();

  // 云函数 add 不会自动写 _openid，统一用 userOpenid；兼容旧数据里可能有的 _openid
  const [byUser, byOpenid] = await Promise.all([
    queryUserLikesByField('userOpenid', openid, { postId: _.in(ids) }).limit(100).get(),
    queryUserLikesByField('_openid', openid, { postId: _.in(ids) }).limit(100).get()
  ]);

  return new Set([
    ...(byUser.data || []).map((row) => row.postId),
    ...(byOpenid.data || []).map((row) => row.postId)
  ]);
}

async function findUserLikeRows(openid, postId) {
  if (!openid || !postId) return [];
  const byUser = await queryUserLikesByField('userOpenid', openid, { postId }).limit(20).get();
  if (byUser.data && byUser.data.length) return byUser.data;
  const byOpenid = await queryUserLikesByField('_openid', openid, { postId }).limit(20).get();
  return byOpenid.data || [];
}

async function cleanupOrphanLikes(postId) {
  // 历史 bug：云函数写入的点赞记录没有用户标识，导致无法取消、计数只增不减
  const res = await db.collection('recipe_wall_likes').where({ postId }).limit(100).get();
  const orphans = (res.data || []).filter((row) => !row.userOpenid && !row._openid);
  if (!orphans.length) return 0;
  await Promise.all(orphans.map((row) => db.collection('recipe_wall_likes').doc(row._id).remove()));
  return orphans.length;
}

async function countLikes(postId) {
  const res = await db.collection('recipe_wall_likes').where({ postId }).count();
  return Number(res.total) || 0;
}

async function saveDraft(event, openid) {
  const normalized = normalizeDraftPayload(event);
  if (!normalized.ok) return { ok: false, message: normalized.message };

  const postId = String(event.postId || '').trim();
  const payload = {
    ...normalized.data,
    authorOpenid: openid,
    status: 'draft',
    likeCount: 0,
    updatedAt: db.serverDate()
  };

  if (postId) {
    const postRes = await db.collection('recipe_wall_posts').doc(postId).get();
    const post = postRes.data;
    if (!post) return { ok: false, message: '草稿不存在' };
    if (!isPostOwner(post, openid)) return { ok: false, message: '无权编辑' };
    if (post.status !== 'draft') return { ok: false, message: '仅草稿可再次保存' };
    await db.collection('recipe_wall_posts').doc(postId).update({ data: payload });
    return { ok: true, postId };
  }

  const addRes = await db.collection('recipe_wall_posts').add({
    data: {
      ...payload,
      createdAt: db.serverDate()
    }
  });
  return { ok: true, postId: addRes._id };
}

async function getOwn(event, openid) {
  const postId = String(event.postId || '').trim();
  if (!postId) return { ok: false, message: '缺少帖子' };
  const postRes = await db.collection('recipe_wall_posts').doc(postId).get();
  const post = postRes.data;
  if (!post) return { ok: false, message: '内容不存在' };
  if (!isPostOwner(post, openid)) return { ok: false, message: '无权查看' };
  return { ok: true, post };
}

async function publish(event, openid) {
  const validated = validatePublishPayload(event);
  if (!validated.ok) return { ok: false, message: validated.message };

  const { data } = validated;
  const postId = String(event.postId || '').trim();
  let existing = null;
  if (postId) {
    const postRes = await db.collection('recipe_wall_posts').doc(postId).get();
    existing = postRes.data;
    if (!existing) return { ok: false, message: '帖子不存在' };
    if (!isPostOwner(existing, openid)) return { ok: false, message: '无权发布' };
    // 草稿转正 / 已发布覆盖编辑 / 已下架修改后重新上墙
    if (!['draft', 'published', 'taken_down'].includes(existing.status)) {
      return { ok: false, message: '当前状态不可发布' };
    }
  }

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
    // 从草稿发布失败时保留云文件，避免草稿图片被删
    if (!existing) {
      await deleteFiles(fileIds);
    }
    if (error.code === 'TEXT_SECURITY_VIOLATION' || error.code === 'IMAGE_SECURITY_VIOLATION') {
      return { ok: false, message: '含有违规内容，请修改后再发', code: error.code };
    }
    if (error.code === 'IMAGE_TOO_LARGE') {
      return { ok: false, message: error.message || '图片过大', code: error.code };
    }
    console.error('security check failed', error);
    return {
      ok: false,
      message: error.message || '内容安全检测失败，请稍后重试',
      code: error.code || 'SECURITY_CHECK_FAILED'
    };
  }

  const publishData = {
    ...toDbPublishData(data, openid),
    updatedAt: db.serverDate()
  };

  try {
    if (existing) {
      await db.collection('recipe_wall_posts').doc(postId).update({
        data: {
          ...publishData,
          likeCount: Number(existing.likeCount) || 0
        }
      });
      return { ok: true, postId };
    }

    const addRes = await db.collection('recipe_wall_posts').add({
      data: {
        ...publishData,
        likeCount: 0,
        createdAt: db.serverDate()
      }
    });
    return { ok: true, postId: addRes._id };
  } catch (error) {
    console.error('publish write failed', error);
    const detail = error.errMsg || error.message || '';
    return {
      ok: false,
      message: detail.includes('COLLECTION_NOT_EXIST') || detail.includes('not exist')
        ? '集合 recipe_wall_posts 不存在，请先在云开发创建'
        : '保存失败，请稍后重试',
      code: 'WRITE_FAILED'
    };
  }
}

async function listLiked(event, openid) {
  const { page, pageSize, skip } = clampPage(event.page, event.pageSize);
  const keyword = String(event.keyword || '').trim().slice(0, 40);

  // 优先读 userOpenid；若无则回退 _openid（兼容少量旧数据）
  let likeRes = await db.collection('recipe_wall_likes')
    .where({ userOpenid: openid })
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get();
  if (!(likeRes.data || []).length) {
    likeRes = await db.collection('recipe_wall_likes')
      .where({ _openid: openid })
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get();
  }

  const likeRows = likeRes.data || [];
  const postIds = likeRows.map((row) => row.postId).filter(Boolean);
  if (!postIds.length) {
    return {
      ok: true,
      list: [],
      hasMore: false,
      page,
      pageSize,
      keyword,
      filter: 'liked'
    };
  }

  const postRes = await db.collection('recipe_wall_posts')
    .where({
      _id: _.in(postIds),
      status: 'published'
    })
    .get();

  let rows = postRes.data || [];
  if (keyword) {
    const matcher = new RegExp(escapeRegExp(keyword), 'i');
    rows = rows.filter((row) => matcher.test(String(row.searchText || row.title || '')));
  }

  const postMap = new Map(rows.map((row) => [row._id, row]));
  const list = postIds
    .map((id) => postMap.get(id))
    .filter(Boolean)
    .map((row) => ({ ...row, liked: true }));

  return {
    ok: true,
    list,
    hasMore: likeRows.length === pageSize,
    page,
    pageSize,
    keyword,
    filter: 'liked'
  };
}

async function list(event, openid) {
  const filter = normalizeListFilter(event.filter);
  if (filter === 'liked') {
    return listLiked(event, openid);
  }
  if (filter === 'mine') {
    return listMine(event, openid);
  }

  const { page, pageSize, skip } = clampPage(event.page, event.pageSize);
  const keyword = String(event.keyword || '').trim().slice(0, 40);

  const conditions = [{ status: 'published' }];
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
    filter: 'all'
  };
}

function createdAtValue(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.getTime === 'function') return value.getTime();
  if (typeof value === 'object' && value.$date) return Number(value.$date) || 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function safeWhereGet(whereQuery, limit = 100) {
  try {
    const res = await db.collection('recipe_wall_posts')
      .where(whereQuery)
      .limit(limit)
      .get();
    return res.data || [];
  } catch (error) {
    console.error('queryAuthorPosts where failed', whereQuery, error);
    return [];
  }
}

async function queryAuthorPosts(openid, { skip, pageSize, keyword = '' }) {
  // 不用 where+orderBy 组合，避免缺复合索引时查空/报错；内存排序即可
  const [byAuthor, byOpenid] = await Promise.all([
    safeWhereGet({ authorOpenid: openid }),
    safeWhereGet({ _openid: openid })
  ]);

  const map = new Map();
  [...byAuthor, ...byOpenid].forEach((row) => {
    if (row && row._id) map.set(row._id, row);
  });

  let rows = [...map.values()];
  if (keyword) {
    const matcher = new RegExp(escapeRegExp(keyword), 'i');
    rows = rows.filter((row) => matcher.test(String(row.searchText || row.title || '')));
  }

  rows.sort((a, b) => createdAtValue(b.createdAt) - createdAtValue(a.createdAt));
  return {
    data: rows.slice(skip, skip + pageSize),
    total: rows.length
  };
}

async function listMine(event, openid) {
  const { page, pageSize, skip } = clampPage(event.page, event.pageSize);
  const keyword = String(event.keyword || '').trim().slice(0, 40);
  const res = await queryAuthorPosts(openid, { skip, pageSize, keyword });
  const rows = res.data || [];
  const likedSet = await getLikedPostIdSet(openid, rows.map((row) => row._id));
  const list = rows.map((row) => ({
    ...row,
    liked: likedSet.has(row._id)
  }));

  return {
    ok: true,
    list,
    hasMore: skip + rows.length < (res.total || 0),
    page,
    pageSize,
    keyword,
    filter: 'mine'
  };
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

  const isOwner = isPostOwner(post, openid);
  if (post.status === 'draft' && !isOwner) {
    return { ok: false, message: '内容不可用', code: 'UNAVAILABLE' };
  }
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

  await cleanupOrphanLikes(postId);

  const existedRows = await findUserLikeRows(openid, postId);
  if (existedRows.length) {
    await Promise.all(
      existedRows.map((row) => db.collection('recipe_wall_likes').doc(row._id).remove())
    );
    const next = await countLikes(postId);
    await db.collection('recipe_wall_posts').doc(postId).update({
      data: { likeCount: next, updatedAt: db.serverDate() }
    });
    return { ok: true, liked: false, likeCount: next };
  }

  // 云函数写入必须显式记录用户，否则无法查重/取消
  await db.collection('recipe_wall_likes').add({
    data: {
      postId,
      userOpenid: openid,
      createdAt: db.serverDate()
    }
  });
  const next = await countLikes(postId);
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
  if (!isPostOwner(post, openid)) return { ok: false, message: '无权删除' };

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
    if (action === 'saveDraft') return await saveDraft(event, OPENID);
    if (action === 'getOwn') return await getOwn(event, OPENID);
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
