#!/usr/bin/env node
/**
 * 只读排查脚本：全量检查 _openid 在 baby_creators / baby_participants 中的多角色关系。
 *
 * 用法:
 *   node scripts/check-caregiver-roles.js
 *   node scripts/check-caregiver-roles.js --json
 *   node scripts/check-caregiver-roles.js --openid <openid>
 *   node scripts/check-caregiver-roles.js --env-file .env.local
 *
 * 环境变量:
 *   TCB_SECRET_ID / TCB_SECRET_KEY  云开发服务端密钥
 *   TCB_ENV                       可选，默认读取 project.config.json cloudSettings.defaultEnv
 *
 * 注意：本脚本不删除任何数据，只输出关系和排查建议。
 */
const fs = require('node:fs');
const path = require('node:path');

function printHelp() {
  console.log(`
全量检查 _openid 是否同时是创建者和参与者（只读）

用法:
  node scripts/check-caregiver-roles.js [选项]

环境变量:
  TCB_SECRET_ID / TCB_SECRET_KEY  云开发服务端密钥

可选环境变量:
  TCB_ENV  云环境 ID（默认读 project.config.json cloudSettings.defaultEnv）

选项:
  --openid <openid>   可选，只排查某个微信 openid
  --json              输出 JSON，便于粘贴/归档
  --page-size <n>     分页读取条数（默认 100）
  --env-file <path>   加载 KEY=VALUE 环境文件
  --help
`);
}

function loadEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    openid: '',
    json: false,
    pageSize: 100,
    envFile: '',
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    const readValue = (inlinePrefix) => {
      if (inlinePrefix) {
        return arg.slice(inlinePrefix.length);
      }
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`选项 ${arg} 缺少值`);
      }
      i += 1;
      return next;
    };

    if (arg === '--openid' || arg.startsWith('--openid=')) {
      options.openid = readValue(arg.startsWith('--openid=') ? '--openid=' : null).trim();
      continue;
    }
    if (arg === '--page-size' || arg.startsWith('--page-size=')) {
      options.pageSize = Number(readValue(arg.startsWith('--page-size=') ? '--page-size=' : null));
      continue;
    }
    if (arg === '--env-file' || arg.startsWith('--env-file=')) {
      options.envFile = readValue(arg.startsWith('--env-file=') ? '--env-file=' : null);
      continue;
    }

    throw new Error(`未知参数: ${arg}`);
  }

  if (options.envFile) {
    loadEnvFile(path.isAbsolute(options.envFile)
      ? options.envFile
      : path.join(process.cwd(), options.envFile));
  }
  if (!(options.pageSize > 0)) {
    throw new Error('--page-size 必须是正数');
  }

  return options;
}

function loadProjectEnvId() {
  try {
    const projectConfig = require(path.join(__dirname, '..', 'project.config.json'));
    return projectConfig.cloudSettings?.defaultEnv || '';
  } catch {
    return '';
  }
}

function createCloudApp() {
  let cloudbase;
  try {
    cloudbase = require('@cloudbase/node-sdk');
  } catch (error) {
    console.error('缺少依赖 @cloudbase/node-sdk，请先执行: npm install');
    throw error;
  }

  const secretId = process.env.TCB_SECRET_ID || process.env.CLOUDBASE_SECRET_ID;
  const secretKey = process.env.TCB_SECRET_KEY || process.env.CLOUDBASE_SECRET_KEY;
  const env = process.env.TCB_ENV || loadProjectEnvId();

  if (!secretId || !secretKey) {
    throw new Error('未配置密钥。请设置 TCB_SECRET_ID / TCB_SECRET_KEY');
  }
  if (!env) {
    throw new Error('未配置云环境 ID。请设置 TCB_ENV 或确认 project.config.json 含 cloudSettings.defaultEnv');
  }

  return {
    env,
    app: cloudbase.init({ env, secretId, secretKey })
  };
}

async function getAllByQuery(db, collectionName, where = {}, pageSize = 100) {
  const rows = [];
  let skip = 0;
  while (true) {
    const collection = db.collection(collectionName);
    const query = where && Object.keys(where).length > 0 ? collection.where(where) : collection;
    const res = await query.skip(skip).limit(pageSize).get();
    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    skip += pageSize;
  }
  return rows;
}

async function loadBabyInfoMap(db, babyUids = []) {
  const uniqueBabyUids = Array.from(new Set(babyUids.filter(Boolean)));
  const map = {};

  await Promise.all(uniqueBabyUids.map(async (babyUid) => {
    const res = await db.collection('baby_info').where({ babyUid }).limit(1).get();
    const babyInfo = res.data && res.data[0];
    map[babyUid] = babyInfo ? {
      babyUid,
      name: babyInfo.name || babyInfo.babyName || '',
      birthday: babyInfo.birthday || '',
      inviteCode: babyInfo.inviteCode || '',
      inviteCodeExpiry: babyInfo.inviteCodeExpiry || ''
    } : { babyUid, missing: true };
  }));

  return map;
}

function normalizeRelation(row = {}, role, babyInfoMap = {}) {
  const babyInfo = babyInfoMap[row.babyUid] || { babyUid: row.babyUid || '', missing: true };
  return {
    id: row._id || '',
    role,
    babyUid: row.babyUid || '',
    babyName: babyInfo.name || '未找到宝宝信息',
    babyInfoMissing: !!babyInfo.missing,
    displayName: row.displayName || '',
    createdAt: row.createdAt || row.joinedAt || '',
    updatedAt: row.updatedAt || ''
  };
}

function groupRowsByOpenid(rows = []) {
  return rows.reduce((map, row) => {
    const openid = row._openid || '';
    if (!openid) return map;
    if (!map[openid]) map[openid] = [];
    map[openid].push(row);
    return map;
  }, {});
}

function analyzeRelations({ openid, creators = [], participants = [], babyInfoMap = {} }) {
  const creatorRelations = creators.map((row) => normalizeRelation(row, 'creator', babyInfoMap));
  const participantRelations = participants.map((row) => normalizeRelation(row, 'participant', babyInfoMap));
  const creatorBabyUids = new Set(creatorRelations.map((item) => item.babyUid).filter(Boolean));
  const participantBabyUids = new Set(participantRelations.map((item) => item.babyUid).filter(Boolean));
  const allBabyUids = Array.from(new Set([...creatorBabyUids, ...participantBabyUids]));
  const duplicateBabyUids = allBabyUids.filter((babyUid) => (
    creatorBabyUids.has(babyUid) && participantBabyUids.has(babyUid)
  ));
  const crossBabyRelations = allBabyUids.length > 1;

  const recommendations = [];
  if (duplicateBabyUids.length > 0) {
    recommendations.push('同一个 openid 在同一个 babyUid 下同时是创建者和参与者：通常保留创建者关系，确认后可移除对应参与者关系。');
  }
  if (crossBabyRelations) {
    recommendations.push('该 openid 关联了多个 babyUid：可能是真实多家庭协作，也可能是误加入。不要自动删除，建议结合用户反馈和最近记录人工确认。');
  }
  if (duplicateBabyUids.length === 0 && !crossBabyRelations) {
    recommendations.push('未发现创建者/参与者冲突。');
  }

  return {
    openid,
    summary: {
      creatorCount: creatorRelations.length,
      participantCount: participantRelations.length,
      babyUidCount: allBabyUids.length,
      duplicateBabyUids,
      crossBabyRelations
    },
    creatorRelations,
    participantRelations,
    recommendations
  };
}

function analyzeAllRelations({ creators = [], participants = [], babyInfoMap = {} }) {
  const creatorsByOpenid = groupRowsByOpenid(creators);
  const participantsByOpenid = groupRowsByOpenid(participants);
  const allOpenids = Array.from(new Set([
    ...Object.keys(creatorsByOpenid),
    ...Object.keys(participantsByOpenid)
  ])).sort();

  const multiRoleOpenids = allOpenids
    .map((openid) => analyzeRelations({
      openid,
      creators: creatorsByOpenid[openid] || [],
      participants: participantsByOpenid[openid] || [],
      babyInfoMap
    }))
    .filter((item) => item.summary.creatorCount > 0 && item.summary.participantCount > 0);

  return {
    summary: {
      scannedCreatorCount: creators.length,
      scannedParticipantCount: participants.length,
      scannedOpenidCount: allOpenids.length,
      multiRoleOpenidCount: multiRoleOpenids.length,
      duplicateSameBabyOpenidCount: multiRoleOpenids.filter((item) => item.summary.duplicateBabyUids.length > 0).length,
      crossBabyOpenidCount: multiRoleOpenids.filter((item) => item.summary.crossBabyRelations).length
    },
    multiRoleOpenids
  };
}

function formatDateLike(value) {
  if (!value) return '--';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value.$date) return new Date(value.$date).toISOString();
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate().toISOString();
  return String(value);
}

function formatRelation(item) {
  return [
    `  - ${item.role === 'creator' ? '创建者' : '参与者'}: ${item.babyName} (${item.babyUid || '无 babyUid'})`,
    `    关系ID: ${item.id || '--'}`,
    `    展示名称: ${item.displayName || '--'}`,
    `    创建/加入时间: ${formatDateLike(item.createdAt)}`,
    `    更新时间: ${formatDateLike(item.updatedAt)}`,
    item.babyInfoMissing ? '    警告: baby_info 未找到对应宝宝信息' : ''
  ].filter(Boolean).join('\n');
}

function printTextReport(result) {
  console.log('\n=== 账号关系排查结果 ===');
  console.log(`OpenID: ${result.openid}`);
  console.log(`创建者关系: ${result.summary.creatorCount}`);
  console.log(`参与者关系: ${result.summary.participantCount}`);
  console.log(`关联 babyUid 数: ${result.summary.babyUidCount}`);
  console.log(`同 babyUid 重复身份: ${result.summary.duplicateBabyUids.length ? result.summary.duplicateBabyUids.join(', ') : '无'}`);
  console.log(`跨 babyUid 多关系: ${result.summary.crossBabyRelations ? '是' : '否'}`);

  console.log('\n--- 创建者关系 ---');
  if (result.creatorRelations.length) {
    result.creatorRelations.forEach((item) => console.log(formatRelation(item)));
  } else {
    console.log('  无');
  }

  console.log('\n--- 参与者关系 ---');
  if (result.participantRelations.length) {
    result.participantRelations.forEach((item) => console.log(formatRelation(item)));
  } else {
    console.log('  无');
  }

  console.log('\n--- 建议 ---');
  result.recommendations.forEach((line) => console.log(`  - ${line}`));
  console.log('\n注意：本脚本只读，不会删除任何关系或历史记录。');
}

function printGlobalReport(result) {
  console.log('\n=== 全量账号多角色排查结果 ===');
  console.log(`扫描创建者关系: ${result.summary.scannedCreatorCount}`);
  console.log(`扫描参与者关系: ${result.summary.scannedParticipantCount}`);
  console.log(`扫描 openid 数: ${result.summary.scannedOpenidCount}`);
  console.log(`同时存在创建者和参与者角色的 openid 数: ${result.summary.multiRoleOpenidCount}`);
  console.log(`其中同 babyUid 重复身份: ${result.summary.duplicateSameBabyOpenidCount}`);
  console.log(`其中跨 babyUid 多关系: ${result.summary.crossBabyOpenidCount}`);

  if (result.multiRoleOpenids.length === 0) {
    console.log('\n未发现同时存在创建者和参与者角色的 openid。');
    console.log('\n注意：本脚本只读，不会删除任何关系或历史记录。');
    return;
  }

  result.multiRoleOpenids.forEach((item, index) => {
    console.log(`\n--- #${index + 1} OpenID: ${item.openid} ---`);
    console.log(`创建者关系: ${item.summary.creatorCount}`);
    console.log(`参与者关系: ${item.summary.participantCount}`);
    console.log(`关联 babyUid 数: ${item.summary.babyUidCount}`);
    console.log(`同 babyUid 重复身份: ${item.summary.duplicateBabyUids.length ? item.summary.duplicateBabyUids.join(', ') : '无'}`);
    console.log(`跨 babyUid 多关系: ${item.summary.crossBabyRelations ? '是' : '否'}`);

    console.log('\n创建者关系:');
    item.creatorRelations.forEach((relation) => console.log(formatRelation(relation)));

    console.log('\n参与者关系:');
    item.participantRelations.forEach((relation) => console.log(formatRelation(relation)));

    console.log('\n建议:');
    item.recommendations.forEach((line) => console.log(`  - ${line}`));
  });

  console.log('\n注意：本脚本只读，不会删除任何关系或历史记录。');
}

async function run(options) {
  const { env, app } = createCloudApp();
  const db = app.database();
  const where = options.openid ? { _openid: options.openid } : {};
  const [creators, participants] = await Promise.all([
    getAllByQuery(db, 'baby_creators', where, options.pageSize),
    getAllByQuery(db, 'baby_participants', where, options.pageSize)
  ]);
  const babyInfoMap = await loadBabyInfoMap(db, [
    ...creators.map((item) => item.babyUid),
    ...participants.map((item) => item.babyUid)
  ]);

  if (options.openid) {
    return {
      env,
      mode: 'single-openid',
      ...analyzeRelations({
        openid: options.openid,
        creators,
        participants,
        babyInfoMap
      })
    };
  }

  return {
    env,
    mode: 'global',
    ...analyzeAllRelations({
      openid: options.openid,
      creators,
      participants,
      babyInfoMap
    })
  };
}

if (require.main === module) {
  (async () => {
    try {
      const options = parseArgs();
      if (options.help) {
        printHelp();
        return;
      }
      const result = await run(options);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`云环境: ${result.env}`);
        if (result.mode === 'single-openid') {
          printTextReport(result);
        } else {
          printGlobalReport(result);
        }
      }
    } catch (error) {
      console.error(`排查失败: ${error.message}`);
      console.error('可执行 node scripts/check-caregiver-roles.js --help 查看用法');
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  parseArgs,
  analyzeRelations,
  analyzeAllRelations,
  normalizeRelation,
  formatDateLike
};
