const test = require('node:test');
const assert = require('node:assert/strict');

function createDbMock(overrides = {}) {
  const writes = {
    profileUpdate: null,
    profileAdd: null,
    babyInfoUpdate: null,
    compatUpdate: null,
    compatAdd: null
  };
  const profileData = overrides.profileData || [];
  const babyInfoData = overrides.babyInfoData || [];
  const compatData = overrides.compatData || [];

  function queryResult(data) {
    return {
      limit() {
        return this;
      },
      get: async () => ({ data })
    };
  }

  const db = {
    command: {},
    serverDate() {
      return '__server_date__';
    },
    collection(name) {
      if (name === 'milk_nutrition_profiles') {
        return {
          where() {
            return queryResult(profileData);
          },
          doc() {
            return {
              update: async ({ data }) => {
                writes.profileUpdate = data;
                return {};
              }
            };
          },
          add: async ({ data }) => {
            writes.profileAdd = data;
            return { _id: 'profile-doc-1' };
          }
        };
      }

      if (name === 'baby_info') {
        return {
          where() {
            return queryResult(babyInfoData);
          },
          doc() {
            return {
              update: async ({ data }) => {
                writes.babyInfoUpdate = data;
                return {};
              }
            };
          }
        };
      }

      if (name === 'nutrition_settings') {
        return {
          where() {
            return queryResult(compatData);
          },
          doc() {
            return {
              update: async ({ data }) => {
                writes.compatUpdate = data;
                return {};
              }
            };
          },
          add: async ({ data }) => {
            writes.compatAdd = data;
            return { _id: 'compat-doc-1' };
          }
        };
      }

      throw new Error(`unexpected collection: ${name}`);
    }
  };

  return { db, writes };
}

function withWx(db, callback) {
  const previousWx = global.wx;
  global.wx = {
    cloud: {
      database() {
        return db;
      }
    }
  };
  try {
    return callback();
  } finally {
    global.wx = previousWx;
  }
}

function loadFresh(modulePath, db) {
  const resolved = require.resolve(modulePath);
  const profilePath = require.resolve('../miniprogram/models/nutritionProfile.js');
  delete require.cache[resolved];
  delete require.cache[profilePath];
  return withWx(db, () => require(modulePath));
}

test('buildProfileDataFromSettings converts legacy milk settings into a milk nutrition profile document', () => {
  const { db } = createDbMock();
  const MilkNutritionProfileModel = loadFresh('../miniprogram/models/nutritionProfile.js', db);

  const profile = MilkNutritionProfileModel.buildProfileDataFromSettings('baby-1', {
    natural_milk_protein: '1.2',
    natural_milk_calories: '68',
    natural_milk_fat: '4.1',
    natural_milk_carbs: '6.9',
    natural_milk_fiber: '0',
    formula_milk_protein: '10.6',
    formula_milk_calories: '505',
    formula_milk_ratio: {
      powder: '4.5',
      water: '30'
    },
    special_milk_protein: '12.5',
    special_milk_calories: '520',
    special_milk_ratio: {
      powder: '13.5',
      water: '90'
    }
  });

  assert.equal(profile.babyUid, 'baby-1');
  assert.equal(profile.schemaVersion, 1);
  assert.deepEqual(profile.breastMilk.nutritionPer100ml, {
    protein: 1.2,
    calories: 68,
    fat: 4.1,
    carbs: 6.9,
    fiber: 0
  });
  assert.deepEqual(
    profile.formulaPowders.map((powder) => ({
      id: powder.id,
      category: powder.category,
      proteinRole: powder.proteinRole,
      source: powder.source
    })),
    [
      {
        id: 'legacy_regular_formula',
        category: 'regular_formula',
        proteinRole: 'natural',
        source: 'legacy'
      },
      {
        id: 'legacy_special_formula',
        category: 'special_formula',
        proteinRole: 'special',
        source: 'legacy'
      }
    ]
  );
});

test('profileDocumentToNutritionSettings exposes compatible scalar values for aggregation pages', () => {
  const { db } = createDbMock();
  const MilkNutritionProfileModel = loadFresh('../miniprogram/models/nutritionProfile.js', db);

  const settings = MilkNutritionProfileModel.profileDocumentToNutritionSettings({
    breastMilk: {
      nutritionPer100ml: {
        protein: 1.15,
        calories: 66,
        fat: 4,
        carbs: 6.8,
        fiber: 0
      }
    },
    formulaPowders: [
      {
        id: 'regular-a',
        name: '普奶A',
        category: 'regular_formula',
        proteinRole: 'natural',
        nutritionPer100g: {
          protein: 10,
          calories: 500,
          fat: 20,
          carbs: 50,
          fiber: 0
        },
        mixRatio: {
          powder: 5,
          water: 30
        }
      },
      {
        id: 'energy-a',
        name: '无蛋白能量粉',
        category: 'energy_supplement',
        proteinRole: 'none',
        nutritionPer100g: {
          calories: 300
        },
        mixRatio: {
          powder: 3,
          water: 20
        }
      },
      {
        id: 'special-a',
        name: '特奶',
        category: 'special_formula',
        proteinRole: 'special',
        nutritionPer100g: {
          protein: 12,
          calories: 400
        },
        mixRatio: {
          powder: 10,
          water: 100
        }
      }
    ]
  });

  assert.equal(settings.natural_milk_protein, 1.15);
  assert.equal(settings.formula_milk_protein, 10);
  assert.deepEqual(settings.formula_milk_ratio, { powder: 5, water: 30 });
  assert.equal(settings.special_milk_protein, 12);
  assert.deepEqual(settings.special_milk_ratio, { powder: 10, water: 100 });
  assert.equal(settings.formulaPowders.length, 3);
});

test('profileDocumentToNutritionSettings keeps archived powders as legacy fallback values', () => {
  const { db } = createDbMock();
  const MilkNutritionProfileModel = loadFresh('../miniprogram/models/nutritionProfile.js', db);

  const settings = MilkNutritionProfileModel.profileDocumentToNutritionSettings({
    formulaPowders: [
      {
        id: 'regular-archived',
        name: '已停用普奶',
        category: 'regular_formula',
        proteinRole: 'natural',
        status: 'archived',
        nutritionPer100g: {
          protein: 10.8,
          calories: 510
        },
        mixRatio: {
          powder: 4.5,
          water: 30
        }
      }
    ]
  });

  assert.equal(settings.formula_milk_protein, 10.8);
  assert.deepEqual(settings.formula_milk_ratio, { powder: 4.5, water: 30 });
  assert.equal(settings.formulaPowders[0].status, 'archived');
});

test('updateNutritionProfileSettings upserts milk_nutrition_profiles without writing legacy collections', async () => {
  const { db, writes } = createDbMock();
  const MilkNutritionProfileModel = loadFresh('../miniprogram/models/nutritionProfile.js', db);

  const success = await MilkNutritionProfileModel.updateNutritionProfileSettings('baby-1', {
    natural_milk_protein: '1.1',
    natural_milk_calories: '67',
    formulaPowders: [
      {
        id: 'regular-a',
        name: '普奶A',
        category: 'regular_formula',
        proteinRole: 'natural',
        nutritionPer100g: {
          protein: '10',
          calories: '500'
        },
        mixRatio: {
          powder: '5',
          water: '30'
        }
      }
    ]
  });

  assert.equal(success, true);
  assert.equal(writes.profileAdd.babyUid, 'baby-1');
  assert.equal(writes.profileAdd.createdAt, '__server_date__');
  assert.equal(writes.profileAdd.updatedAt, '__server_date__');
  assert.equal(writes.profileAdd.formulaPowders.length, 1);
  assert.equal(writes.profileAdd.formulaPowders[0].status, 'active');
  assert.equal(writes.profileAdd.formulaPowders[0].createdAt, '__server_date__');
  assert.equal(writes.profileAdd.formulaPowders[0].updatedAt, '__server_date__');
  assert.equal(writes.profileAdd.formulaPowders[0].deletedAt, null);
  assert.equal(writes.babyInfoUpdate, null);
  assert.equal(writes.compatAdd, null);
  assert.equal(writes.compatUpdate, null);
});

test('getNutritionProfileSettings falls back to legacy settings before migration without writing data', async () => {
  const { db, writes } = createDbMock({
    profileData: [],
    babyInfoData: [
      {
        _id: 'baby-doc-1',
        babyUid: 'baby-1',
        nutritionSettings: {
          natural_milk_protein: '1.1',
          natural_milk_calories: '67'
        }
      }
    ],
    compatData: [
      {
        _id: 'compat-doc-1',
        babyUid: 'baby-1',
        formula_milk_protein: '10.6',
        formula_milk_calories: '505',
        formula_milk_ratio: {
          powder: '4.5',
          water: '30'
        }
      }
    ]
  });
  const MilkNutritionProfileModel = loadFresh('../miniprogram/models/nutritionProfile.js', db);

  const settings = await MilkNutritionProfileModel.getNutritionProfileSettings('baby-1');

  assert.equal(settings.natural_milk_protein, 1.1);
  assert.equal(settings.formula_milk_protein, 10.6);
  assert.deepEqual(settings.formula_milk_ratio, { powder: 4.5, water: 30 });
  assert.equal(settings.formulaPowders[0].id, 'legacy_regular_formula');
  assert.equal(writes.profileAdd, null);
  assert.equal(writes.profileUpdate, null);
});

test('NutritionModel.getNutritionSettings prefers milk_nutrition_profiles and returns compatible settings', async () => {
  const { db, writes } = createDbMock({
    profileData: [
      {
        _id: 'profile-doc-1',
        babyUid: 'baby-1',
        breastMilk: {
          nutritionPer100ml: {
            protein: 1.2,
            calories: 68,
            fat: 4,
            carbs: 7,
            fiber: 0
          }
        },
        formulaPowders: [
          {
            id: 'regular-a',
            name: '普奶A',
            category: 'regular_formula',
            proteinRole: 'natural',
            nutritionPer100g: {
              protein: 10,
              calories: 500
            },
            mixRatio: {
              powder: 5,
              water: 30
            }
          }
        ]
      }
    ],
    babyInfoData: [
      {
        _id: 'baby-doc-1',
        babyUid: 'baby-1',
        nutritionSettings: {
          natural_milk_protein: 1.1,
          formula_milk_protein: 8
        }
      }
    ],
    compatData: [
      {
        _id: 'compat-doc-1',
        babyUid: 'baby-1',
        formula_milk_protein: 9
      }
    ]
  });
  const NutritionModel = loadFresh('../miniprogram/models/nutrition.js', db);

  const settings = await NutritionModel.getNutritionSettings('baby-1');

  assert.equal(settings.natural_milk_protein, 1.2);
  assert.equal(settings.formula_milk_protein, 10);
  assert.equal(settings.formulaPowders[0].name, '普奶A');
  assert.equal(writes.babyInfoUpdate, null);
  assert.equal(writes.compatUpdate, null);
});
