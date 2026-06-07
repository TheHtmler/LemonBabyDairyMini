const fs = require('node:fs');
const path = require('node:path');

const VALID_STEPS = new Set(['all', 'profiles', 'feeding', 'growth', 'repair-dates']);

function printHelp() {
  console.log(`
奶粉 v2 迁移编排脚本（自动串联云函数 nextOffset）

用法:
  node scripts/run-milk-v2-migration.js [选项]

环境变量（必填，勿提交仓库）:
  TCB_SECRET_ID / TCB_SECRET_KEY  云开发服务端密钥

可选环境变量:
  TCB_ENV  云环境 ID（默认读 project.config.json cloudSettings.defaultEnv）

选项:
  --execute              正式写入（默认仅 dry-run 预览）
  --step <name>          all | profiles | feeding | growth | repair-dates（默认 all）
  --baby-uid <id>        只处理指定宝宝
  --migration-version <v>  喂奶迁移版本号（默认 milk-v2，固定不变以保证增量幂等）
  --page-size <n>        每批文档数（默认 profiles=50 feeding=10 growth=50）
  --start-date <YYYY-MM-DD>
  --end-date <YYYY-MM-DD>
  --max-batches <n>      每次云函数调用处理的批次数（默认 1，防超时）
  --delay-ms <n>         批次间休眠毫秒（默认 300）
  --include-baby-info-initial  成长回填包含 baby_info 初值
  --legacy-growth-collections <a,b>  额外旧成长集合
  --powder-rules-file <path>  JSON 文件，传给 powderVersionRules
  --env-file <path>      加载 KEY=VALUE 环境文件
  --continue-on-errors   遇 errors 仍继续后续批次/步骤
  --help

示例:
  node scripts/run-milk-v2-migration.js --baby-uid=xxx
  node scripts/run-milk-v2-migration.js --execute --step=feeding
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

function readJsonFile(filePath) {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}

// 固定不含日期：默认值在不同天调用时保持稳定，避免增量补迁误用新版本号导致喂奶记录翻倍。
const DEFAULT_MIGRATION_VERSION = 'milk-v2';

function defaultMigrationVersion() {
  return DEFAULT_MIGRATION_VERSION;
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    execute: false,
    step: 'all',
    babyUid: '',
    migrationVersion: defaultMigrationVersion(),
    pageSize: null,
    startDate: '',
    endDate: '',
    maxBatches: 1,
    delayMs: 300,
    includeBabyInfoInitial: false,
    legacyGrowthCollections: [],
    powderRulesFile: '',
    envFile: '',
    continueOnErrors: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--execute') {
      options.execute = true;
      continue;
    }
    if (arg === '--continue-on-errors') {
      options.continueOnErrors = true;
      continue;
    }
    if (arg === '--include-baby-info-initial') {
      options.includeBabyInfoInitial = true;
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

    if (arg === '--step' || arg.startsWith('--step=')) {
      options.step = readValue(arg.startsWith('--step=') ? '--step=' : null);
      continue;
    }
    if (arg === '--baby-uid' || arg.startsWith('--baby-uid=')) {
      options.babyUid = readValue(arg.startsWith('--baby-uid=') ? '--baby-uid=' : null);
      continue;
    }
    if (arg === '--migration-version' || arg.startsWith('--migration-version=')) {
      options.migrationVersion = readValue(
        arg.startsWith('--migration-version=') ? '--migration-version=' : null
      );
      continue;
    }
    if (arg === '--page-size' || arg.startsWith('--page-size=')) {
      options.pageSize = Number(readValue(arg.startsWith('--page-size=') ? '--page-size=' : null));
      continue;
    }
    if (arg === '--start-date' || arg.startsWith('--start-date=')) {
      options.startDate = readValue(arg.startsWith('--start-date=') ? '--start-date=' : null);
      continue;
    }
    if (arg === '--end-date' || arg.startsWith('--end-date=')) {
      options.endDate = readValue(arg.startsWith('--end-date=') ? '--end-date=' : null);
      continue;
    }
    if (arg === '--max-batches' || arg.startsWith('--max-batches=')) {
      options.maxBatches = Number(readValue(arg.startsWith('--max-batches=') ? '--max-batches=' : null));
      continue;
    }
    if (arg === '--delay-ms' || arg.startsWith('--delay-ms=')) {
      options.delayMs = Number(readValue(arg.startsWith('--delay-ms=') ? '--delay-ms=' : null));
      continue;
    }
    if (arg === '--powder-rules-file' || arg.startsWith('--powder-rules-file=')) {
      options.powderRulesFile = readValue(
        arg.startsWith('--powder-rules-file=') ? '--powder-rules-file=' : null
      );
      continue;
    }
    if (arg === '--env-file' || arg.startsWith('--env-file=')) {
      options.envFile = readValue(arg.startsWith('--env-file=') ? '--env-file=' : null);
      continue;
    }
    if (arg === '--legacy-growth-collections' || arg.startsWith('--legacy-growth-collections=')) {
      const raw = readValue(
        arg.startsWith('--legacy-growth-collections=') ? '--legacy-growth-collections=' : null
      );
      options.legacyGrowthCollections = raw.split(',').map((item) => item.trim()).filter(Boolean);
      continue;
    }

    throw new Error(`未知参数: ${arg}`);
  }

  if (options.envFile) {
    loadEnvFile(path.isAbsolute(options.envFile)
      ? options.envFile
      : path.join(process.cwd(), options.envFile));
  }

  if (!VALID_STEPS.has(options.step)) {
    throw new Error(`无效 --step: ${options.step}，可选: ${[...VALID_STEPS].join(', ')}`);
  }

  if (options.pageSize !== null && !(options.pageSize > 0)) {
    throw new Error('--page-size 必须是正数');
  }
  if (!(options.maxBatches > 0)) {
    throw new Error('--max-batches 必须是正数');
  }
  if (!(options.delayMs >= 0)) {
    throw new Error('--delay-ms 不能为负数');
  }

  return options;
}

function resolvePageSize(step, options) {
  if (options.pageSize > 0) return options.pageSize;
  if (step === 'feeding' || step === 'repair-dates') return 10;
  if (step === 'growth') return 50;
  return 50;
}

function stepsToRun(step) {
  if (step === 'all') return ['profiles', 'feeding', 'growth'];
  if (step === 'repair-dates') return ['repair-dates'];
  return [step];
}

module.exports = {
  VALID_STEPS,
  printHelp,
  parseArgs,
  readJsonFile,
  resolvePageSize,
  stepsToRun,
  defaultMigrationVersion
};
