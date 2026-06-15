const TARGET_COEF_STORAGE_PREFIX = 'milk_goal_target_coef_';
const CLOUD_FIELD = 'nutritionTargetPreferences';

function getWxApi() {
  return typeof wx !== 'undefined' ? wx : null;
}

function targetCoefStorageKey(babyUid) {
  return `${TARGET_COEF_STORAGE_PREFIX}${babyUid || 'default'}`;
}

function normalizeTargetMode(mode) {
  return mode === 'calorie' ? 'calorie' : 'protein';
}

function normalizeTargetPreferences(preferences = {}) {
  if (!preferences || typeof preferences !== 'object') return {};
  return {
    naturalProteinCoefficient: preferences.naturalProteinCoefficient ?? '',
    specialProteinCoefficient: preferences.specialProteinCoefficient ?? '',
    calorieCoefficient: preferences.calorieCoefficient ?? '',
    preferredTargetMode: preferences.preferredTargetMode ? normalizeTargetMode(preferences.preferredTargetMode) : ''
  };
}

function hasTargetCoefficient(preferences = {}) {
  if (!preferences || typeof preferences !== 'object') return false;
  return [
    preferences.naturalProteinCoefficient,
    preferences.specialProteinCoefficient,
    preferences.calorieCoefficient
  ].some(value => value !== undefined && value !== null && value !== '');
}

function readNutritionTargetPreferences(babyUid, wxOverride = null) {
  const wxApi = wxOverride || getWxApi();
  if (!wxApi || typeof wxApi.getStorageSync !== 'function') return {};
  try {
    const stored = wxApi.getStorageSync(targetCoefStorageKey(babyUid));
    return stored && typeof stored === 'object' ? stored : {};
  } catch (error) {
    return {};
  }
}

function writeNutritionTargetPreferences(babyUid, preferences = {}, wxOverride = null) {
  const wxApi = wxOverride || getWxApi();
  if (!wxApi || typeof wxApi.setStorageSync !== 'function') return false;
  try {
    wxApi.setStorageSync(targetCoefStorageKey(babyUid), normalizeTargetPreferences(preferences));
    return true;
  } catch (error) {
    return false;
  }
}

async function readCloudNutritionTargetPreferences(babyUid, wxOverride = null) {
  const wxApi = wxOverride || getWxApi();
  if (!babyUid || !wxApi?.cloud?.database) return {};
  try {
    const res = await wxApi.cloud.database().collection('baby_info').where({ babyUid }).limit(1).get();
    const preferences = res?.data?.[0]?.[CLOUD_FIELD];
    return preferences && typeof preferences === 'object' ? normalizeTargetPreferences(preferences) : {};
  } catch (error) {
    return {};
  }
}

async function writeCloudNutritionTargetPreferences(babyUid, preferences = {}, wxOverride = null) {
  const wxApi = wxOverride || getWxApi();
  if (!babyUid || !wxApi?.cloud?.database) return false;
  const normalized = normalizeTargetPreferences(preferences);
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
    writeNutritionTargetPreferences(babyUid, normalized, wxApi);
    return true;
  } catch (error) {
    return false;
  }
}

async function getNutritionTargetPreferences(babyUid, wxOverride = null) {
  const wxApi = wxOverride || getWxApi();
  const cloudPreferences = await readCloudNutritionTargetPreferences(babyUid, wxApi);
  if (hasTargetCoefficient(cloudPreferences)) {
    writeNutritionTargetPreferences(babyUid, cloudPreferences, wxApi);
    return cloudPreferences;
  }
  return readNutritionTargetPreferences(babyUid, wxApi);
}

async function saveNutritionTargetPreferences(babyUid, preferences = {}, wxOverride = null) {
  const wxApi = wxOverride || getWxApi();
  const normalized = normalizeTargetPreferences(preferences);
  const cloudSaved = await writeCloudNutritionTargetPreferences(babyUid, normalized, wxApi);
  if (!cloudSaved) {
    writeNutritionTargetPreferences(babyUid, normalized, wxApi);
  }
  return cloudSaved;
}

function pickCoefficient(localValue, snapshotValue) {
  if (localValue !== undefined && localValue !== null && localValue !== '') {
    return localValue;
  }
  return snapshotValue;
}

module.exports = {
  TARGET_COEF_STORAGE_PREFIX,
  CLOUD_FIELD,
  targetCoefStorageKey,
  normalizeTargetMode,
  normalizeTargetPreferences,
  hasTargetCoefficient,
  readNutritionTargetPreferences,
  writeNutritionTargetPreferences,
  readCloudNutritionTargetPreferences,
  writeCloudNutritionTargetPreferences,
  getNutritionTargetPreferences,
  saveNutritionTargetPreferences,
  pickCoefficient
};
