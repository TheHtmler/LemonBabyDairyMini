const crypto = require('crypto');

const ENTRIES = 'feedback_thread_entries';
const PAGE_SIZE = 30;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function conversationVersion(item) {
  if (Number.isSafeInteger(item.conversationVersion) && item.conversationVersion >= 0) return item.conversationVersion;
  return typeof item.replyContent === 'string' && item.replyContent.trim() ? 1 : 0;
}

function createFeedbackThreadService({ db, command, readFeedback, requireAdmin, requireId,
  version, text, fail, dateText, toUserFeedback, toAdminFeedback, checkText }) {
  function authorize(item, openid, adminView) {
    if (adminView) requireAdmin(openid);
    else if (item.openid !== openid) fail('该反馈不存在或暂时无法查看', 'NOT_FOUND');
  }

  function publicEntry(entry) {
    return {
      _id: entry._id, sequence: entry.sequence, role: entry.role,
      content: text(entry.content), createdAt: dateText(entry.createdAt),
      replyVersion: version(entry.replyVersion),
      replyTo: entry.replyTo ? {
        id: entry.replyTo.id, role: entry.replyTo.role, content: text(entry.replyTo.content)
      } : null
    };
  }

  function existingReply(item) {
    if ((Number.isSafeInteger(item.conversationVersion) && item.conversationVersion >= 0) || !text(item.replyContent)) return null;
    return {
      _id: 'seed-' + hash(item._id), feedbackId: item._id, sequence: 1, role: 'admin',
      content: text(item.replyContent), createdAt: item.repliedAt || item.createdAt,
      replyVersion: version(item.replyVersion), replyTo: null
    };
  }

  async function pageEntries(item, before) {
    const ceiling = conversationVersion(item) + 1;
    if (before != null && (!Number.isSafeInteger(before) || before < 1 || before > ceiling)) fail('分页参数无效');
    const cursor = before || ceiling;
    const seed = existingReply(item);
    if (seed) return { entries: cursor > 1 ? [publicEntry(seed)] : [], nextCursor: null };
    if (ceiling === 1) return { entries: [], nextCursor: null };
    const result = await db.collection(ENTRIES).where({
      feedbackId: item._id, sequence: command.lt(cursor)
    }).orderBy('sequence', 'desc').limit(PAGE_SIZE + 1).get();
    const rows = result.data || [];
    const page = rows.slice(0, PAGE_SIZE).reverse();
    return {
      entries: page.map(publicEntry),
      nextCursor: rows.length > PAGE_SIZE ? page[0].sequence : null
    };
  }

  async function getDetail(event, openid) {
    const id = requireId(event.id);
    const adminView = event.view === 'admin';
    if (adminView) requireAdmin(openid);
    const item = await readFeedback(db, id);
    authorize(item, openid, adminView);
    return {
      ok: true, data: adminView ? toAdminFeedback(item) : toUserFeedback(item),
      canReply: adminView, ...await pageEntries(item)
    };
  }

  async function listEntries(event, openid) {
    const item = await readFeedback(db, requireId(event.id));
    authorize(item, openid, event.view === 'admin');
    return { ok: true, ...await pageEntries(item, event.before) };
  }

  async function appendEntry(event, openid) {
    const id = requireId(event.id);
    const content = text(event.content);
    const adminView = event.view === 'admin';
    const mode = event.mode || 'reply';
    if (!content || content.length > 1000) fail('请填写 1–1000 字的补充或回复');
    if (!['reply', 'process'].includes(mode) || (!adminView && mode !== 'reply')) fail('处理方式无效');
    if (!Number.isSafeInteger(event.baseConversationVersion) || event.baseConversationVersion < 0) fail('处理记录版本无效');
    const requestId = text(event.requestId);
    if (!/^[\w-]{8,100}$/.test(requestId)) fail('提交标识无效');
    const replyToId = event.replyToId ? requireId(event.replyToId) : '';
    const entryId = 'entry-' + hash(JSON.stringify([id, openid, requestId]));
    const fingerprint = hash(JSON.stringify([content, adminView, mode, replyToId, event.baseConversationVersion]));
    const initial = await readFeedback(db, id);
    authorize(initial, openid, adminView);
    const prior = await db.collection(ENTRIES).doc(entryId).get();
    if (prior.data && prior.data._id) {
      if (prior.data.requestFingerprint !== fingerprint) fail('提交内容已变化，请使用新的提交标识', 'CONFLICT');
      return getDetail(event, openid);
    }
    await checkText(content, openid);
    await db.runTransaction(async transaction => {
      const item = await readFeedback(transaction, id);
      authorize(item, openid, adminView);
      const duplicate = await transaction.collection(ENTRIES).doc(entryId).get();
      if (duplicate.data && duplicate.data._id) {
        if (duplicate.data.requestFingerprint !== fingerprint) fail('提交内容已变化，请重新提交', 'CONFLICT');
        return;
      }
      const currentVersion = conversationVersion(item);
      if (currentVersion !== event.baseConversationVersion) fail('处理记录已有更新，请刷新后继续，草稿会保留', 'CONFLICT');
      const lastAt = adminView ? item.lastAdminEntryAt : item.lastUserEntryAt;
      const lastTime = new Date(dateText(lastAt)).getTime();
      if (Number.isFinite(lastTime) && Date.now() - lastTime < 3000) fail('提交较频繁，请稍后重试', 'RATE_LIMITED');
      const seed = existingReply(item);
      let replyTo = null;
      if (replyToId) {
        const response = seed && seed._id === replyToId ? { data: seed }
          : await transaction.collection(ENTRIES).doc(replyToId).get();
        const target = response.data;
        if (!target || target.feedbackId !== id || (!adminView && target.role !== 'admin')) {
          fail('只能针对当前反馈的管理员回复继续追问', 'INVALID_ARGUMENT');
        }
        replyTo = { id: replyToId, role: target.role, content: text(target.content).slice(0, 160) };
      }
      const nextReplyVersion = version(item.replyVersion) + (adminView ? 1 : 0);
      if (seed) {
        const { _id, ...data } = seed;
        await transaction.collection(ENTRIES).doc(_id).set({ data });
      }
      await transaction.collection(ENTRIES).doc(entryId).set({ data: {
        feedbackId: id, sequence: currentVersion + 1, role: adminView ? 'admin' : 'user',
        content, replyTo, replyVersion: adminView ? nextReplyVersion : 0,
        createdAt: db.serverDate(), requestFingerprint: fingerprint
      } });
      const data = {
        conversationVersion: currentVersion + 1, lastMessageContent: content,
        lastMessageRole: adminView ? 'admin' : 'user', lastMessageAt: db.serverDate(), updatedAt: db.serverDate()
      };
      if (adminView) {
        Object.assign(data, {
          replyContent: content, replyVersion: nextReplyVersion,
          repliedAt: db.serverDate(), repliedBy: openid, hasUnreadReply: true, lastAdminEntryAt: db.serverDate()
        });
        if (mode === 'process') data.status = 'processed';
      } else {
        Object.assign(data, {
          status: 'new', lastUserContent: content, lastUserEntryAt: db.serverDate(),
          followUpCount: version(item.followUpCount) + 1
        });
      }
      await transaction.collection('feedback_messages').doc(id).update({ data });
    });
    return getDetail(event, openid);
  }

  async function deleteEntries(id) {
    // 锁定主记录后清理分页，阻止清理期间继续追加；失败时管理员可重试。
    await db.runTransaction(async transaction => {
      await readFeedback(transaction, id, true);
      await transaction.collection('feedback_messages').doc(id).update({ data: { deleting: true } });
    });
    while (true) {
      const result = await db.collection(ENTRIES).where({ feedbackId: id }).limit(40).get();
      if (!result.data || !result.data.length) return;
      await Promise.all(result.data.map(entry => db.collection(ENTRIES).doc(entry._id).remove()));
    }
  }

  return { getDetail, listEntries, appendEntry, deleteEntries };
}

module.exports = { createFeedbackThreadService, conversationVersion };
