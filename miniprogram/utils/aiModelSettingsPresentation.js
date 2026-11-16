const SYNC_TITLES = {
  QUERY_NOT_CONFIGURED: '云端查询授权未配置', QUERY_CREDENTIAL_INCOMPLETE: '云端续期凭证不完整',
  QUERY_TOKEN_FORMAT: '云端查询令牌格式错误',
  QUERY_NETWORK_FAILED: '云端网络连接失败', QUERY_GATEWAY_FAILED: '百炼网关拒绝查询',
  QUERY_OUTPUT_LIMIT: '额度查询响应异常',
  QUERY_AUTH_FAILED: '云端查询授权已失效',
  QUERY_INVALID_RESULT: '额度返回格式异常', QUERY_TIMEOUT: '额度查询超时', QUERY_FAILED: '额度刷新失败'
};

function timeText(value) {
  if (!Number.isFinite(value) || value <= 0) return '尚未同步';
  return new Date(value + 28800000).toISOString().slice(0, 16).replace('T', ' ');
}

function formatTokens(value) {
  if (!Number.isSafeInteger(value) || value < 0) return '额度待同步';
  return (value >= 10000 ? (value / 10000).toFixed(1).replace(/\.0$/, '') + '万' : String(value)) + ' Token';
}

function rowState(entry, source) {
  if (source.authorized === false) return { code: 'UNAUTHORIZED', text: '已撤销授权或不支持当前场景' };
  if (source.blocked) return { code: 'BLOCKED', text: '免费额度已用完或到期，已自动停用' };
  if (!entry.enabled) return { code: 'DISABLED', text: '未启用' };
  if (!entry.verified) return { code: 'UNVERIFIED', text: '业务效果待核验' };
  return { code: 'READY', text: '已加入调用顺序' };
}

function quotaStatus(view, fresh) {
  const quota = view.quota;
  if (quota.syncStatus === 'syncing' && quota.syncing !== false) {
    return { title: '额度正在同步', detail: '完成后更新余额显示，不影响模型调用。', tone: 'muted' };
  }
  if (quota.syncError) return {
    title: SYNC_TITLES[quota.syncCode] || (!view.queryConfigured ? '云端查询授权未配置' : '额度刷新失败'),
    detail: quota.syncError, tone: 'error'
  };
  if (!quota.checkedAt) return view.queryConfigured ?
    { title: '额度尚未查询', detail: '可按需刷新免费余额与有效期，不影响模型选择和调用。', tone: 'muted' } :
    { title: '额度查询授权未配置', detail: '配置查询授权后可查看免费余额；不影响模型选择和调用。', tone: 'muted' };
  if (!fresh) return { title: '额度为上次查询结果', detail: '更新时间 ' + timeText(quota.checkedAt) + '（北京时间）；可按需刷新，不影响模型调用。', tone: 'muted' };
  return { title: '额度已同步', detail: '更新时间 ' + timeText(quota.checkedAt) + '（北京时间）', tone: 'muted' };
}

function buildSettingsPresentation(view, draft, scene, now, dirty) {
  const quota = view.quota;
  const maxAge = (view.quotaMaxAgeMinutes || 15) * 60000;
  const fresh = Number.isSafeInteger(quota.checkedAt) && quota.checkedAt > 0 && now >= quota.checkedAt && now - quota.checkedAt < maxAge;
  const pools = {};
  for (const key of ['search', 'scan', 'report']) {
    const sources = Object.fromEntries(view.pools[key].map(entry => [entry.model, entry]));
    pools[key] = draft.pools[key].map((entry, index, entries) => {
      const source = sources[entry.model] || {};
      const state = rowState(entry, source);
      return { ...entry, enabled: entry.enabled && !source.blocked, blocked: !!source.blocked,
        authorized: source.authorized !== false, title: source.name || entry.model, reason: state.text, reasonCode: state.code,
        available: state.code === 'READY', first: index === 0, last: index === entries.length - 1, number: index + 1,
        remainingText: source.quotaStatus === 'not_provided' ? '未返回免费额度' : formatTokens(source.remaining),
        expiresText: source.expires ? source.expires + ' 到期' : source.quotaStatus === 'reported' ? '有效期未提供' : '',
        protectionText: source.autoStop === true ? '已开启' : source.autoStop === false ? '未开启' : source.autoStop === null ? '未提供' : '待查询' };
    });
  }
  const rows = pools[scene];
  const selected = rows.filter(entry => entry.enabled);
  const available = rows.filter(entry => entry.available);
  const quotaFeedback = quotaStatus(view, fresh);
  const catalog = view.catalog || {};
  const catalogFeedback = catalog.syncError ? { title: '模型名单同步失败', detail: catalog.syncError, tone: 'error' }
    : catalog.syncing ? { title: '模型名单正在同步', detail: '同步完成后更新可选模型。', tone: 'muted' }
      : catalog.checkedAt ? { title: '已同步千问授权模型', detail: '更新时间 ' + timeText(catalog.checkedAt) + '（北京时间）', tone: 'muted' }
        : { title: '模型名单尚未同步', detail: '同步后显示当前业务空间已授权且支持本场景的模型。', tone: 'muted' };
  let summary;
  if (scene === 'report' && !view.config.configured && !dirty) summary = {
    title: '报告模型尚未启用', detail: '同步模型名单后，启用适用的 OCR 模型并保存。', tone: 'warning'
  };
  else if (!view.config.configured && !dirty) summary = {
    title: '沿用原有配置', detail: '调整模型后，保存即可生效。', tone: 'muted'
  };
  else if (!draft.enabled) summary = { title: 'AI 服务已关闭', detail: '关闭后暂停新的搜索理解与识别请求。', tone: 'muted' };
  else if (!selected.length) summary = { title: '本场景未启用模型', detail: '启用下方模型，按列表顺序自动切换。', tone: 'warning' };
  else if (!available.length) summary = {
    title: [...new Set(selected.map(entry => entry.reason))].join(' / '), detail: '请查看模型状态，调整启用名单。', tone: 'warning'
  };
  else summary = { title: available[0].title, detail: available.length > 1 ?
    '按顺序调用 ' + available.length + ' 个模型，接口确认免费额度不可用时自动切换。' : '当前有 1 个待调用模型，可继续添加备用。', tone: 'ready' };
  const selectedAnywhere = Object.values(pools).some(entries => entries.some(entry => entry.enabled));
  const saveBlocked = draft.enabled && !selectedAnywhere;
  return { rows, summary, quotaFeedback, catalogFeedback, fresh, saveBlocked,
    saveHint: saveBlocked ? '请至少启用一个模型' : dirty ? '有修改待保存' : '暂无未保存的修改',
    summaryLabel: dirty ? '保存后预览' : '当前配置' };
}

module.exports = { buildSettingsPresentation, timeText };
