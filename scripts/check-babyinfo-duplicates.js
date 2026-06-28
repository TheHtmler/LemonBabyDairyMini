#!/usr/bin/env node
/**
 * 只读排查脚本：检查同一个 _openid 关联的多个 baby_info / babyUid。
 *
 * 用法:
 *   node scripts/check-babyinfo-duplicates.js --openid <openid>
 *   node scripts/check-babyinfo-duplicates.js --openid <openid> --json
 *   node scripts/check-babyinfo-duplicates.js --openid <openid> --env-file .env.local
 *
 * 环境变量:
 *   TCB_SECRET_ID / TCB_SECRET_KEY  云开发服务端密钥
 *   TCB_ENV                       可选，默认读取 project.config.json cloudSettings.defaultEnv
 *
 * 注意：本脚本只读，不删除、不合并、不更新任何数据。
 */
const fs = require('node:fs');
const path = require('node:path');

const BUSINESS_COLLECTIONS = [
  'feeding_records_v2',
  'food_intake_records',
  'feeding_records',
  'medication_records',
  'treatment_records',
  'bowel_records',
  'growth_records_v2',
  'growth_curve_points',
  'baby_reports',
  'milk_nutrition_profiles',
  'foods'
];

const CACHE_COLLECTIONS = [
  'daily_summary_v2'
];

const COUNT_COLLECTIONS = [
  ...BUSINESS_COLLECTIONS,
  ...CACHE_COLLECTIONS
];

function printHelp() {
  console.log(`
排查同一个 _openid 是否关联多个 baby_info / babyUid（只读）

用法:
  node scripts/check-babyinfo-duplicates.js --openid <openid> [选项]

环境变量:
  TCB_SECRET_ID / TCB_SECRET_KEY  云开发服务端密钥

可选环境变量:
  TCB_ENV  云环境 ID（默认读 project.config.json cloudSettings.defaultEnv）

选项:
  --openid <openid>   必填，要排查的微信 openid
  --json              输出 JSON，便于粘贴/归档
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
      if (inlinePrefix) return arg.slice(inlinePrefix.length);
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

async function getAllByQuery(db, collectionName, where = {}) {
  const res = await db.collection(collectionName).where(where).get();
  return res.data || [];
}

async function countByBabyUid(db, collectionName, babyUid) {
  try {
    const res = await db.collection(collectionName).where({ babyUid }).count();
    return res.total || 0;
  } catch (error) {
    return 0;
  }
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function sumCounts(counts = {}, collectionNames = []) {
  return collectionNames.reduce((sum, name) => sum + Number(counts[name] || 0), 0);
}

function pickBabyName(babyInfos = []) {
  const info = babyInfos.find((item) => item.name || item.babyName) || babyInfos[0] || {};
  return info.name || info.babyName || '';
}

function analyzeBabyInfoDuplicates({
  openid,
  babyInfos = [],
  creators = [],
  participants = [],
  collectionCounts = {}
}) {
  const babyUids = unique([
    ...babyInfos.map((item) => item.babyUid),
    ...creators.map((item) => item.babyUid),
    ...participants.map((item) => item.babyUid)
  ]);

  const babies = babyUids.map((babyUid) => {
    const relatedBabyInfos = babyInfos.filter((item) => item.babyUid === babyUid);
    const relatedCreators = creators.filter((item) => item.babyUid === babyUid);
    const relatedParticipants = participants.filter((item) => item.babyUid === babyUid);
    const counts = collectionCounts[babyUid] || {};
    const businessRecordCount = sumCounts(counts, BUSINESS_COLLECTIONS);
    const dailySummaryCount = Number(counts.daily_summary_v2 || 0);
    const hasBusinessRecords = businessRecordCount > 0;
    const onlyHasDailySummary = !hasBusinessRecords && dailySummaryCount > 0;

    return {
      babyUid,
      babyName: pickBabyName(relatedBabyInfos),
      babyInfoIds: relatedBabyInfos.map((item) => item._id || ''),
      creatorRelationIds: relatedCreators.map((item) => item._id || ''),
      participantRelationIds: relatedParticipants.map((item) => item._id || ''),
      counts,
      businessRecordCount,
      dailySummaryCount,
      hasBusinessRecords,
      onlyHasDailySummary,
      suspiciousEmptyProfile: onlyHasDailySummary
    };
  }).sort((left, right) => {
    if (left.hasBusinessRecords !== right.hasBusinessRecords) {
      return left.hasBusinessRecords ? -1 : 1;
    }
    return right.businessRecordCount - left.businessRecordCount
      || right.dailySummaryCount - left.dailySummaryCount
      || left.babyUid.localeCompare(right.babyUid);
  });

  const suspiciousEmptyBabyUids = babies
    .filter((item) => item.suspiciousEmptyProfile)
    .map((item) => item.babyUid);
  const babiesWithBusiness = babies.filter((item) => item.hasBusinessRecords);

  const recommendations = [];
  if (babyUids.length <= 1) {
    recommendations.push('未发现该 openid 关联多个 babyUid。');
  } else if (suspiciousEmptyBabyUids.length > 0) {
    recommendations.push('优先保留有真实业务明细的 babyUid；仅有 daily_summary_v2 的 babyUid 多半是页面懒加载生成的空汇总，建议人工确认后清理其 daily_summary_v2 / baby_info / creator 关系。');
  } else if (babiesWithBusiness.length > 1) {
    recommendations.push('多个 babyUid 都有真实业务明细：可能是真实多宝宝/多家庭关系，不要自动删除，建议结合用户反馈逐条确认。');
  } else {
    recommendations.push('未发现仅有 daily_summary_v2 的明显空档案；如仍需清理，请结合创建时间和用户反馈人工判断。');
  }

  return {
    openid,
    summary: {
      babyInfoCount: babyInfos.length,
      creatorRelationCount: creators.length,
      participantRelationCount: participants.length,
      babyUidCount: babyUids.length,
      suspiciousEmptyProfileCount: suspiciousEmptyBabyUids.length,
      businessBabyUidCount: babiesWithBusiness.length
    },
    babies,
    suspiciousEmptyBabyUids,
    recommendations
  };
}

async function loadCollectionCounts(db, babyUids = []) {
  const collectionCounts = {};
  await Promise.all(babyUids.map(async (babyUid) => {
    const entries = await Promise.all(COUNT_COLLECTIONS.map(async (collectionName) => [
      collectionName,
      await countByBabyUid(db, collectionName, babyUid)
    ]));
    collectionCounts[babyUid] = Object.fromEntries(entries);
  }));
  return collectionCounts;
}

async function run(options) {
  if (!options.openid) {
    throw new Error('必须提供 --openid');
  }

  const { env, app } = createCloudApp();
  const db = app.database();
  const where = { _openid: options.openid };
  const [babyInfos, creators, participants] = await Promise.all([
    getAllByQuery(db, 'baby_info', where),
    getAllByQuery(db, 'baby_creators', where),
    getAllByQuery(db, 'baby_participants', where)
  ]);
  const babyUids = unique([
    ...babyInfos.map((item) => item.babyUid),
    ...creators.map((item) => item.babyUid),
    ...participants.map((item) => item.babyUid)
  ]);
  const collectionCounts = await loadCollectionCounts(db, babyUids);

  return {
    env,
    mode: 'single-openid',
    ...analyzeBabyInfoDuplicates({
      openid: options.openid,
      babyInfos,
      creators,
      participants,
      collectionCounts
    })
  };
}

function formatCounts(counts = {}) {
  return COUNT_COLLECTIONS
    .map((name) => `${name}: ${counts[name] || 0}`)
    .join('\n    ');
}

function printTextReport(result) {
  console.log('\n=== baby_info 重复排查结果 ===');
  console.log(`环境: ${result.env || '--'}`);
  console.log(`OpenID: ${result.openid}`);
  console.log(`baby_info 数: ${result.summary.babyInfoCount}`);
  console.log(`创建者关系数: ${result.summary.creatorRelationCount}`);
  console.log(`参与者关系数: ${result.summary.participantRelationCount}`);
  console.log(`关联 babyUid 数: ${result.summary.babyUidCount}`);
  console.log(`疑似空档案数: ${result.summary.suspiciousEmptyProfileCount}`);

  console.log('\n--- babyUid 明细 ---');
  if (!result.babies.length) {
    console.log('  未找到关联 babyUid');
  }
  result.babies.forEach((baby, index) => {
    console.log(`\n#${index + 1} ${baby.babyName || '未命名宝宝'} (${baby.babyUid})`);
    console.log(`  baby_info: ${baby.babyInfoIds.filter(Boolean).join(', ') || '无'}`);
    console.log(`  creator关系: ${baby.creatorRelationIds.filter(Boolean).join(', ') || '无'}`);
    console.log(`  participant关系: ${baby.participantRelationIds.filter(Boolean).join(', ') || '无'}`);
    console.log(`  真实业务明细数: ${baby.businessRecordCount}`);
    console.log(`  daily_summary_v2: ${baby.dailySummaryCount}`);
    console.log(`  疑似空档案: ${baby.suspiciousEmptyProfile ? '是' : '否'}`);
    console.log(`  集合计数:\n    ${formatCounts(baby.counts)}`);
  });

  console.log('\n--- 建议 ---');
  result.recommendations.forEach((line) => console.log(`  - ${line}`));
  console.log('\n注意：本脚本只读，不会删除或修改任何数据。');
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
        printTextReport(result);
      }
    } catch (error) {
      console.error(error.message || error);
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  BUSINESS_COLLECTIONS,
  CACHE_COLLECTIONS,
  COUNT_COLLECTIONS,
  parseArgs,
  analyzeBabyInfoDuplicates,
  run
};
