const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const FEATURE_FLAG_COLLECTION = 'feature_flags';
const REPORT_OCR_ACCESS_KEY = 'report_ocr_access';
const HOME_RELEASE_NOTICE_KEY = 'home_release_notice';
const DEFAULT_MESSAGE = '拍照识别功能调试中，仅对白名单用户开放';
const DEFAULT_RELEASE_NOTICE_TEXT = '看板已升级：聚焦今日营养达成、喂养进度与用药打卡，明细请到「数据记录」查看。';
const DEVELOPER_OPENIDS = [
  'oYCao7fijm22dyl6C-tcYJo_G69A'
];

function normalizeOpenid(value = '') {
  return String(value || '').trim();
}

function parseDeveloperOpenids() {
  const fromEnv = String(process.env.DEVELOPER_OPENIDS || '')
    .split(',')
    .map(normalizeOpenid)
    .filter(Boolean);
  return Array.from(new Set([...DEVELOPER_OPENIDS, ...fromEnv]));
}

function isDeveloperOpenid(openid = '') {
  return parseDeveloperOpenids().includes(normalizeOpenid(openid));
}

function normalizeOpenids(openids = []) {
  const source = Array.isArray(openids)
    ? openids
    : String(openids || '').split(/[\n,，\s]+/);
  return Array.from(new Set(source.map(normalizeOpenid).filter(Boolean)));
}

function normalizeScope(scope = '') {
  return scope === 'all' ? 'all' : 'whitelist';
}

function normalizeReportOcrConfig(config = {}) {
  return {
    key: REPORT_OCR_ACCESS_KEY,
    scope: normalizeScope(config.scope),
    allowOpenids: normalizeOpenids(config.allowOpenids),
    message: String(config.message || DEFAULT_MESSAGE).trim() || DEFAULT_MESSAGE
  };
}

async function getReportOcrAccessConfig() {
  const res = await db.collection(FEATURE_FLAG_COLLECTION)
    .where({ key: REPORT_OCR_ACCESS_KEY })
    .limit(1)
    .get();
  const doc = res.data && res.data[0];
  return {
    ...normalizeReportOcrConfig(doc || {}),
    _id: doc?._id || '',
    updatedAt: doc?.updatedAt || null,
    updatedBy: doc?.updatedBy || ''
  };
}

function normalizeHomeReleaseNotice(config = {}) {
  return {
    key: HOME_RELEASE_NOTICE_KEY,
    visible: config.visible !== false,
    text: String(config.text || DEFAULT_RELEASE_NOTICE_TEXT).trim() || DEFAULT_RELEASE_NOTICE_TEXT
  };
}

async function getHomeReleaseNotice() {
  const res = await db.collection(FEATURE_FLAG_COLLECTION)
    .where({ key: HOME_RELEASE_NOTICE_KEY })
    .limit(1)
    .get();
  const doc = res.data && res.data[0];
  return {
    ...normalizeHomeReleaseNotice(doc || {}),
    _id: doc?._id || '',
    updatedAt: doc?.updatedAt || null,
    updatedBy: doc?.updatedBy || ''
  };
}

async function updateHomeReleaseNotice(event = {}, operatorOpenid = '') {
  const nextNotice = normalizeHomeReleaseNotice({
    visible: event.visible,
    text: event.text
  });
  const existing = await getHomeReleaseNotice();
  const data = {
    ...nextNotice,
    updatedAt: db.serverDate(),
    updatedBy: operatorOpenid
  };

  if (existing._id) {
    await db.collection(FEATURE_FLAG_COLLECTION).doc(existing._id).update({ data });
  } else {
    await db.collection(FEATURE_FLAG_COLLECTION).add({ data });
  }

  return await getHomeReleaseNotice();
}

async function updateReportOcrAccessConfig(event = {}, operatorOpenid = '') {
  const nextConfig = normalizeReportOcrConfig({
    scope: event.scope,
    allowOpenids: event.allowOpenids,
    message: event.message
  });
  const existing = await getReportOcrAccessConfig();
  const data = {
    ...nextConfig,
    updatedAt: db.serverDate(),
    updatedBy: operatorOpenid
  };

  if (existing._id) {
    await db.collection(FEATURE_FLAG_COLLECTION).doc(existing._id).update({ data });
  } else {
    await db.collection(FEATURE_FLAG_COLLECTION).add({ data });
  }

  return await getReportOcrAccessConfig();
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'getReportOcrAccessConfig';

  if (!OPENID) {
    return { ok: false, code: 'MISSING_OPENID', message: '缺少用户身份' };
  }
  try {
    if (action === 'getHomeReleaseNotice') {
      const notice = await getHomeReleaseNotice();
      return {
        ok: true,
        notice: {
          visible: notice.visible,
          text: notice.text
        }
      };
    }

    if (!isDeveloperOpenid(OPENID)) {
      return { ok: false, code: 'NO_PERMISSION', message: '无权限配置实验功能' };
    }

    if (action === 'getReportOcrAccessConfig') {
      return {
        ok: true,
        config: await getReportOcrAccessConfig()
      };
    }
    if (action === 'updateReportOcrAccessConfig') {
      return {
        ok: true,
        config: await updateReportOcrAccessConfig(event, OPENID)
      };
    }
    if (action === 'getHomeReleaseNoticeConfig') {
      return {
        ok: true,
        notice: await getHomeReleaseNotice()
      };
    }
    if (action === 'updateHomeReleaseNotice') {
      return {
        ok: true,
        notice: await updateHomeReleaseNotice(event, OPENID)
      };
    }
    return { ok: false, code: 'UNKNOWN_ACTION', message: '不支持的配置操作' };
  } catch (error) {
    console.error('[featureFlagManager] failed', error);
    return {
      ok: false,
      code: 'FEATURE_FLAG_FAILED',
      message: error?.message || '配置更新失败'
    };
  }
};
