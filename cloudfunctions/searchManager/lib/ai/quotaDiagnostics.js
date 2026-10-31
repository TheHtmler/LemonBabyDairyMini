'use strict';

// 诊断只包含固定类别及运行时版本，不记录请求头、响应原文或凭证。
function queryDiagnostic(error, stage) {
  const diagnostic = { stage, nodeVersion: process.versions.node, adapter: 'https-v1' };
  let code = 'QUERY_FAILED'; let reason = 'REQUEST_FAILED';
  if (error.code === 'ETIMEDOUT') {
    code = 'QUERY_TIMEOUT'; reason = 'REQUEST_TIMEOUT';
  } else if (['ENOTFOUND', 'EAI_AGAIN'].includes(error.code)) {
    code = 'QUERY_NETWORK_FAILED'; reason = 'DNS_LOOKUP_FAILED';
  } else if (['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(error.code)) {
    code = 'QUERY_NETWORK_FAILED'; reason = 'TLS_CERTIFICATE_FAILED';
  } else if (['ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'].includes(error.code)) {
    code = 'QUERY_NETWORK_FAILED'; reason = 'NETWORK_CONNECTION_FAILED';
  }
  return { code, diagnostic: { ...diagnostic, reason } };
}

function diagnosticMessage(message, diagnostic) {
  if (!diagnostic) return message;
  return message + '（诊断：' + [diagnostic.reason, 'Node ' + diagnostic.nodeVersion].filter(Boolean).join('；') + '）';
}

module.exports = { queryDiagnostic, diagnosticMessage };
