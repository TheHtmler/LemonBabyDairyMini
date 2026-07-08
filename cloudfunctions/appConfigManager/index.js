const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const APP_CONFIG_COLLECTION = 'app_config';
const GROUP_QRCODE_KEY = 'group_qrcode';
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

function normalizeGroupQrcodeConfig(config = {}) {
  return {
    key: GROUP_QRCODE_KEY,
    fileId: String(config.fileId || '').trim()
  };
}

async function getGroupQrcodeConfig() {
  const res = await db.collection(APP_CONFIG_COLLECTION)
    .where({ key: GROUP_QRCODE_KEY })
    .limit(1)
    .get();
  const doc = res.data && res.data[0];
  return {
    ...normalizeGroupQrcodeConfig(doc || {}),
    _id: doc?._id || '',
    updatedAt: doc?.updatedAt || null,
    updatedBy: doc?.updatedBy || ''
  };
}

async function updateGroupQrcodeConfig(event = {}, operatorOpenid = '') {
  const nextConfig = normalizeGroupQrcodeConfig({
    fileId: event.fileId
  });
  if (!nextConfig.fileId) {
    throw new Error('缺少群二维码文件');
  }

  const existing = await getGroupQrcodeConfig();
  const data = {
    ...nextConfig,
    updatedAt: db.serverDate(),
    updatedBy: operatorOpenid
  };

  if (existing._id) {
    await db.collection(APP_CONFIG_COLLECTION).doc(existing._id).update({ data });
  } else {
    await db.collection(APP_CONFIG_COLLECTION).add({ data });
  }

  return await getGroupQrcodeConfig();
}

async function clearGroupQrcodeConfig(operatorOpenid = '') {
  const existing = await getGroupQrcodeConfig();
  if (!existing._id) {
    return await getGroupQrcodeConfig();
  }

  await db.collection(APP_CONFIG_COLLECTION).doc(existing._id).update({
    data: {
      key: GROUP_QRCODE_KEY,
      fileId: '',
      updatedAt: db.serverDate(),
      updatedBy: operatorOpenid
    }
  });

  return await getGroupQrcodeConfig();
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'getGroupQrcode';

  if (!OPENID) {
    return { ok: false, code: 'MISSING_OPENID', message: '缺少用户身份' };
  }

  try {
    if (action === 'getGroupQrcode') {
      const config = await getGroupQrcodeConfig();
      return {
        ok: true,
        config: {
          fileId: config.fileId
        }
      };
    }

    if (!isDeveloperOpenid(OPENID)) {
      return { ok: false, code: 'NO_PERMISSION', message: '无权限配置公共参数' };
    }

    if (action === 'getGroupQrcodeConfig') {
      return {
        ok: true,
        config: await getGroupQrcodeConfig()
      };
    }
    if (action === 'updateGroupQrcode') {
      return {
        ok: true,
        config: await updateGroupQrcodeConfig(event, OPENID)
      };
    }
    if (action === 'clearGroupQrcode') {
      return {
        ok: true,
        config: await clearGroupQrcodeConfig(OPENID)
      };
    }

    return { ok: false, code: 'UNKNOWN_ACTION', message: '不支持的配置操作' };
  } catch (error) {
    console.error('[appConfigManager] failed', error);
    return {
      ok: false,
      code: 'APP_CONFIG_FAILED',
      message: error?.message || '配置更新失败'
    };
  }
};
