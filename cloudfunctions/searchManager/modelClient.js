'use strict';
const https = require('https');
const { fail } = require('./lib/search');
function post(config, body, deadline) {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now(); if (remaining <= 0) return reject(Object.assign(new Error('智能解析已超时'), { code: 'MODEL_TIMEOUT' }));
    let done = false; let timer;
    const end = (error, value) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const payload = Buffer.from(JSON.stringify(body));
    const request = https.request(config.baseUrl + '/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + config.apiKey, 'Content-Type': 'application/json', 'Content-Length': payload.length } }, response => {
      const chunks = []; let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; if (bytes > 131072) { end(Object.assign(new Error('智能解析响应过大'), { code: 'INVALID_MODEL_RESULT' })); response.destroy(); request.destroy(); } else chunks.push(chunk); });
      response.on('error', () => end(Object.assign(new Error('智能解析连接中断'), { code: 'MODEL_UNAVAILABLE' })));
      response.on('end', () => {
        let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { return end(Object.assign(new Error('智能解析格式无效'), { code: 'INVALID_MODEL_RESULT' })); }
        if (response.statusCode >= 400) {
          const free = ((value.error || {}).code || value.code) === 'AllocationQuota.FreeTierOnly';
          return end(Object.assign(new Error(free ? '模型免费额度已用完或到期' : response.statusCode === 429 ? '智能服务繁忙，请稍后重试' : '智能服务暂不可用'), { code: free ? 'FREE_QUOTA_EXHAUSTED' : response.statusCode === 429 ? 'MODEL_RATE_LIMIT' : 'MODEL_UNAVAILABLE' }));
        }
        end(null, value);
      });
    });
    request.on('error', () => end(Object.assign(new Error('智能解析连接失败'), { code: 'MODEL_UNAVAILABLE' })));
    timer = setTimeout(() => { end(Object.assign(new Error('智能解析已超时'), { code: 'MODEL_TIMEOUT' })); request.destroy(); }, remaining);
    request.end(payload);
  });
}
function configFor(env, policy) {
  let url; try { url = new URL(env.BAILIAN_BASE_URL); } catch (_) { fail('CONFIG_MISSING', '智能服务配置无效'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail('CONFIG_MISSING', '智能服务配置无效');
  return { baseUrl: url.origin + url.pathname.replace(/\/+$/, ''), apiKey: env.DASHSCOPE_API_KEY, model: policy.primaryModel };
}
async function callIntentModel({ query, env, policy, request = post, deadline = Date.now() + 10000, instruction, semanticContext, queryContext, repair, maxTokens = 1400, maxCalls = 2 }) {
  if (typeof instruction !== 'string' || !instruction.trim()) fail('CONFIG_MISSING', '搜索意图规则尚未配置');
  const primary = configFor(env, policy); const calls = []; let actual = primary;
  const call = async config => {
    const messages = [{ role: 'system', content: instruction }];
    if (queryContext) messages.push({ role: 'system', content: '服务器提供的日期上下文：' + JSON.stringify(queryContext) });
    if (semanticContext) messages.push({ role: 'user', content: '上次已确认的查询语义：' + JSON.stringify(semanticContext) });
    messages.push({ role: 'user', content: query });
    if (repair) {
      if (repair.previous) messages.push({ role: 'assistant', content: JSON.stringify(repair.previous).slice(0, 6000) });
      messages.push({ role: 'user', content: '上一次意图没有通过校验：' + JSON.stringify({ code: repair.code, message: String(repair.message || '').slice(0, 1200) }) +
        '。请结合原问句和能力注册表修正，保留全部条件；不要通过删条件来通过校验。返回完整JSON。' });
    }
    const body = { model: config.model, stream: false, max_tokens: maxTokens, response_format: { type: 'json_object' }, messages };
    if (/^qwen3[.-]/.test(config.model) && /aliyuncs\.com$/.test(new URL(config.baseUrl).hostname)) body.enable_thinking = false;
    const response = await request(config, body, deadline);
    calls.push({ model: config.model, inputTokens: Number((response.usage || {}).prompt_tokens) || 0, outputTokens: Number((response.usage || {}).completion_tokens) || 0 });
    return response;
  };
  let response;
  try {
  try { response = await call(primary); }
  catch (error) { calls.push({ model: primary.model, error: error.code }); if (error.code !== 'FREE_QUOTA_EXHAUSTED' || !policy.fallbackModel || maxCalls < 2) throw error; actual = { ...primary, model: policy.fallbackModel }; response = await call(actual); }
  const choice = (response.choices || [])[0];
    if (!choice || choice.finish_reason !== 'stop' || typeof (choice.message || {}).content !== 'string') fail('INVALID_MODEL_RESULT', '模型响应未完整结束，请仅输出适用字段的完整JSON对象。');
  let plan; try { plan = JSON.parse(choice.message.content); } catch (_) { fail('INVALID_MODEL_RESULT', '模型输出不是有效JSON，请修正结构并只返回完整JSON对象。'); }
  return { plan, usage: calls, model: actual.model };
  } catch (error) { error.usage = calls; throw error; }
}
module.exports = { post, callIntentModel, configFor };
