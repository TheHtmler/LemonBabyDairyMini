function normalizeOperatorOpenid(value = '') {
  return String(value || '').trim();
}

function resolveOperatorOpenid(source = {}) {
  if (typeof source === 'string') {
    return normalizeOperatorOpenid(source);
  }
  return normalizeOperatorOpenid(
    source.operatorOpenid
    || source.openid
    || source.createdBy
    || source.updatedBy
    || source.deletedBy
  );
}

function buildCreateAuditFields({
  timestamp,
  operatorOpenid = '',
  recordType = '',
  schemaVersion = 1,
  status = 'active'
} = {}) {
  const operator = normalizeOperatorOpenid(operatorOpenid);
  const fields = {
    schemaVersion,
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    createdBy: operator,
    updatedBy: operator,
    deletedBy: ''
  };

  if (recordType) {
    fields.recordType = recordType;
  }

  return fields;
}

function buildUpdateAuditFields({
  timestamp,
  operatorOpenid = ''
} = {}) {
  const fields = {
    updatedAt: timestamp
  };
  const operator = normalizeOperatorOpenid(operatorOpenid);
  if (operator) {
    fields.updatedBy = operator;
  }
  return fields;
}

function stripProtectedAuditFields(data = {}) {
  const cleaned = { ...data };
  [
    '_id',
    'id',
    'createdAt',
    'createdBy',
    'deletedAt',
    'deletedBy',
    'operatorOpenid',
    'openid'
  ].forEach(key => {
    delete cleaned[key];
  });
  return cleaned;
}

function buildHardDeleteAuditLog({
  timestamp,
  collectionName = '',
  recordId = '',
  babyUid = '',
  operatorOpenid = ''
} = {}) {
  return {
    schemaVersion: 1,
    recordType: 'audit_log',
    action: 'delete',
    collection: collectionName,
    recordId,
    babyUid,
    operatorOpenid: normalizeOperatorOpenid(operatorOpenid),
    status: 'active',
    createdAt: timestamp
  };
}

module.exports = {
  normalizeOperatorOpenid,
  resolveOperatorOpenid,
  buildCreateAuditFields,
  buildUpdateAuditFields,
  stripProtectedAuditFields,
  buildHardDeleteAuditLog
};
