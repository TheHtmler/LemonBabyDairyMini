const {
  FEEDING_REMINDER_STORAGE_KEY,
  buildFeedingReminderSubscription,
  getFeedingReminderTemplateId,
  isFeedingReminderTemplateConfigured,
  resolveSubscribeStatus
} = require('./feedingReminderSubscription');

function getWxApi(explicitWx) {
  if (explicitWx) return explicitWx;
  if (typeof wx !== 'undefined') return wx;
  return null;
}

function getAppOpenid() {
  try {
    const app = typeof getApp === 'function' ? getApp() : null;
    return app?.globalData?.openid || '';
  } catch (error) {
    return '';
  }
}

function getStoredOpenid(wxApi) {
  try {
    return wxApi?.getStorageSync ? wxApi.getStorageSync('openid') || '' : '';
  } catch (error) {
    return '';
  }
}

function isFutureCandidate(candidate = {}, now = new Date()) {
  const dueAt = candidate.dueAt ? new Date(candidate.dueAt) : null;
  return !!(dueAt && !Number.isNaN(dueAt.getTime()) && dueAt.getTime() > now.getTime());
}

function readLocalSubscription(wxApi, sourceKey) {
  try {
    const cached = wxApi?.getStorageSync ? wxApi.getStorageSync(FEEDING_REMINDER_STORAGE_KEY) : null;
    return cached && cached.sourceKey === sourceKey ? cached : null;
  } catch (error) {
    return null;
  }
}

function writeLocalSubscription(wxApi, record) {
  try {
    if (wxApi?.setStorageSync) {
      wxApi.setStorageSync(FEEDING_REMINDER_STORAGE_KEY, record);
    }
  } catch (error) {
    // 本地缓存失败不影响云端订阅记录。
  }
}

async function invalidateReminderSubscriptions({
  wxApi: explicitWx,
  sourceKey = '',
  status = 'stale',
  reason = ''
} = {}) {
  const wxApi = getWxApi(explicitWx);
  if (!wxApi || !sourceKey) return false;

  const updateData = {
    status,
    invalidReason: reason,
    updatedAt: new Date()
  };

  if (wxApi.cloud) {
    try {
      const db = wxApi.cloud.database();
      const _ = db.command;
      await db.collection('feeding_reminders')
        .where({
          sourceKey,
          status: _.in(['pending', 'failed'])
        })
        .update({ data: updateData });
    } catch (error) {
      console.warn('标记旧提醒失效失败:', error);
    }
  }

  const cached = readLocalSubscription(wxApi, sourceKey);
  if (cached) {
    writeLocalSubscription(wxApi, {
      ...cached,
      ...updateData
    });
  }
  return true;
}

async function rescheduleReminderSubscriptions({
  wxApi: explicitWx,
  sourceKey = '',
  candidate = {}
} = {}) {
  const wxApi = getWxApi(explicitWx);
  if (!wxApi || !sourceKey || !candidate.dueAt) return false;

  const updateData = {
    status: 'pending',
    used: false,
    dueAt: candidate.dueAt,
    dueAtText: candidate.timeText || '',
    title: candidate.title || '宝宝提醒',
    content: candidate.content || '该记录啦',
    note: candidate.note || '',
    hintText: candidate.note || candidate.content || '未来记录提醒',
    invalidReason: '',
    updatedAt: new Date()
  };
  let updated = false;

  if (wxApi.cloud) {
    try {
      const db = wxApi.cloud.database();
      const _ = db.command;
      const result = await db.collection('feeding_reminders')
        .where({
          sourceKey,
          status: _.in(['pending', 'failed'])
        })
        .update({ data: updateData });
      updated = (result?.stats?.updated || result?.updated || 0) > 0;
    } catch (error) {
      console.warn('同步提醒时间失败:', error);
    }
  }

  const cached = readLocalSubscription(wxApi, sourceKey);
  if (cached) {
    writeLocalSubscription(wxApi, {
      ...cached,
      ...updateData
    });
    updated = true;
  }

  return updated;
}

function showToast(wxApi, title, icon = 'none') {
  if (wxApi?.showToast) {
    wxApi.showToast({ title, icon });
  }
}

async function saveSubscriptionRecord({ wxApi, candidate, babyUid, openid, templateId }) {
  const now = new Date();
  const subscription = buildFeedingReminderSubscription({
    babyUid,
    openid,
    templateId,
    candidate,
    subscribedAt: Date.now()
  });

  const record = {
    ...subscription,
    status: 'pending',
    dueAt: candidate.dueAt,
    dueAtText: candidate.timeText,
    page: 'pages/daily-feeding/index',
    createdAt: now,
    updatedAt: now
  };

  if (wxApi?.cloud && babyUid) {
    const db = wxApi.cloud.database();
    let reused = 0;
    // 幂等：同一记录 + 同一用户若已有提醒文档（含此前已发送的），直接复用并重置为 pending。
    // 用户本次重新授权已积累了一次新配额，复用可避免产生重复 pending 导致重复发送。
    if (openid && candidate.sourceKey) {
      try {
        const res = await db.collection('feeding_reminders')
          .where({ sourceKey: candidate.sourceKey, openid })
          .update({
            data: {
              status: 'pending',
              used: false,
              dueAt: candidate.dueAt,
              dueAtText: candidate.timeText || '',
              title: record.title,
              content: record.content,
              note: record.note,
              hintText: record.hintText,
              invalidReason: '',
              lastError: '',
              updatedAt: now
            }
          });
        reused = (res && res.stats && res.stats.updated) || res.updated || 0;
      } catch (error) {
        console.warn('复用已有提醒失败，将新增一条:', error);
      }
    }
    if (!reused) {
      await db.collection('feeding_reminders').add({ data: record });
    }
  }
  writeLocalSubscription(wxApi, record);
  return record;
}

async function requestCandidateReminderSubscription({
  candidate,
  babyUid = '',
  openid = '',
  wxApi: explicitWx,
  successText = '这条提醒已订阅'
} = {}) {
  const wxApi = getWxApi(explicitWx);
  if (!wxApi || !candidate || !isFutureCandidate(candidate)) return false;

  const templateId = getFeedingReminderTemplateId();
  if (!isFeedingReminderTemplateConfigured(templateId)) {
    showToast(wxApi, '请先配置订阅消息模板', 'none');
    return false;
  }

  let subscribeResult;
  try {
    subscribeResult = await wxApi.requestSubscribeMessage({ tmplIds: [templateId] });
  } catch (error) {
    showToast(wxApi, '订阅提醒失败', 'none');
    return false;
  }

  if (resolveSubscribeStatus(subscribeResult, templateId) !== 'accept') {
    showToast(wxApi, '未授权提醒，稍后可再订阅', 'none');
    return false;
  }

  await saveSubscriptionRecord({
    wxApi,
    candidate,
    babyUid,
    openid: openid || getAppOpenid() || getStoredOpenid(wxApi),
    templateId
  });
  showToast(wxApi, successText, 'success');
  return true;
}

module.exports = {
  invalidateReminderSubscriptions,
  isFutureCandidate,
  rescheduleReminderSubscriptions,
  requestCandidateReminderSubscription
};
