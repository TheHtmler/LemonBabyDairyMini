const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const FOOD_COLLECTION = 'food_catalog';
const RECORD_COLLECTION = 'feeding_records';

async function paginate(collection, handler, pageSize = 100) {
  let skip = 0;
  while (true) {
    const res = await collection.skip(skip).limit(pageSize).get();
    const batch = res.data || [];
    if (batch.length === 0) break;
    await handler(batch);
    skip += batch.length;
  }
}

exports.main = async (event = {}) => {
  const dryRun = event.dryRun !== false;
  const updateFoods = event.updateFoods !== false;
  const updateRecords = event.updateRecords !== false;

  const summary = {
    ok: true,
    dryRun,
    food: { scanned: 0, updated: 0, skipped: 0 },
    records: { scanned: 0, updated: 0, intakesUpdated: 0 }
  };

  if (updateFoods) {
    const collection = db.collection(FOOD_COLLECTION);
    await paginate(collection, async (batch) => {
      for (const doc of batch) {
        summary.food.scanned += 1;
        const desiredType = doc.milkType ? 'milk' : 'food';
        if (doc.foodType === desiredType) {
          summary.food.skipped += 1;
          continue;
        }
        summary.food.updated += 1;
        if (!dryRun) {
          await collection.doc(doc._id).update({
            data: {
              foodType: desiredType,
              updatedAt: db.serverDate()
            }
          });
        }
      }
    });
  }

  if (updateRecords) {
    const collection = db.collection(RECORD_COLLECTION);
    await paginate(collection, async (batch) => {
      for (const doc of batch) {
        summary.records.scanned += 1;
        const intakes = Array.isArray(doc.intakes) ? doc.intakes : [];
        if (intakes.length === 0) continue;

        let changed = false;
        const updatedIntakes = intakes.map((item) => {
          if (!item) return item;
          const desiredType = item.milkType ? 'milk' : 'food';
          const currentType = item.foodType || item.type;
          if (currentType === desiredType) return item;
          changed = true;
          summary.records.intakesUpdated += 1;
          return {
            ...item,
            foodType: desiredType,
            type: desiredType
          };
        });

        if (!changed) continue;
        summary.records.updated += 1;
        if (!dryRun) {
          await collection.doc(doc._id).update({
            data: {
              intakes: updatedIntakes,
              updatedAt: db.serverDate()
            }
          });
        }
      }
    });
  }

  return summary;
};
