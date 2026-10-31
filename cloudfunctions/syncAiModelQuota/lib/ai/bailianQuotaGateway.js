'use strict';

const https = require('https');
const { createHash, createHmac, randomUUID } = require('crypto');
const { URLSearchParams } = require('url');
// 协议来自百炼官方 CLI 2.7.2 的控制台网关及免费额度命令；不依赖其 Node.js 运行时。
const GATEWAY_HOST = 'bailian-cs.console.aliyun.com';
const QUOTA_API = 'zeldaEasy.bailian-commerce.freeTrial.queryFreeTierQuota';
const PROTECTION_API = 'zeldaEasy.bailian-commerce.freeTrial.queryFreeTierOnlyStatus';
const TOKEN_HOST = 'modelstudio.cn-beijing.aliyuncs.com';
const TOKEN_PATH = '/modelstudio/cli/generateAccessToken';
let cachedAuthorization = null;

function failure(code, reason, stage, httpStatus) {
  return Object.assign(new Error(reason), { code, reason, stage, ...(httpStatus ? { httpStatus } : {}) });
}

function requestJson({ host, requestPath, body, headers, deadline, stage }) {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(failure('QUERY_TIMEOUT', 'REQUEST_DEADLINE', stage));
    let settled = false; let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(result);
    };
    const payload = Buffer.from(body, 'utf8');
    const req = https.request({ hostname: host, path: requestPath, method: 'POST', headers: {
      ...headers, 'Content-Length': payload.length
    } }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          finish(failure('QUERY_OUTPUT_LIMIT', 'RESPONSE_SIZE_LIMIT', stage)); res.destroy(); req.destroy();
        } else chunks.push(chunk);
      });
      res.on('error', error => finish(Object.assign(error, { stage })));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return finish(failure([401, 403].includes(res.statusCode) ? 'QUERY_AUTH_FAILED' : 'QUERY_GATEWAY_FAILED',
            'GATEWAY_HTTP_' + res.statusCode, stage, res.statusCode));
        }
        let result;
        try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch (_) { return finish(failure('QUERY_INVALID_RESULT', 'NON_JSON_RESPONSE', stage)); }
        finish(null, result);
      });
    });
    req.on('error', error => finish(Object.assign(error, { stage })));
    timer = setTimeout(() => {
      finish(failure('QUERY_TIMEOUT', 'REQUEST_DEADLINE', stage)); req.destroy();
    }, remaining);
    req.end(payload);
  });
}

function checkEnvelope(value, stage, codes) {
  if (!value || typeof value !== 'object') throw failure('QUERY_INVALID_RESULT', 'INVALID_ENVELOPE', stage);
  const ret = Array.isArray(value.ret) ? value.ret.map(String) : [];
  // 部分网关使用包装层失败标记；即便附带旧数据，也不能接受为成功快照。
  if (value.successResponse === false || value.success === false || value.Success === false || value.failed === true ||
      (ret.length > 0 && !ret.some(code => code.startsWith('SUCCESS')))) {
    const auth = /NotLogined|Unauthorized|Forbidden|Invalid.*Token|Token.*(?:Invalid|Expired)|Session.*Expired|AccessDenied|NoPermission|401|403/i.test(codes);
    throw failure(auth ? 'QUERY_AUTH_FAILED' : 'QUERY_GATEWAY_FAILED', auth ? 'CONSOLE_AUTH_REJECTED' : 'CONSOLE_GATEWAY_REJECTED', stage);
  }
}

async function gatewayRows(token, api, data, field, deadline, stage) {
  const params = JSON.stringify({ Api: api, V: '1.0', Data: { ...data, cornerstoneParam: {
    protocol: 'V2', console: 'ONE_CONSOLE', productCode: 'p_efm', switchUserType: 3, consoleSite: 'BAILIAN_ALIYUN'
  } } });
  const result = await requestJson({ host: GATEWAY_HOST,
    requestPath: '/cli/api.json?action=BroadScopeAspnGateway&product=sfm_bailian&api=' + encodeURIComponent(api),
    body: new URLSearchParams({ params, region: 'cn-beijing' }).toString(),
    headers: { Accept: '*/*', 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Bearer ' + token },
    deadline, stage });
  const outer = result && result.data;
  const wrapped = outer && outer.DataV2;
  const envelope = wrapped ? wrapped.data : outer;
  const layers = wrapped ? [result, outer, wrapped, envelope] : [result, outer];
  // 先收集固定层级的错误码，避免外层失败提前遮蔽内层的明确鉴权错误。
  const codes = layers.flatMap(value => value && typeof value === 'object'
    ? [value.errorCode, value.code, value.Code, ...(Array.isArray(value.ret) ? value.ret : [])] : [])
    .filter(value => typeof value === 'string' || typeof value === 'number').join(' ');
  for (const layer of layers) checkEnvelope(layer, stage, codes);
  const rows = envelope.data && envelope.data[field];
  if (!Array.isArray(rows)) throw failure('QUERY_INVALID_RESULT', 'QUOTA_FIELD_MISSING', stage);
  return rows;
}

function sha256(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }

async function renewAuthorization(env, deadline) {
  const headers = { host: TOKEN_HOST, 'content-type': 'application/json',
    'x-acs-action': 'GenerateCLIAccessToken', 'x-acs-version': '2026-02-10',
    'x-acs-date': new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    'x-acs-signature-nonce': randomUUID(), 'x-acs-content-sha256': sha256(''),
    ...(env.BAILIAN_QUOTA_SECURITY_TOKEN ? { 'x-acs-security-token': env.BAILIAN_QUOTA_SECURITY_TOKEN } : {}) };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map(name => name + ':' + headers[name] + '\n').join('');
  const signedHeaders = names.join(';');
  const canonical = ['POST', TOKEN_PATH, '', canonicalHeaders, signedHeaders, sha256('')].join('\n');
  const signature = createHmac('sha256', env.BAILIAN_QUOTA_ACCESS_KEY_SECRET)
    .update('ACS3-HMAC-SHA256\n' + sha256(canonical), 'utf8').digest('hex');
  headers.authorization = 'ACS3-HMAC-SHA256 Credential=' + env.BAILIAN_QUOTA_ACCESS_KEY_ID +
    ',SignedHeaders=' + signedHeaders + ',Signature=' + signature;
  const result = await requestJson({ host: TOKEN_HOST, requestPath: TOKEN_PATH, body: '', headers,
    deadline, stage: 'renewal' });
  if (!result || result.Success === false || typeof result.cliAccessToken !== 'string' || !result.cliAccessToken.trim()) {
    throw failure('QUERY_AUTH_FAILED', 'TOKEN_RENEWAL_REJECTED', 'renewal');
  }
  return result.cliAccessToken.trim();
}

async function readQuotaRows(token, models, deadline) {
  // 同时查询余额和免费保护，两者都成功才接受整份快照。
  const results = await Promise.allSettled([
    gatewayRows(token, QUOTA_API, { queryFreeTierQuotaRequest: { models } }, 'freeTierQuotas', deadline, 'quota'),
    gatewayRows(token, PROTECTION_API, { queryFreeTierOnlyStatusRequest: { models } }, 'freeTierOnlyStatuses', deadline, 'protection')
  ]);
  const rejected = results.find(result => result.status === 'rejected');
  if (rejected) throw rejected.reason;
  const statuses = new Map();
  for (const row of results[1].value) {
    if (!row || !models.includes(row.model) || statuses.has(row.model) || typeof row.freeTierOnly !== 'boolean') {
      throw failure('QUERY_INVALID_RESULT', 'PROTECTION_STATUS_INVALID', 'protection');
    }
    statuses.set(row.model, row.freeTierOnly);
  }
  return results[0].value.map(row => {
    const expires = row && row.quotaValidityPeriod;
    if (!row || !Number.isSafeInteger(expires) || expires <= 0 || !statuses.has(row.model)) {
      throw failure('QUERY_INVALID_RESULT', 'QUOTA_STATUS_INVALID', 'quota');
    }
    return { model: row.model, remaining: row.quotaTotal, total: row.quotaInitTotal,
      expires: new Date(expires + 28800000).toISOString().slice(0, 10), autoStop: statuses.get(row.model) };
  });
}

async function queryBailianQuota(env, models) {
  const originalToken = String(env.BAILIAN_QUOTA_ACCESS_TOKEN || '').trim();
  if (!originalToken) throw failure('QUERY_NOT_CONFIGURED', 'TOKEN_MISSING', 'configuration');
  if (/^Bearer\s|^["']|["']$|\s/i.test(originalToken)) throw failure('QUERY_TOKEN_FORMAT', 'TOKEN_FORMAT', 'configuration');
  if (!!env.BAILIAN_QUOTA_ACCESS_KEY_ID !== !!env.BAILIAN_QUOTA_ACCESS_KEY_SECRET) {
    throw failure('QUERY_CREDENTIAL_INCOMPLETE', 'RENEWAL_CREDENTIAL_INCOMPLETE', 'configuration');
  }
  const fingerprint = sha256(JSON.stringify([originalToken, env.BAILIAN_QUOTA_ACCESS_KEY_ID,
    env.BAILIAN_QUOTA_ACCESS_KEY_SECRET, env.BAILIAN_QUOTA_SECURITY_TOKEN]));
  const token = cachedAuthorization && cachedAuthorization.fingerprint === fingerprint ? cachedAuthorization.token : originalToken;
  const deadline = Date.now() + 25000;
  try { return await readQuotaRows(token, models, deadline); }
  catch (error) {
    if (error.code !== 'QUERY_AUTH_FAILED' || !env.BAILIAN_QUOTA_ACCESS_KEY_ID || Date.now() >= deadline - 500) throw error;
    const refreshedToken = await renewAuthorization(env, deadline);
    const rows = await readQuotaRows(refreshedToken, models, deadline);
    // 续期令牌只保存在当前函数实例内存，不写入数据库、日志或环境变量。
    cachedAuthorization = { fingerprint, token: refreshedToken };
    return rows;
  }
}

module.exports = { queryBailianQuota };
