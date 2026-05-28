const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCreateAuditFields,
  buildUpdateAuditFields,
  buildHardDeleteAuditLog,
  stripProtectedAuditFields
} = require('../miniprogram/utils/auditFields');

test('buildCreateAuditFields writes common create audit fields', () => {
  const fields = buildCreateAuditFields({
    timestamp: '__server_date__',
    operatorOpenid: ' openid-1 ',
    recordType: 'food_intake'
  });

  assert.deepEqual(fields, {
    schemaVersion: 1,
    recordType: 'food_intake',
    status: 'active',
    createdAt: '__server_date__',
    updatedAt: '__server_date__',
    deletedAt: null,
    createdBy: 'openid-1',
    updatedBy: 'openid-1',
    deletedBy: ''
  });
});

test('buildUpdateAuditFields only includes updatedBy when operator is present', () => {
  assert.deepEqual(buildUpdateAuditFields({
    timestamp: '__server_date__',
    operatorOpenid: 'openid-2'
  }), {
    updatedAt: '__server_date__',
    updatedBy: 'openid-2'
  });

  assert.deepEqual(buildUpdateAuditFields({
    timestamp: '__server_date__'
  }), {
    updatedAt: '__server_date__'
  });
});

test('stripProtectedAuditFields removes immutable and operator-only fields', () => {
  const cleaned = stripProtectedAuditFields({
    _id: 'record-1',
    id: 'record-legacy',
    createdAt: 'old',
    createdBy: 'owner',
    deletedAt: 'deleted',
    deletedBy: 'deleter',
    operatorOpenid: 'operator',
    openid: 'openid',
    name: '保留'
  });

  assert.deepEqual(cleaned, {
    name: '保留'
  });
});

test('buildHardDeleteAuditLog records deletion metadata', () => {
  const log = buildHardDeleteAuditLog({
    timestamp: '__server_date__',
    collectionName: 'meal_combinations',
    recordId: 'combo-1',
    babyUid: 'baby-1',
    operatorOpenid: 'openid-3'
  });

  assert.deepEqual(log, {
    schemaVersion: 1,
    recordType: 'audit_log',
    action: 'delete',
    collection: 'meal_combinations',
    recordId: 'combo-1',
    babyUid: 'baby-1',
    operatorOpenid: 'openid-3',
    status: 'active',
    createdAt: '__server_date__'
  });
});
