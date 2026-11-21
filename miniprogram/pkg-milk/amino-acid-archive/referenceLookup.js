const { AMINO_ACIDS } = require('../../utils/aminoAcidIntake');
const { createReferenceSearch, RESULT_VERSION } = require('./referenceSearch');

function readBundledReferences() {
  const [categories, versions, states, samples] = require('./referenceSamples');
  return samples.map(([sample, name, category, version, state, amounts, nutrients,
    aliases, simplifiedName, description, englishNames, localAliases, verifiedNames]) => {
    const usda = typeof sample === 'number';
    const recordId = String(sample);
    const sourceName = usda ? '美国农业部 FoodData Central' : '台湾食药署食品营养成分资料集';
    const url = usda ? `https://fdc.nal.usda.gov/food-details/${recordId}/nutrients` : 'https://data.gov.tw/dataset/8543';
    const values = {};
    AMINO_ACIDS.forEach(({ key }, index) => {
      if (amounts[index] != null) values[key] = amounts[index];
    });
    const composition = {};
    ['protein', 'fat', 'water'].forEach((key, index) => {
      if (nutrients[index] != null) composition[key] = nutrients[index];
    });
    return {
      id: `${usda ? 'USDA' : 'TFDA'}:${recordId}`,
      name,
      aliases: aliases || [],
      category: categories[category],
      states: states[state].split(','),
      simplifiedName, description: description ?? undefined, englishNames, localAliases, verifiedNames, composition,
      profile: {
        basis: 'g',
        values,
        estimated: true,
        source: { name: `${sourceName} · ${name}`, version: versions[version], recordId, url }
      }
    };
  });
}

const searchBundled = createReferenceSearch(readBundledReferences);

async function lookupReferences(event) {
  const device = wx.getDeviceInfo?.() || wx.getSystemInfoSync?.();
  if (device?.platform === 'devtools') return searchBundled(event);
  try {
    const response = await wx.cloud?.callFunction({ name: 'searchAminoAcidReferences', data: event });
    const result = response?.result;
    if (result?.version === RESULT_VERSION && Array.isArray(result.matches)
      && Number.isInteger(result.total) && result.total >= result.matches.length
      && result.matches.every(item => typeof item?.canApply === 'boolean')) return result;
  } catch (error) {
    console.warn('氨基酸云端查询失败，使用随包资料。', error?.errCode || '');
  }
  return searchBundled(event);
}

module.exports = { lookupReferences };
