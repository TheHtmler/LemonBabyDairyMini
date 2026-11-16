'use strict';

const https = require('https');
const PAGE_SIZE = 100;
const MAX_MODELS = 2000;
const MODEL_CODE = /^qwen[a-z0-9][a-z0-9._-]{0,114}$|^qwen-[a-z0-9][a-z0-9._-]{0,113}$/i;

function validModelCode(value) {
  return typeof value === 'string' && MODEL_CODE.test(value);
}

function beijingEndpoint(env) {
  try {
    const url = new URL(env.BAILIAN_BASE_URL);
    const trustedHost = url.hostname === 'dashscope.aliyuncs.com' ||
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cn-beijing\.maas\.aliyuncs\.com$/.test(url.hostname);
    return url.protocol === 'https:' && trustedHost && !url.port &&
      !url.username && !url.password && !url.search && !url.hash &&
      url.pathname.replace(/\/+$/, '') === '/compatible-mode/v1';
  } catch (_) { return false; }
}

function discoveryOrigin(env) {
  if (!beijingEndpoint(env)) throw discoveryError('MODEL_LIST_ENDPOINT', '请配置官方北京地域的 BAILIAN_BASE_URL 后同步模型');
  const url = new URL(env.BAILIAN_BASE_URL);
  if (url.hostname !== 'dashscope.aliyuncs.com') return url.origin;
  const workspace = String(env.BAILIAN_WORKSPACE_ID || '').trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(workspace)) {
    throw discoveryError('MODEL_LIST_WORKSPACE_REQUIRED', '自动同步需要业务空间地址；请配置业务空间专属 BAILIAN_BASE_URL，或补充 BAILIAN_WORKSPACE_ID');
  }
  return 'https://' + workspace + '.cn-beijing.maas.aliyuncs.com';
}

function discoveryError(code, message, diagnostic) {
  return Object.assign(new Error(message), { code, ...(diagnostic ? { diagnostic } : {}) });
}

function invalidResult(reason, diagnostic = {}) {
  const stages = { permissions: '授权名单', models: '模型能力', classification: '能力归类', join: '名单合并' };
  const detail = [stages[diagnostic.stage] || '返回数据', reason, diagnostic.field, diagnostic.model, diagnostic.apiCode].filter(Boolean).join('；');
  return discoveryError('MODEL_LIST_INVALID', '模型名单返回不完整或格式异常，已保留上次成功名单（诊断：' + detail + '）',
    { ...diagnostic, reason });
}

function requestPage(origin, pathname, query, apiKey, deadline) {
  return new Promise((resolve, reject) => {
    const diagnostic = { stage: pathname.endsWith('/permissions') ? 'permissions' : 'models', page: query.page_no };
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(discoveryError('MODEL_LIST_TIMEOUT', '模型名单同步超时，已保留上次成功名单'));
    const url = new URL(pathname, origin);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    let settled = false; let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); error ? reject(error) : resolve(result);
    };
    const request = https.get(url, { headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' } }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) { finish(invalidResult('RESPONSE_SIZE_LIMIT', diagnostic)); response.destroy(); request.destroy(); }
        else chunks.push(chunk);
      });
      response.on('error', () => finish(discoveryError('MODEL_LIST_NETWORK', '模型名单连接中断，已保留上次成功名单')));
      response.on('aborted', () => finish(discoveryError('MODEL_LIST_NETWORK', '模型名单连接中断，已保留上次成功名单')));
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return finish(discoveryError('MODEL_LIST_HTTP', [401, 403].includes(response.statusCode)
            ? '模型名单查询鉴权失败，请检查云端 API Key 和业务空间权限'
            : '模型名单查询失败（HTTP ' + response.statusCode + '），已保留上次成功名单',
            { ...diagnostic, httpStatus: response.statusCode, reason: 'HTTP_ERROR' }));
        }
        let result;
        try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch (_) { return finish(invalidResult('NON_JSON_RESPONSE', diagnostic)); }
        if (result?.success !== true || result.code || !result.output) {
          const apiCode = typeof result?.code === 'string' && /^[A-Za-z0-9_.:-]{1,96}$/.test(result.code) ? result.code : undefined;
          return finish(invalidResult('ENVELOPE_INVALID', { ...diagnostic, field: 'success/code/output', ...(apiCode ? { apiCode } : {}) }));
        }
        finish(null, result.output);
      });
    });
    request.on('error', () => finish(discoveryError('MODEL_LIST_NETWORK', '无法连接模型名单接口，请检查云端网络')));
    timer = setTimeout(() => {
      finish(discoveryError('MODEL_LIST_TIMEOUT', '模型名单同步超时，已保留上次成功名单')); request.destroy();
    }, remaining);
  });
}

async function listPages(origin, pathname, field, query, apiKey, deadline) {
  const rows = []; const seen = new Set(); let total;
  for (let page = 1; page <= MAX_MODELS / PAGE_SIZE + 1; page++) {
    const output = await requestPage(origin, pathname, { ...query, page_no: page, page_size: PAGE_SIZE }, apiKey, deadline);
    const batch = output[field];
    const diagnostic = { stage: field === 'permissions' ? 'permissions' : 'models', page };
    if (!Number.isSafeInteger(output.total) || output.total < 0 || output.total > MAX_MODELS) {
      throw invalidResult('TOTAL_INVALID', { ...diagnostic, field: 'output.total' });
    }
    if (total !== undefined && total !== output.total) throw invalidResult('TOTAL_CHANGED', diagnostic);
    if (!Array.isArray(batch) || batch.length > PAGE_SIZE) throw invalidResult('ROWS_INVALID', { ...diagnostic, field: 'output.' + field });
    if (output.page_no !== page) throw invalidResult('PAGE_MISMATCH', { ...diagnostic, field: 'output.page_no' });
    total = output.total;
    for (const row of batch) {
      if (!row || typeof row.model !== 'string' || seen.has(row.model)) throw invalidResult('MODEL_ID_INVALID_OR_DUPLICATE', diagnostic);
      seen.add(row.model); rows.push(row);
    }
    if (rows.length === total) return rows;
    if (!batch.length || rows.length > total) throw invalidResult('ROW_COUNT_MISMATCH', diagnostic);
  }
  throw invalidResult('PAGE_LIMIT', { stage: field === 'permissions' ? 'permissions' : 'models' });
}

function classifyModel(metadata) {
  const diagnostic = { stage: 'classification', model: metadata.model };
  if (!Array.isArray(metadata.capabilities) || metadata.capabilities.some(value => typeof value !== 'string')) {
    throw invalidResult('CAPABILITIES_INVALID', { ...diagnostic, field: 'capabilities' });
  }
  // 向量、语音、图像生成等模型不适用本项目；其输出模态可能合法为空，不应导致整次同步失败。
  if (!metadata.capabilities.some(value => ['TG', 'Reasoning', 'VU'].includes(value))) return [];
  const input = metadata.inference_metadata?.request_modality;
  const output = metadata.inference_metadata?.response_modality;
  if (!Array.isArray(input) || !input.length || input.some(value => typeof value !== 'string')) {
    throw invalidResult('MODALITY_INVALID', { ...diagnostic, field: 'inference_metadata.request_modality' });
  }
  if (!Array.isArray(output) || !output.length || output.some(value => typeof value !== 'string')) {
    throw invalidResult('MODALITY_INVALID', { ...diagnostic, field: 'inference_metadata.response_modality' });
  }
  if (!Array.isArray(metadata.features) || metadata.features.some(value => typeof value !== 'string')) {
    throw invalidResult('FEATURES_INVALID', { ...diagnostic, field: 'features' });
  }
  if (!output.includes('Text')) return [];
  if (/(?:^|-)ocr(?:-|$)/i.test(metadata.model)) {
    const effective = metadata.equivalent_snapshot || metadata.model;
    if (typeof effective !== 'string') throw invalidResult('SNAPSHOT_INVALID', { ...diagnostic, field: 'equivalent_snapshot' });
    const vlVersion = /^qwen-vl-ocr(?:-(\d{4}-\d{2}-\d{2}))?$/i.exec(effective);
    // 此后的 VL 文档解析快照要求固定 Prompt，不能复用当前自定义字段抽取协议。
    if (/^qwen-vl-ocr/i.test(effective) && (!vlVersion || vlVersion[1] > '2025-11-20')) return [];
    return input.includes('Image') ? ['report'] : [];
  }
  // 搜索和食物识别均发送 response_format=json_object，缺少结构化输出能力时不列为候选。
  if (!Array.isArray(metadata.features) || !metadata.features.includes('structured-outputs')) return [];
  return [...(input.includes('Text') ? ['search'] : []), ...(input.includes('Image') ? ['scan'] : [])];
}

async function fetchAuthorizedModels(env) {
  if (!env.DASHSCOPE_API_KEY) throw discoveryError('MODEL_LIST_KEY_MISSING', '请配置云端 DASHSCOPE_API_KEY 后同步模型名单');
  const source = discoveryOrigin(env);
  const deadline = Date.now() + 8000;
  // 两份分页结果均完整后才发布快照，不能把模型广场目录误当作授权名单。
  const results = await Promise.allSettled([
    listPages(source, '/api/v1/models/permissions', 'permissions',
      { authorization_scope: 'AUTHORIZED', action: 'INFERENCE', name: 'qwen' }, env.DASHSCOPE_API_KEY, deadline),
    listPages(source, '/api/v1/models', 'models', { name: 'qwen' }, env.DASHSCOPE_API_KEY, deadline)
  ]);
  const rejected = results.find(result => result.status === 'rejected');
  if (rejected) throw rejected.reason;
  const metadata = new Map(results[1].value.map(row => [row.model, row]));
  const models = [];
  for (const row of results[0].value) {
    if (!validModelCode(row.model)) continue;
    if (typeof row.permissions?.inference !== 'boolean') throw invalidResult('INFERENCE_PERMISSION_INVALID',
      { stage: 'permissions', field: 'permissions.inference', model: row.model });
    if (!row.permissions.inference) continue;
    const details = metadata.get(row.model);
    if (!details) throw invalidResult('MODEL_METADATA_MISSING', { stage: 'join', model: row.model });
    const scenes = classifyModel(details);
    const limit = details.model_info?.max_output_tokens;
    models.push({ code: row.model, name: String(details.name || row.name || row.model).slice(0, 120), scenes,
      maxOutputTokens: Number.isSafeInteger(limit) && limit > 0 ? limit : null });
  }
  models.sort((a, b) => a.code.localeCompare(b.code));
  return { source, models };
}

module.exports = { fetchAuthorizedModels, validModelCode, beijingEndpoint, discoveryOrigin };
