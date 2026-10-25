'use strict';

const crypto = require('crypto');
const { fail, text } = require('./contracts');
const SESSION_COLLECTION = 'nutrition_recognition_sessions';

function runtime() {
  const cloud = require('wx-server-sdk');
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  const context = cloud.getWXContext();
  const env = context.ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE;
  if (!env) fail('CONFIG_MISSING', '无法确定当前云环境');
  const app = require('@cloudbase/node-sdk').init({ env });
  return { cloud, db: app.database(), context, env,
    allocateFileIds: async paths => Promise.all(paths.map(async cloudPath => {
      const result = await app.getUploadMetadata({ cloudPath });
      const id = result.data && result.data.fileId;
      if (!id) fail('SAVE_FAILED', '无法分配识别图片路径，请稍后重试');
      // 上传令牌与授权签名留在服务端，仅保留文件ID。
      return id;
    })) };
}

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

async function getDocument(db, collection, id) {
  try {
    const result = await db.collection(collection).doc(id).get();
    return Array.isArray(result.data) ? result.data[0] || null : result.data || null;
  } catch (error) {
    if (/DOCUMENT_NOT_FOUND|DOCUMENT_NOT_EXIST/.test(String(error.code)) ||
        /document.*not.*exist|document.*not.*found/i.test(error.message || '')) return null;
    throw error;
  }
}

async function assertAccess(db, openid, babyUid) {
  if (!openid || !/^[A-Za-z0-9_-]{1,128}$/.test(babyUid || '')) fail('FORBIDDEN', '缺少有效用户或宝宝身份');
  for (const collection of ['baby_creators', 'baby_participants']) {
    const result = await db.collection(collection).where({ _openid: openid, babyUid }).limit(1).get();
    if (result.data && result.data.length) return;
  }
  fail('FORBIDDEN', '无权访问该宝宝');
}

async function ownedSession(db, openid, babyUid, sessionId, now = Date.now()) {
  if (!/^[a-f0-9]{64}$/.test(sessionId || '')) fail('INVALID_INPUT', '识别草稿ID无效');
  await assertAccess(db, openid, babyUid);
  return readOwnedSession(db, openid, babyUid, sessionId, now);
}

async function readOwnedSession(db, openid, babyUid, sessionId, now) {
  const session = await getDocument(db, SESSION_COLLECTION, sessionId);
  if (!session || session.ownerOpenid !== openid || session.babyUid !== babyUid) fail('FORBIDDEN', '无法访问该识别草稿');
  if (session.status !== 'saved' && new Date(session.expiresAt).getTime() <= now) fail('SESSION_EXPIRED', '识别草稿已过期，请重新识别');
  return session;
}

// 作用域在每次请求内创建，只复用闭包绑定身份的鉴权，不接收客户端跳过标记。
function createRequestAccess(db, openid, babyUid) {
  let accessPromise;
  const checkAccess = () => {
    if (!accessPromise) accessPromise = assertAccess(db, openid, babyUid);
    return accessPromise;
  };
  return {
    assertAccess: checkAccess,
    async ownedSession(sessionId, now = Date.now()) {
      if (!/^[a-f0-9]{64}$/.test(sessionId || '')) fail('INVALID_INPUT', '识别草稿ID无效');
      await checkAccess();
      return readOwnedSession(db, openid, babyUid, sessionId, now);
    }
  };
}

async function transaction(db, action) { return db.runTransaction(action); }

async function readBabyFoodCatalog(db, babyUid) {
  const result = []; const deadline = Date.now() + 8000;
  const command = db.command;
  const where = command.and([command.or([{ babyUid }, { sharedBabyUids: command.in([babyUid]) }]),
    { sourceType: command.neq('system'), ownerType: command.neq('system'), isSystem: command.neq(true) }]);
  for (let offset = 0; offset <= 5000; offset += 100) {
    if (Date.now() > deadline) fail('SERVICE_UNAVAILABLE', '资料核对尚未完成，请稍后重试');
    const page = await db.collection('food_catalog').where(where).orderBy('_id', 'asc').skip(offset).limit(100).get();
    const rows = page.data || [];
    result.push(...rows);
    if (rows.length < 100) return result;
  }
  fail('VALIDATION_FAILED', '资料较多，暂不能完整核对重复项，请先到食物管理查看已有资料');
}

const FAILURE_STAGES = {
  runtime_init: '识别服务初始化失败，请稍后重试',
  access_check: '识别权限检查失败，请稍后重试',
  prepare_validate: '识别准备失败，请稍后重试',
  prepare_read_session: '识别草稿读取失败，请稍后重试',
  prepare_target: '食物条目核对失败，请稍后重试',
  prepare_profile: '营养档案读取失败，请稍后重试',
  prepare_allocate_images: '图片上传准备失败，请稍后重试',
  prepare_create_session: '识别草稿创建失败，请稍后重试',
  session_read: '识别草稿读取失败，请稍后重试',
  model_config: '模型配置读取失败，请检查云函数配置',
  image_read: '识别图片读取失败，请稍后重试',
  session_claim: '识别任务启动失败，请稍后重试',
  model_request: '模型识别失败，请稍后重试',
  session_save: '识别结果保存失败，请稍后重试',
  estimate_validate: 'AI估算准备失败，请重新核对',
  estimate_claim: 'AI估算任务启动失败，请稍后重试',
  estimate_request: 'AI营养估算失败，请稍后重试',
  estimate_save: 'AI估算结果保存失败，请稍后重试',
  estimate_failure_save: 'AI估算失败状态记录失败，请稍后重新核对'
};

function diagnosticCode(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return 'UNKNOWN';
  const code = String(value);
  return /^-?[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(code) && !/^sk[-_]/i.test(code) ? code : 'UNKNOWN';
}

function publicFailure(error, requestId, context = {}) {
  const source = error && typeof error === 'object' ? error : {};
  const allowed = new Set(['CONFIG_MISSING', 'INVALID_INPUT', 'FORBIDDEN', 'FREE_QUOTA_EXHAUSTED',
    'MODEL_TIMEOUT', 'MODEL_UNAVAILABLE', 'INVALID_MODEL_RESULT', 'SESSION_EXPIRED',
    'REFERENCE_UNAVAILABLE', 'COMPARISON_STALE', 'VERSION_CONFLICT', 'VALIDATION_FAILED', 'IDENTITY_INSUFFICIENT',
    'SAVE_FAILED', 'RECOGNITION_IN_PROGRESS', 'SERVICE_UNAVAILABLE', 'AI_UNAVAILABLE', 'AI_RUNNING', 'AI_UNKNOWN', 'DAILY_LIMIT', 'REQUEST_CONFLICT', 'SAVE_PROCESSING']);
  const stage = Object.prototype.hasOwnProperty.call(FAILURE_STAGES, context.stage) ? context.stage : '';
  const action = ['prepare', 'recognize', 'estimate', 'search', 'select', 'confirm'].includes(context.action) ? context.action : 'unknown';
  const code = allowed.has(source.code) ? source.code : 'SERVICE_UNAVAILABLE';
  const message = allowed.has(source.code) ? source.message : FAILURE_STAGES[stage] || '服务暂时不可用，请稍后再试';
  // 不输出原始异常消息、完整堆栈、请求参数或服务响应，避免记录密钥及图片内容。
  const locations = (typeof source.stack === 'string' ? source.stack : '').split('\n').slice(1)
    .map(line => line.match(/([A-Za-z0-9_.-]+\.js):(\d+):(\d+)\)?$/))
    .filter(Boolean).slice(0, 3).map(match => match[1] + ':' + match[2] + ':' + match[3]);
  const details = { requestId: text(requestId, 100), action, stage: stage || 'unknown', code,
    sourceCode: diagnosticCode(source.nativeCode || source.code || source.errCode),
    errorType: diagnosticCode(source.name), locations };
  if (Number.isInteger(source.httpStatus) && source.httpStatus >= 100 && source.httpStatus <= 599) details.httpStatus = source.httpStatus;
  console.warn('[nutritionRecognition]', details);
  return { ok: false, requestId: text(requestId, 100), code, message, ...(stage ? { stage } : {}) };
}

module.exports = { runtime, hash, getDocument, assertAccess, ownedSession, createRequestAccess, transaction, readBabyFoodCatalog, publicFailure, SESSION_COLLECTION };
