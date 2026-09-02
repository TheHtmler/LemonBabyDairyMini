const {
  DEFAULT_GLUCOSE_CALORIE_COEFFICIENT,
  isValidGlucoseCalorieCoefficient,
  normalizeGlucoseCalorieCoefficient
} = require('./treatmentUtils');

const STORAGE_PREFIX = 'glucose_calorie_coef_';
const CLOUD_FIELD = 'glucoseCalorieCoefficient';

function getWxApi() {
  return typeof wx !== 'undefined' ? wx : null;
}

function glucoseCalorieStorageKey(babyUid) {
  return `${STORAGE_PREFIX}${babyUid || 'default'}`;
}

function readLocalGlucoseCalorieCoefficient(babyUid, wxOverride = null) {
  const wxApi = wxOverride || getWxApi();
  if (!wxApi || typeof wxApi.getStorageSync !== 'function') {
    return DEFAULT_GLUCOSE_CALORIE_COEFFICIENT;
  }
  try {
    const stored = wxApi.getStorageSync(glucoseCalorieStorageKey(babyUid));
    return isValidGlucoseCalorieCoefficient(stored)
      ? Number(stored)
      : DEFAULT_GLUCOSE_CALORIE_COEFFICIENT;
  } catch (error) {
    return DEFAULT_GLUCOSE_CALORIE_COEFFICIENT;
  }
}

function writeLocalGlucoseCalorieCoefficient(babyUid, coefficient, wxOverride = null) {
  const wxApi = wxOverride || getWxApi();
  if (!wxApi || typeof wxApi.setStorageSync !== 'function') return false;
  try {
    wxApi.setStorageSync(
      glucoseCalorieStorageKey(babyUid),
      normalizeGlucoseCalorieCoefficient(coefficient)
    );
    return true;
  } catch (error) {
    return false;
  }
}

async function readCloudGlucoseCalorieCoefficient(babyUid, wxOverride = null) {
  const wxApi = wxOverride || getWxApi();
  if (!babyUid || !wxApi?.cloud?.database) return null;
  try {
    const res = await wxApi.cloud.database().collection('baby_info').where({ babyUid }).limit(1).get();
    const value = res?.data?.[0]?.[CLOUD_FIELD];
    return isValidGlucoseCalorieCoefficient(value) ? Number(value) : null;
  } catch (error) {
    return null;
  }
}

async function writeCloudGlucoseCalorieCoefficient(babyUid, coefficient, wxOverride = null) {
  const wxApi = wxOverride || getWxApi();
  if (!babyUid || !wxApi?.cloud?.database) return false;
  const normalized = normalizeGlucoseCalorieCoefficient(coefficient);
  try {
    const db = wxApi.cloud.database();
    const res = await db.collection('baby_info').where({ babyUid }).limit(1).get();
    const doc = res?.data?.[0];
    if (!doc?._id) return false;
    await db.collection('baby_info').doc(doc._id).update({
      data: {
        [CLOUD_FIELD]: normalized,
        updatedAt: db.serverDate ? db.serverDate() : new Date()
      }
    });
    writeLocalGlucoseCalorieCoefficient(babyUid, normalized, wxApi);
    return true;
  } catch (error) {
    return false;
  }
}

async function getGlucoseCalorieCoefficient(babyUid, wxOverride = null) {
  const wxApi = wxOverride || getWxApi();
  const cloudCoefficient = await readCloudGlucoseCalorieCoefficient(babyUid, wxApi);
  if (isValidGlucoseCalorieCoefficient(cloudCoefficient)) {
    writeLocalGlucoseCalorieCoefficient(babyUid, cloudCoefficient, wxApi);
    return Number(cloudCoefficient);
  }
  return readLocalGlucoseCalorieCoefficient(babyUid, wxApi);
}

async function saveGlucoseCalorieCoefficient(babyUid, coefficient, wxOverride = null) {
  const wxApi = wxOverride || getWxApi();
  const normalized = normalizeGlucoseCalorieCoefficient(coefficient);
  const cloudSaved = await writeCloudGlucoseCalorieCoefficient(babyUid, normalized, wxApi);
  if (!cloudSaved) {
    writeLocalGlucoseCalorieCoefficient(babyUid, normalized, wxApi);
  }
  return cloudSaved;
}

module.exports = {
  STORAGE_PREFIX,
  CLOUD_FIELD,
  glucoseCalorieStorageKey,
  getGlucoseCalorieCoefficient,
  saveGlucoseCalorieCoefficient,
  readLocalGlucoseCalorieCoefficient,
  writeLocalGlucoseCalorieCoefficient
};
