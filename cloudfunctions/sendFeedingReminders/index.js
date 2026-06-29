const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const COLLECTION = 'feeding_reminders';
const DEFAULT_PAGE = 'pages/daily-feeding/index';
const MAX_BATCH_SIZE = 20;
const MINIPROGRAM_APPID = 'wx731fe4e54b1893ac';
const TIMEZONE_OFFSET_HOURS = 8;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatTime(date = new Date(), timezoneOffsetHours = 0) {
  const shifted = new Date(date.getTime() + timezoneOffsetHours * 60 * 60 * 1000);
  return `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`;
}

function formatDateTime(date = new Date(), timezoneOffsetHours = 0) {
  const shifted = new Date(date.getTime() + timezoneOffsetHours * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())} ${formatTime(date, timezoneOffsetHours)}`;
}

function limitThing(value, maxLength = 20) {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function errorMessage(error) {
  if (!error) return 'unknown error';
  return error.errMsg || error.message || String(error);
}

function buildMessageData(reminder = {}) {
  const dueAt = reminder.dueAt ? new Date(reminder.dueAt) : new Date();
  return {
    thing5: { value: limitThing(reminder.title || '宝宝提醒') },
    date4: { value: formatDateTime(dueAt, TIMEZONE_OFFSET_HOURS) },
    thing2: { value: limitThing(reminder.content || '该记录啦') },
    thing11: { value: limitThing(reminder.note || reminder.hintText || '记得回到小程序记录') }
  };
}

async function markReminder(id, data) {
  return db.collection(COLLECTION).doc(id).update({
    data: {
      ...data,
      updatedAt: new Date()
    }
  });
}

exports.main = async (event = {}) => {
  const now = new Date();
  const limit = Math.max(1, Math.min(Number(event.limit) || MAX_BATCH_SIZE, MAX_BATCH_SIZE));
  const collection = db.collection('feeding_reminders');
  const remindersRes = await collection
    .where({
      type: 'feedingReminder',
      status: 'pending',
      used: false,
      dueAt: _.lte(now)
    })
    .orderBy('dueAt', 'asc')
    .limit(limit)
    .get();

  const reminders = remindersRes.data || [];
  const summary = { checked: reminders.length, sent: 0, failed: 0, skipped: 0 };

  for (const reminder of reminders) {
    const id = reminder._id;
    if (!id) {
      summary.skipped += 1;
      continue;
    }

    if (!reminder.openid || !reminder.templateId) {
      summary.failed += 1;
      await markReminder(id, {
        status: 'failed',
        used: false,
        lastError: 'missing openid or templateId'
      });
      continue;
    }

    try {
      const sendResult = await cloud.openapi({ appid: MINIPROGRAM_APPID }).subscribeMessage.send({
        touser: reminder.openid,
        templateId: reminder.templateId,
        page: reminder.page || DEFAULT_PAGE,
        miniprogramState: 'formal',
        lang: 'zh_CN',
        data: buildMessageData(reminder)
      });

      summary.sent += 1;
      await markReminder(id, {
        status: 'sent',
        used: true,
        sentAt: new Date(),
        sendResult
      });
    } catch (error) {
      summary.failed += 1;
      await markReminder(id, {
        status: 'failed',
        used: false,
        lastError: errorMessage(error)
      });
    }
  }

  return summary;
};
