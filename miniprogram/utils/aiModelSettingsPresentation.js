const MODEL_LABELS = {
  'qwen3.8-max-0902': 'Qwen3.8 Max · 0902', 'qwen3.8-max': 'Qwen3.8 Max',
  'qwen3.7-max': 'Qwen3.7 Max', 'qwen3.7-max-2026-05-20': 'Qwen3.7 Max · 0520',
  'qwen3.7-plus-2026-05-26': 'Qwen3.7 Plus · 0526',
  'qwen3.5-122b-a10b': 'Qwen3.5 122B', 'qwen3.7-plus': 'Qwen3.7 Plus'
};
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
  if (!entry.enabled) return { code: 'DISABLED', text: '未启用' };
  if (!entry.verified) return { code: 'UNVERIFIED', text: '业务效果待核验' };
  if (source.blocked) return { code: 'BLOCKED', text: '调用已确认免费额度不可用' };
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
  for (const key of ['search', 'scan']) {
    const sources = Object.fromEntries(view.pools[key].map(entry => [entry.model, entry]));
    pools[key] = draft.pools[key].map((entry, index, entries) => {
      const source = sources[entry.model] || {};
      const state = rowState(entry, source);
      return { ...entry, title: MODEL_LABELS[entry.model] || entry.model, reason: state.text, reasonCode: state.code,
        available: state.code === 'READY', first: index === 0, last: index === entries.length - 1, number: index + 1,
        remainingText: formatTokens(source.remaining), expiresText: source.expires || '',
        protectionText: source.autoStop === true ? '已开启' : source.autoStop === false ? '未开启' : '待查询' };
    });
  }
  const rows = pools[scene];
  const selected = rows.filter(entry => entry.enabled);
  const available = rows.filter(entry => entry.available);
  const quotaFeedback = quotaStatus(view, fresh);
  let summary;
  if (!view.config.configured && !dirty) summary = {
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
  return { rows, summary, quotaFeedback, fresh, saveBlocked,
    saveHint: saveBlocked ? '请至少启用一个模型' : dirty ? '有修改待保存' : '暂无未保存的修改',
    summaryLabel: dirty ? '保存后预览' : '当前配置' };
}

module.exports = { buildSettingsPresentation, timeText };
