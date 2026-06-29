const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('home reminder card is a single minimal entry to the reminder center', () => {
  const dailyFeeding = fs.readFileSync('miniprogram/pages/daily-feeding/index.js', 'utf8');
  const dailyFeedingWxml = fs.readFileSync('miniprogram/pages/daily-feeding/index.wxml', 'utf8');

  assert.match(dailyFeeding, /goToFutureReminders\(\)/);
  assert.match(dailyFeedingWxml, /微信提醒/);
  assert.match(dailyFeedingWxml, /catchtap="goToFutureReminders"/);
  assert.doesNotMatch(dailyFeedingWxml, /requestUpcomingRecordReminderSubscription|订阅最近一条/);
  assert.doesNotMatch(dailyFeeding, /requestUpcomingRecordReminderSubscription/);

  // 极简入口：不再预拉候选、不再渲染三类预览列表。
  assert.doesNotMatch(dailyFeedingWxml, /wx:for="\{\{upcomingReminderCards\}\}"/);
  assert.doesNotMatch(dailyFeeding, /upcomingReminderCards/);
  assert.doesNotMatch(dailyFeeding, /loadUpcomingReminderCandidates/);
});

test('record save flows do not prompt subscription reminders inline', () => {
  const milkEditor = fs.readFileSync('miniprogram/pkg-milk/milk-feeding-editor-v2/index.js', 'utf8');
  const mealEditor = fs.readFileSync('miniprogram/pkg-records/meal-editor/index.js', 'utf8');
  const dailyFeeding = fs.readFileSync('miniprogram/pages/daily-feeding/index.js', 'utf8');

  assert.doesNotMatch(milkEditor, /promptSubscribeRecordReminder|promptSubscribeSavedFeedingReminder|订阅这顿奶提醒/);
  assert.match(milkEditor, /rescheduleReminderSubscriptions/);

  assert.doesNotMatch(mealEditor, /promptSubscribeRecordReminder|promptSubscribeSavedMealReminder|订阅这顿辅食提醒/);
  assert.match(mealEditor, /rescheduleReminderSubscriptions/);

  assert.doesNotMatch(dailyFeeding, /promptSubscribeRecordReminder|订阅这次用药提醒|重新订阅用药提醒/);
  assert.match(dailyFeeding, /rescheduleReminderSubscriptions/);
});

test('reminder statuses cover subscribed sent failed expired and invalidated states', () => {
  const {
    REMINDER_STATUSES,
    normalizeReminderStatus
  } = require('../miniprogram/utils/feedingReminderSubscription');

  assert.equal(REMINDER_STATUSES.PENDING, 'pending');
  assert.equal(REMINDER_STATUSES.SENT, 'sent');
  assert.equal(REMINDER_STATUSES.FAILED, 'failed');
  assert.equal(REMINDER_STATUSES.EXPIRED, 'expired');
  assert.equal(REMINDER_STATUSES.STALE, 'stale');
  assert.equal(REMINDER_STATUSES.CANCELLED, 'cancelled');

  assert.deepEqual(
    normalizeReminderStatus({
      status: 'pending',
      dueAt: new Date('2026-06-29T06:00:00Z')
    }, new Date('2026-06-29T06:10:00Z')),
    { key: 'expired', label: '已过期', tone: 'expired' }
  );
});

test('wechat reminder page lists future records per category for one-shot subscription', () => {
  const appJson = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'));
  const miscPackage = appJson.subPackages.find((pkg) => pkg.root === 'pkg-misc');

  assert.ok(miscPackage.pages.includes('future-reminders/index'));
  [
    'miniprogram/pkg-misc/future-reminders/index.js',
    'miniprogram/pkg-misc/future-reminders/index.json',
    'miniprogram/pkg-misc/future-reminders/index.wxml',
    'miniprogram/pkg-misc/future-reminders/index.wxss'
  ].forEach((filePath) => assert.ok(fs.existsSync(filePath), `${filePath} should exist`));

  const pageJs = fs.readFileSync('miniprogram/pkg-misc/future-reminders/index.js', 'utf8');
  const pageWxml = fs.readFileSync('miniprogram/pkg-misc/future-reminders/index.wxml', 'utf8');
  const pageJson = fs.readFileSync('miniprogram/pkg-misc/future-reminders/index.json', 'utf8');

  assert.match(pageJson, /微信提醒/);
  assert.match(pageJs, /feeding_reminders/);
  assert.match(pageJs, /REMINDER_CATEGORY_CONFIG/);
  assert.match(pageJs, /喂奶提醒/);
  assert.match(pageJs, /食物提醒/);
  assert.match(pageJs, /用药提醒/);
  assert.match(pageJs, /buildReminderCategorySections/);
  assert.match(pageJs, /activeReminderType/);
  assert.match(pageJs, /activeReminderSection/);
  assert.match(pageJs, /switchReminderTab/);
  assert.match(pageJs, /statusFilter/);
  assert.match(pageJs, /setStatusFilter/);
  assert.match(pageJs, /全部/);
  assert.match(pageJs, /未提醒/);
  assert.match(pageJs, /_lastCandidates/);
  assert.match(pageJs, /_lastReminderRecords/);
  assert.match(pageJs, /buildUpcomingReminderCandidates/);
  assert.match(pageJs, /requestCandidateReminderSubscription/);
  assert.match(pageJs, /loadFutureRecordCandidates/);
  assert.match(pageJs, /normalizeReminderStatus/);
  assert.match(pageJs, /resolveCandidateReminderStatus/);
  assert.match(pageJs, /retryReminder/);

  // 多成员：提醒记录查询必须按当前用户 openid 过滤，避免看到其他成员的订阅状态。
  const loadBlock = pageJs.match(/async loadReminderRecords\([\s\S]*?return res\.data/);
  assert.ok(loadBlock, 'loadReminderRecords should exist');
  assert.match(loadBlock[0], /openid/);

  // 始终提醒已下线：不再有 always 模式、本地 modes 设置与 switch 开关。
  assert.doesNotMatch(pageJs, /REMINDER_MODE_STORAGE_KEY/);
  assert.doesNotMatch(pageJs, /feeding_reminder_modes/);
  assert.doesNotMatch(pageJs, /toggleAlwaysReminder/);
  assert.doesNotMatch(pageJs, /REMINDER_MODES/);

  assert.match(pageWxml, /微信提醒/);
  // 提醒非实时发送：云函数每 10 分钟扫一次，需在文案中告知用户可能的延迟。
  assert.match(pageWxml, /10\s*分钟内/);
  // 订阅消息按 openid 发：需告知提醒只发给授权本人，其他成员要各自授权。
  assert.match(pageWxml, /其他成员/);
  assert.match(pageWxml, /class="category-tabs"/);
  assert.match(pageWxml, /wx:for="\{\{reminderSections\}\}"/);
  assert.match(pageWxml, /catchtap="switchReminderTab"/);
  assert.match(pageWxml, /catchtap="setStatusFilter"/);
  assert.match(pageWxml, /activeReminderSection\.statusFilters/);
  assert.match(pageWxml, /activeReminderSection\.visibleItems/);
  assert.match(pageWxml, /activeReminderSection/);
  assert.match(pageWxml, /catchtap="subscribeReminder"/);
  assert.match(pageWxml, /订阅提醒/);

  assert.doesNotMatch(pageWxml, /<switch/);
  assert.doesNotMatch(pageWxml, /toggleAlwaysReminder/);
  assert.doesNotMatch(pageWxml, /始终提醒/);
  // hero 顶部不再堆砌一排无意义的状态图例词；状态靠每条 item 的彩色标签自解释。
  assert.doesNotMatch(pageWxml, /hero-legend/);
});

test('sent reminder becomes re-subscribable after its record moves to the future', () => {
  const {
    resolveCandidateReminderStatus
  } = require('../miniprogram/utils/feedingReminderSubscription');
  const now = new Date('2026-06-29T10:00:00Z');

  // 已发送：dueAt 在过去；记录时间被改到更晚的未来 → 应视为未提醒，可重新订阅。
  const moved = resolveCandidateReminderStatus(
    { status: 'sent', dueAt: new Date('2026-06-29T08:00:00Z') },
    { dueAtMs: new Date('2026-06-30T08:00:00Z').getTime(), dueAt: new Date('2026-06-30T08:00:00Z') },
    now
  );
  assert.equal(moved.key, 'unsubscribed');
  assert.equal(moved.active, false);

  // 未改时间的 pending 提醒仍是“已订阅”。
  const pending = resolveCandidateReminderStatus(
    { status: 'pending', dueAt: new Date('2026-06-30T08:00:00Z') },
    { dueAtMs: new Date('2026-06-30T08:00:00Z').getTime() },
    now
  );
  assert.equal(pending.key, 'pending');
  assert.equal(pending.active, true);

  // 没有任何提醒记录 → 未提醒。
  const none = resolveCandidateReminderStatus(null, { dueAtMs: now.getTime() + 1000 }, now);
  assert.equal(none.key, 'unsubscribed');
  assert.equal(none.active, false);
});

test('record time edits reschedule unused reminder without asking for another authorization', async () => {
  const {
    rescheduleReminderSubscriptions
  } = require('../miniprogram/utils/reminderSubscriptionPrompt');

  const updates = [];
  const fakeWx = {
    getStorageSync(key) {
      return key === 'feeding_reminder_subscription'
        ? { sourceKey: 'milk:old-1', status: 'pending' }
        : '';
    },
    setStorageSync(key, value) {
      updates.push({ storageKey: key, value });
    },
    cloud: {
      database() {
        return {
          command: {
            in(values) {
              return { $in: values };
            }
          },
          collection(name) {
            assert.equal(name, 'feeding_reminders');
            return {
              where(query) {
                updates.push({ query });
                return {
                  update({ data }) {
                    updates.push({ data });
                    return Promise.resolve({ stats: { updated: 1 } });
                  }
                };
              }
            };
          }
        };
      }
    }
  };

  await rescheduleReminderSubscriptions({
    wxApi: fakeWx,
    sourceKey: 'milk:old-1',
    candidate: {
      dueAt: new Date('2026-06-29T08:30:00Z'),
      timeText: '2026-06-29 16:30',
      title: '宝宝喂奶提醒',
      content: '该喂奶啦',
      note: '120ml'
    }
  });

  assert.deepEqual(updates[0].query.status, { $in: ['pending', 'failed'] });
  assert.equal(updates[1].data.status, 'pending');
  assert.equal(updates[1].data.used, false);
  assert.equal(updates[1].data.dueAtText, '2026-06-29 16:30');
  assert.equal(updates[2].value.status, 'pending');
  assert.equal(updates[2].value.dueAtText, '2026-06-29 16:30');
});

test('edit flows reschedule old reminders while delete flows cancel them', () => {
  const milkEditor = fs.readFileSync('miniprogram/pkg-milk/milk-feeding-editor-v2/index.js', 'utf8');
  const mealEditor = fs.readFileSync('miniprogram/pkg-records/meal-editor/index.js', 'utf8');
  const dailyFeeding = fs.readFileSync('miniprogram/pages/daily-feeding/index.js', 'utf8');

  assert.match(milkEditor, /rescheduleReminderSubscriptions/);
  assert.doesNotMatch(milkEditor, /didRescheduleReminder|提醒时间已同步|editorMode === 'create'/);

  assert.match(mealEditor, /rescheduleReminderSubscriptions/);
  assert.doesNotMatch(mealEditor, /didRescheduleReminder|提醒时间已同步|mode === 'create'/);

  assert.match(dailyFeeding, /invalidateReminderSubscriptions/);
  assert.match(dailyFeeding, /rescheduleReminderSubscriptions/);
  assert.match(dailyFeeding, /status:\s*'cancelled'/);
  assert.match(dailyFeeding, /record deleted/);
});
