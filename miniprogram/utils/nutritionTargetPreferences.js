const TARGET_COEF_STORAGE_PREFIX = 'milk_goal_target_coef_';

function getWxApi() {
  return typeof wx !== 'undefined' ? wx : null;
}

function targetCoefStorageKey(babyUid) {
  return `${TARGET_COEF_STORAGE_PREFIX}${babyUid || 'default'}`;
}

function normalizeTargetMode(mode) {
  return mode === 'calorie' ? 'calorie' : 'protein';
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
    wxApi.setStorageSync(targetCoefStorageKey(babyUid), preferences);
    return true;
  } catch (error) {
    return false;
  }
}

function pickCoefficient(localValue, snapshotValue) {
  if (localValue !== undefined && localValue !== null && localValue !== '') {
    return localValue;
  }
  return snapshotValue;
}

module.exports = {
  TARGET_COEF_STORAGE_PREFIX,
  targetCoefStorageKey,
  normalizeTargetMode,
  readNutritionTargetPreferences,
  writeNutritionTargetPreferences,
  pickCoefficient
};
