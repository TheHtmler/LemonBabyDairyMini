const cloud = require('wx-server-sdk');
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  const db = cloud.database();
  const _ = db.command;

  function normalizeSettings(settings = {}) {
    const ratioFallback = (src = {}, powderKey = 'powder', waterKey = 'water') => ({
      powder: src.powder ?? src[powderKey] ?? '',
      water: src.water ?? src[waterKey] ?? ''
    });
    return {
      natural_milk_protein: settings.natural_milk_protein ?? '',
      formula_milk_protein: settings.formula_milk_protein ?? '',
      formula_milk_calories: settings.formula_milk_calories ?? '',
      formula_milk_fat: settings.formula_milk_fat ?? '',
      formula_milk_carbs: settings.formula_milk_carbs ?? '',
      formula_milk_fiber: settings.formula_milk_fiber ?? '',
      formula_milk_ratio: ratioFallback(settings.formula_milk_ratio || settings, 'formula_milk_ratio_powder',
  'formula_milk_ratio_water'),
      special_milk_protein: settings.special_milk_protein ?? '',
      special_milk_ratio: ratioFallback(settings.special_milk_ratio || settings, 'special_milk_ratio_powder',
  'special_milk_ratio_water')
    };
  }

  exports.main = async () => {
    const pageSize = 50;
    let offset = 0;
    let migrated = 0;
    let skipped = 0;
    const logs = [];

    while (true) {
      const res = await db.collection('baby_info').skip(offset).limit(pageSize).get();
      const batch = res.data || [];
      if (batch.length === 0) break;

      for (const doc of batch) {
        const babyUid = doc.babyUid;
        const raw = doc.nutritionSettings;
        if (!babyUid || !raw) {
          skipped++;
          continue;
        }
        const normalized = normalizeSettings(raw);

        const compat = await db.collection('nutrition_settings').where({ babyUid }).limit(1).get();
        if (compat.data.length > 0) {
          await db.collection('nutrition_settings').doc(compat.data[0]._id).update({
            data: { ...normalized, babyUid, updatedAt: db.serverDate() }
          });
          logs.push(`update compat for ${babyUid}`);
        } else {
          await db.collection('nutrition_settings').add({
            data: { ...normalized, babyUid, createdAt: db.serverDate(), updatedAt: db.serverDate() }
          });
          logs.push(`add compat for ${babyUid}`);
        }
        migrated++;
      }

      if (batch.length < pageSize) break;
      offset += pageSize;
    }

    return { migrated, skipped, logs };
  };