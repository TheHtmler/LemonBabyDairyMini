const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('feeding reminder subscription config keeps template id explicit and configurable', () => {
  const configPath = 'miniprogram/config/subscribeMessage.js';
  assert.ok(fs.existsSync(configPath));

  const source = fs.readFileSync(configPath, 'utf8');
  assert.match(source, /feedingReminder/);
  assert.match(source, /FEEDING_REMINDER_TEMPLATE_ID/);
  assert.doesNotMatch(source, /appid|secret|AppSecret/i);

  const config = require('../miniprogram/config/subscribeMessage');
  assert.equal(
    config.SUBSCRIBE_MESSAGE_TEMPLATE_IDS.feedingReminder,
    'AYPTQ_RSsUtfzFrfXlDOdqzu7Sum2CA6u6prA41NBc8'
  );
});

test('feeding reminder helper builds one-shot future record subscription records', () => {
  const {
    FEEDING_REMINDER_STORAGE_KEY,
    buildFeedingReminderSubscription,
    getFeedingReminderTemplateId,
    isFeedingReminderTemplateConfigured,
    resolveSubscribeStatus
  } = require('../miniprogram/utils/feedingReminderSubscription');

  assert.equal(FEEDING_REMINDER_STORAGE_KEY, 'feeding_reminder_subscription');
  assert.equal(isFeedingReminderTemplateConfigured(''), false);
  assert.equal(isFeedingReminderTemplateConfigured('YOUR_TEMPLATE_ID'), false);
  assert.equal(isFeedingReminderTemplateConfigured('tmpl_123'), true);
  assert.equal(getFeedingReminderTemplateId({ feedingReminder: ' tmpl_123 ' }), 'tmpl_123');
  assert.equal(resolveSubscribeStatus({ tmpl_123: 'accept' }, 'tmpl_123'), 'accept');

  const record = buildFeedingReminderSubscription({
    babyUid: 'baby-1',
    openid: 'openid-1',
    templateId: 'tmpl_123',
    candidate: {
      sourceType: 'milk',
      sourceRecordId: 'milk-1',
      sourceKey: 'milk:milk-1',
      dueAt: new Date('2026-06-29T15:00:00+08:00'),
      title: '宝宝喂奶提醒',
      content: '该喂奶啦',
      note: '120ml'
    },
    subscribedAt: 1710000000000
  });

  assert.deepEqual(record, {
    type: 'feedingReminder',
    babyUid: 'baby-1',
    openid: 'openid-1',
    templateId: 'tmpl_123',
    status: 'accepted',
    used: false,
    subscribedAt: 1710000000000,
    sourceType: 'milk',
    sourceRecordId: 'milk-1',
    sourceKey: 'milk:milk-1',
    dueAt: new Date('2026-06-29T15:00:00+08:00'),
    title: '宝宝喂奶提醒',
    content: '该喂奶啦',
    note: '120ml',
    hintText: '120ml'
  });
});

test('daily feeding page exposes a single minimal wechat reminder entry on home', () => {
  const dailyFeeding = fs.readFileSync('miniprogram/pages/daily-feeding/index.js', 'utf8');
  const dailyFeedingWxml = fs.readFileSync('miniprogram/pages/daily-feeding/index.wxml', 'utf8');
  const dailyFeedingWxss = fs.readFileSync('miniprogram/pages/daily-feeding/index.wxss', 'utf8');

  assert.match(dailyFeeding, /goToFutureReminders/);
  assert.doesNotMatch(dailyFeeding, /requestUpcomingRecordReminderSubscription\s*\(/);
  assert.doesNotMatch(dailyFeeding, /wx\.requestSubscribeMessage\(\{\s*tmplIds:\s*\[templateId\]/);

  // 极简入口：首页不再预拉候选、不再渲染预览列表（顺带省掉首页那几次云查询）。
  assert.doesNotMatch(dailyFeeding, /upcomingReminderCards/);
  assert.doesNotMatch(dailyFeeding, /loadUpcomingReminderCandidates/);
  assert.doesNotMatch(dailyFeeding, /feedingReminderStatus/);

  assert.match(dailyFeedingWxml, /class="card future-reminder"/);
  assert.match(dailyFeedingWxml, /catchtap="goToFutureReminders"/);
  assert.match(dailyFeedingWxml, /微信提醒/);
  assert.match(dailyFeedingWxml, /未来提醒/);
  assert.doesNotMatch(dailyFeedingWxml, /wx:for="\{\{upcomingReminderCards\}\}"/);

  const feedBlock = dailyFeedingWxml.match(/<!-- 今日喂养进度 -->[\s\S]*?<!-- 未来提醒 -->/)[0];
  assert.doesNotMatch(feedBlock, /feed-reminder|requestUpcomingRecordReminderSubscription|微信提醒/);

  assert.match(dailyFeedingWxss, /\.future-reminder/);
});

test('reminder center requests subscription before async duplicate check to keep TAP gesture', () => {
  const helper = fs.readFileSync('miniprogram/utils/reminderSubscriptionPrompt.js', 'utf8');
  const futureReminders = fs.readFileSync('miniprogram/pkg-misc/future-reminders/index.js', 'utf8');
  const block = helper.match(/async function requestCandidateReminderSubscription\([\s\S]*?\nmodule\.exports/)[0];
  const requestIndex = block.indexOf('await wxApi.requestSubscribeMessage');
  const beforeRequest = block.slice(0, requestIndex);
  const afterRequest = block.slice(requestIndex);

  assert.ok(requestIndex > 0, 'requestSubscribeMessage should be called in the tap handler');
  assert.doesNotMatch(beforeRequest, /collection\('feeding_reminders'\).*get\(/s);
  assert.match(afterRequest, /saveSubscriptionRecord/);
  assert.match(futureReminders, /catchtap="subscribeReminder"|subscribeReminder\(/);

  // 重新订阅（如已发送后改时间）须幂等：复用同记录+同用户的提醒文档而非无脑新增，避免重复发送。
  const saveBlock = helper.match(/async function saveSubscriptionRecord\([\s\S]*?\n\}/)[0];
  assert.match(saveBlock, /\.update\(/);
  assert.match(saveBlock, /\.add\(/);
});

test('cloud function sends due feeding reminder subscription messages once', () => {
  const functionPath = 'cloudfunctions/sendFeedingReminders/index.js';
  const configPath = 'cloudfunctions/sendFeedingReminders/config.json';
  assert.ok(fs.existsSync(functionPath));
  assert.ok(fs.existsSync(configPath));

  const source = fs.readFileSync(functionPath, 'utf8');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.deepEqual(config.permissions.openapi, ['subscribeMessage.send']);
  assert.equal(config.triggers[0].config, '0 */10 * * * * *', '定时器应为每10分钟，平衡及时性与调用次数');
  assert.match(source, /collection\('feeding_reminders'\)/);
  assert.match(source, /cloud\.openapi\(\{\s*appid:\s*MINIPROGRAM_APPID\s*\}\)\.subscribeMessage\.send/);
  assert.match(source, /status:\s*'pending'/);
  assert.match(source, /status:\s*'sent'/);
  assert.match(source, /status:\s*'failed'/);
  assert.match(source, /templateId/);
  assert.match(source, /MINIPROGRAM_APPID/);
  assert.match(source, /cloud\.openapi\(\{\s*appid:\s*MINIPROGRAM_APPID\s*\}\)\.subscribeMessage\.send/);
  assert.match(source, /reminder\.title/);
  assert.match(source, /reminder\.content/);
  assert.match(source, /reminder\.note/);
  assert.match(source, /thing5/);
  assert.match(source, /TIMEZONE_OFFSET_HOURS\s*=\s*8/);
  assert.match(source, /formatDateTime\(dueAt,\s*TIMEZONE_OFFSET_HOURS\)/);
  assert.match(source, /function formatDateTime/);
  assert.match(source, /date4:\s*\{\s*value:\s*formatDateTime\(dueAt,\s*TIMEZONE_OFFSET_HOURS\)/);
  assert.match(source, /thing2/);
  assert.match(source, /thing11/);
  assert.doesNotMatch(source, /\bthing1:\s*\{|time2:\s*\{|thing3:\s*\{/);
});
