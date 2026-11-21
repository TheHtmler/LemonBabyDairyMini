const MAX_QUERY_LENGTH = 80;
const MAX_RESULTS = 20;
const MAX_ENGLISH_NAMES = 24;

const STATE_WORDS = {
  raw: 'raw', uncooked: 'raw', 生: 'raw', 生的: 'raw', 生品: 'raw', 未烹调的: 'raw', 未烹調的: 'raw',
  cooked: 'cooked', 熟: 'cooked', 熟的: 'cooked', 熟品: 'cooked', 煮熟: 'cooked', 煮熟的: 'cooked',
  蒸熟: 'cooked', 蒸熟的: 'cooked',
  dry: 'dry', dried: 'dry', 干: 'dry', 乾: 'dry', 干品: 'dry', 乾品: 'dry',
  wet: 'wet', 湿: 'wet', 濕: 'wet', 湿态: 'wet', 濕態: 'wet',
  processed: 'processed', 加工品: 'processed'
};
const ATTACHED_STATES = ['未烹调的', '未烹調的', '煮熟的', '蒸熟的', '煮熟', '蒸熟', '生的', '熟的'];
const STATE_LABELS = { dry: '干品', wet: '湿态', processed: '加工品' };
const HAN = /\p{Script=Han}/u;
const COMPOSITE_CATEGORY = /加工[調调]理|[調调]味|糕[餅饼]|[飲饮]料|snacks|restaurant|fast foods|meals, entrees|soups, sauces|baked products|beverages/i;
const PRODUCT_FORM = /\b(?:fried|breaded|flour|powder(?:ed)?|puffed|imitation|seasoned|flavou?red)\b|[調调]味|口味|[風风]味|仿[製制]|裹粉/i;
const DESCRIPTIVE_PREFIX = /^(?:新[鲜鮮]|(?:[深浅淺淡])?[红紅黄黃白黑紫青绿綠棕褐灰金银銀](?:色)?)(?:的)?/u;
const SCORE = { official: 100, local: 96, alias: 90, words: 74, suffix: 68, sharedName: 64, partial: 62, descriptive: 56, translated: 52 };
const SAMPLE_YEAR = /\(\s*(?:19|20)\d{2}\s*年\s*(?:[採采]樣|[採采]样|取[樣样])\s*\)$/u;
const CUT_MARKERS = [
  /去[皮殼壳]|不[帶带]皮|without (?:skin|peel)|\b(?:peeled|skinless)\b/i,
  /[帶带]皮|未去皮|with (?:skin|peel)|includes skin/i,
  /去骨|無骨|无骨|\bboneless\b/i,
  /[帶带]骨|\bbone[ -]in\b/i,
  /去脂|純瘦|纯瘦|(?:separable )?lean only/i,
  /[帶带]脂|肥瘦|lean and fat/i,
  /罐[頭头]|\bcanned\b/i,
  /[醃腌]漬|[醃腌]制|\b(?:pickled|cured)\b/i,
  /油炸|裹粉|\b(?:fried|breaded)\b/i,
  /[煙烟]燻|熏制|\bsmoked\b/i,
  /清蒸|\bsteamed\b/i,
  /水煮|\bboiled\b/i,
  /烘烤|烤制|\broasted\b/i,
  /[鹵卤]制|紅燒|红烧|\bbraised\b/i,
  /加糖|\bwith added sugar\b/i,
  /加[鹽盐]|\bwith salt\b/i,
  /注水|\bwith added solution\b/i
];

const RESULT_VERSION = 3;
const PREPARATION_MISSING = '当前食物尚未注明生熟或加工状态。';

function normalizeWords(name) {
  return name.normalize('NFKC').toLowerCase()
    .replace(/[\p{P}\p{Z}\s]+/gu, ' ').trim();
}

function joinHanWords(name) {
  return name.replace(/(\p{Script=Han}) +(?=\p{Script=Han})/gu, '$1');
}

function normalizeName(name) {
  return joinHanWords(normalizeWords(name));
}

function baseName(name) {
  return normalizeName(name.normalize('NFKC').replace(/\([^()]*\)/g, ' ')).replace(/平均值$/, '');
}

function englishKey(name) {
  return name.replace(/\b[a-z]{4,}\b/g, word =>
    word.replace(/ies$/, 'y').replace(/oes$/, 'o').replace(/([^sui])s$/, '$1'));
}

function parseQuery(query, index) {
  let name = normalizeWords(query).replace(/^(?:我家[买買]的|我[买買]的|家[里裡][买買]的)\s*/u, '');
  const states = new Set();
  const attached = ATTACHED_STATES.find(word => name.startsWith(word));
  if (attached && name.length > attached.length) {
    states.add(STATE_WORDS[attached]);
    name = name.slice(attached.length).trim();
  }

  const words = name.split(' ');
  while (words.length > 1 && Object.prototype.hasOwnProperty.call(STATE_WORDS, words[0])) {
    states.add(STATE_WORDS[words.shift()]);
  }
  while (words.length > 1 && Object.prototype.hasOwnProperty.call(STATE_WORDS, words[words.length - 1])) {
    states.add(STATE_WORDS[words.pop()]);
  }
  name = joinHanWords(words.join(' '));

  // 词本身可能以生或熟开头。完整名称可查时保留，例如生菜。
  if (!states.size && !index.exactNames.has(name)) {
    const compact = /^([生熟])([\p{Script=Han}]+)$/u.exec(name);
    if (compact) {
      const [, state, ingredient] = compact;
      states.add(STATE_WORDS[state]);
      name = ingredient;
    }
  }
  return { name, states };
}

function stateLabel(states) {
  const raw = states.includes('raw');
  const cooked = states.includes('cooked');
  return [raw === cooked ? '生熟未标明' : raw ? '生' : '熟',
    ...states.filter(state => STATE_LABELS[state]).map(state => STATE_LABELS[state])
  ].join(' · ');
}

function buildIndex(references) {
  const exactNames = new Set();
  const entries = references.map(reference => {
    const { id, name, aliases, states, profile, category, description, simplifiedName } = reference;
    const local = (reference.localAliases || []).map(normalizeName);
    const english = (reference.englishNames || []).map(baseName).filter(Boolean);
    const official = [name, simplifiedName].filter(Boolean);
    const mainNames = [...new Set(official.map(baseName))].filter(Boolean);
    const names = [...new Set([...official.map(normalizeName), ...mainNames])].filter(Boolean);
    const otherNames = [...new Set([...aliases.flatMap(alias => [normalizeName(alias), baseName(alias)]), ...english])].filter(Boolean);
    const dataset = id.split(':', 1)[0];
    [...names, ...local, ...otherNames].forEach(key => exactNames.add(key));
    return {
      entry: { id, name, profile, states, dataset, category, description,
        displayName: [simplifiedName, name, ...aliases].find(value => value && HAN.test(value)) || name,
        stateLabel: stateLabel(states) },
      names,
      official,
      verifiedNames: (reference.verifiedNames || []).map(normalizeName),
      composition: reference.composition,
      mainNames,
      otherNames,
      local,
      english,
      englishText: [baseName(name), ...english].filter(value => !HAN.test(value)).map(value => ` ${englishKey(value)} `),
      englishHead: name.split(',').slice(0, 2).map(part => englishKey(baseName(part))),
      composite: COMPOSITE_CATEGORY.test(category || ''),
      prepared: states.includes('dry') || states.includes('processed') || PRODUCT_FORM.test(name),
      completeness: Object.keys(profile.values).length
    };
  });
  return { entries, exactNames };
}

function hasEnglishWords(text, words) {
  return words.every(word => text.includes(` ${word} `));
}

function getNameScore(item, query, descriptiveBase, englishWords) {
  if (item.names.includes(query)) return SCORE.official;
  if (item.local.includes(query)) return SCORE.local;
  if (item.otherNames.includes(query)) return SCORE.alias;
  if (englishWords.length) {
    if (!item.englishText.some(text => hasEnglishWords(text, englishWords))) return 0;
    return englishWords.length > 1 || item.englishHead.includes(englishWords[0]) ? SCORE.words : SCORE.partial;
  }
  if (item.mainNames.some(name => name.endsWith(query))) return SCORE.suffix;
  if (item.mainNames.some(name => name.includes(query))) return SCORE.partial;
  if (item.otherNames.some(name => name.includes(query))) return SCORE.partial - 2;
  // 颜色和新鲜描述可退回已有完整名称，品牌、品种和配方限定继续参与查询。
  if (descriptiveBase && [...item.names, ...item.local, ...item.otherNames].includes(descriptiveBase)) return SCORE.descriptive;
  return 0;
}

function translatedTerms(scored, name, states) {
  const broad = name.length === 1;
  const donors = scored.filter(({ item, score }) => score && item.english.length && !item.composite
    && (!item.prepared || states.has('dry') || states.has('processed')));
  const best = Math.max(0, ...donors.map(({ score }) => score));
  const names = new Map();
  for (const { item, score } of donors) {
    if (!broad && score !== best) continue;
    for (const english of item.english) {
      const words = englishKey(english).split(' ').filter(word => !STATE_WORDS[word]);
      if (!words.length || words.length > 6 || words.some(word => !/^[a-z]+$/.test(word))) continue;
      // 泛搜单字时，多个不同样品都使用的英文中心词才用于扩展候选。
      const key = broad ? words[words.length - 1] : words.join(' ');
      if (key.length < 4) continue;
      if (!names.has(key)) names.set(key, new Set());
      names.get(key).add(item.names[item.names.length - 1]);
    }
  }
  const most = Math.max(0, ...[...names.values()].map(samples => samples.size));
  const minimum = broad ? Math.max(2, Math.ceil(most * 0.7)) : 1;
  return [...names].filter(([, samples]) => samples.size >= minimum)
    .sort(([left, a], [right, b]) => b.size - a.size || left.localeCompare(right))
    .slice(0, MAX_ENGLISH_NAMES).map(([key]) => key.split(' '));
}

function matchesStates(candidate, required) {
  return [...required].every(state => candidate.includes(state)
    && (state !== 'raw' || !candidate.includes('cooked'))
    && (state !== 'cooked' || !candidate.includes('raw')));
}

function rankScore(item, score, states) {
  if (score === SCORE.official) return score;
  const formPenalty = item.prepared && !states.has('dry') && !states.has('processed');
  const knownPreparation = item.entry.states.some(state => state === 'raw' || state === 'cooked');
  return score + (knownPreparation ? 3 : 0) - (formPenalty ? 34 : 0) - (item.composite ? 26 : 0);
}

function comparisonDifference(target, reference, minimum) {
  const difference = Math.abs(target - reference);
  return difference >= minimum && difference >= 0.3 * Math.max(target, reference);
}

function matchReason(item, target, index) {
  if (!target || typeof target.name !== 'string' || !target.name.trim() || target.name.length > MAX_QUERY_LENGTH) {
    return '缺少原食物身份，无法确认可引用。';
  }
  if (target.basis !== item.entry.profile.basis) return '当前食物与参考资料的计量单位不同。';

  const original = parseQuery(target.name, index);
  const officialName = item.official.some(name =>
    parseQuery(name.normalize('NFKC').replace(SAMPLE_YEAR, ''), index).name === original.name);
  const verifiedName = item.verifiedNames.some(name => parseQuery(name, index).name === original.name);
  const reviewed = target.verifiedId === item.entry.profile.source.recordId
    && item.verifiedNames.includes(normalizeName(target.name));
  if (!officialName && !verifiedName && !reviewed) return '名称、物种或部位未确认一致。';

  if (target.preparation === 'raw' || target.preparation === 'cooked') original.states.add(target.preparation);
  const sampleStates = item.entry.states;
  if (!reviewed && !original.states.size && !sampleStates.includes('unknown')) {
    return PREPARATION_MISSING;
  }
  if (!matchesStates(sampleStates, original.states)
    || (!reviewed && (!original.states.size || sampleStates.some(state => !original.states.has(state))))
    || (!reviewed && item.composite)) {
    return '生熟、加工状态或配方未确认一致。';
  }
  const sampleDescription = [item.entry.name, (item.entry.description || '').split('前處理描述', 1)[0]].join(' ');
  if (!reviewed && CUT_MARKERS.some(pattern => pattern.test(sampleDescription) && !pattern.test(target.name))) {
    return '样品的可食部或加工方式未确认一致。';
  }

  const source = item.composition;
  const current = target.composition;
  const valid = amount => Number.isFinite(amount) && amount >= 0 && amount <= 100;
  if (![current?.protein, current?.fat, source?.protein, source?.fat].every(valid)) {
    return '缺少可比较的蛋白质或脂肪数据。';
  }
  const aminoTotal = Object.values(item.entry.profile.values).reduce((total, amount) => total + amount, 0);
  if (comparisonDifference(current.protein, source.protein, 2)
    || comparisonDifference(current.fat, source.fat, 2)
    || (valid(current.water) && valid(source.water) && Math.abs(current.water - source.water) >= 15)
    || aminoTotal > current.protein * 1000 + 1e-6) {
    return '蛋白质、脂肪、水分或氨基酸总量存在明显差异。';
  }
  return '';
}

function evaluateMatch(item, target, index) {
  const reason = matchReason(item, target, index);
  const [preparation] = item.entry.states;
  if (reason !== PREPARATION_MISSING || item.entry.states.length !== 1 || !['raw', 'cooked'].includes(preparation)) {
    return { reason };
  }
  // 只有补上明确的生熟信息就能通过全部校验时，才让用户在详情页确认。
  const confirmedReason = matchReason(item, { ...target, preparation }, index);
  if (confirmedReason) return { reason: confirmedReason };
  return target.allowPreparationConfirmation === true ? { reason, preparationToConfirm: preparation } : { reason };
}

function findMatches(query, target, index) {
  const { name, states } = parseQuery(query, index);
  if (!name) return { matches: [], total: 0 };

  const chinese = HAN.test(name);
  const singleHanCharacter = chinese && name.length === 1;
  const shortName = chinese ? name.replace(DESCRIPTIVE_PREFIX, '') : '';
  const descriptiveBase = shortName !== name && shortName.length >= 2 ? shortName : '';
  const englishWords = chinese ? [] : englishKey(name).split(' ');
  const scored = index.entries.map(item => ({ item, score: getNameScore(item, name, descriptiveBase, englishWords) }));
  const translated = chinese ? translatedTerms(scored, name, states) : [];
  const localCategories = new Set(scored.filter(({ item, score }) => score === SCORE.local && !item.prepared)
    .map(({ item }) => item.entry.category));

  const matches = [];
  for (const { item, score } of scored) {
    if (!matchesStates(item.entry.states, states)) continue;
    // 大陆资料的同名俗称可消歧。异类地区别名不抢占该词的结果。
    if (localCategories.size === 1 && item.entry.dataset === 'TFDA' && score === SCORE.alias
      && !localCategories.has(item.entry.category)) continue;
    let strength = score;
    if (!strength && item.entry.dataset === 'USDA' && !item.composite && translated.some(words =>
      words.length === 1 ? item.englishHead.includes(words[0])
        : item.englishText.some(text => hasEnglishWords(text, words))
    )) strength = singleHanCharacter ? SCORE.sharedName : SCORE.translated;
    if (!strength) continue;
    const broadSearch = singleHanCharacter && strength < SCORE.alias;
    if (broadSearch && (item.composite || item.prepared) && !states.has('dry') && !states.has('processed')) continue;
    const rank = rankScore(item, strength, states);
    const weakIdentity = broadSearch && translated.length && item.entry.dataset === 'TFDA' && item.englishText.length
      && !translated.some(words => item.englishText.some(text => hasEnglishWords(text, words)));
    matches.push({ item, ...evaluateMatch(item, target, index), rank: rank - (weakIdentity ? 20 : 0) });
  }

  matches.sort((left, right) => Number(!right.reason) - Number(!left.reason)
    || Number(!!right.preparationToConfirm) - Number(!!left.preparationToConfirm)
    || right.rank - left.rank
    || Number(right.item.entry.dataset === 'USDA') - Number(left.item.entry.dataset === 'USDA')
    || right.item.completeness - left.item.completeness
    || left.item.entry.id.localeCompare(right.item.entry.id));
  return { matches: matches.slice(0, MAX_RESULTS).map(({ item, reason, preparationToConfirm }) => ({
    ...item.entry,
    canApply: !reason,
    matchReason: reason,
    ...(preparationToConfirm ? { preparationToConfirm } : {})
  })), total: matches.length };
}

function createReferenceSearch(readReferences) {
  let index;
  return event => {
    const query = event?.query;
    const result = typeof query === 'string' && query.length <= MAX_QUERY_LENGTH && query.trim()
      ? findMatches(query, event.target, index || (index = buildIndex(readReferences())))
      : { matches: [], total: 0 };
    return { version: RESULT_VERSION, ...result };
  };
}

module.exports = { createReferenceSearch, RESULT_VERSION };
