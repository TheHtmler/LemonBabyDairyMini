const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function assertPngHasAlpha(filePath) {
  const png = fs.readFileSync(filePath);
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  const colorType = png[25];
  assert.ok([4, 6].includes(colorType), `${filePath} should use alpha PNG color type, got ${colorType}`);
}

test('meal-editor and treatment-record notify daily-feeding page to reload after save', () => {
  const mealEditor = fs.readFileSync('miniprogram/pkg-records/meal-editor/index.js', 'utf8');
  const treatmentRecord = fs.readFileSync('miniprogram/pkg-records/treatment-record/index.js', 'utf8');
  const milkFeedingEditorV2 = fs.readFileSync('miniprogram/pkg-milk/milk-feeding-editor-v2/index.js', 'utf8');

  assert.match(mealEditor, /notifyPreviousPageRefresh\s*\(/);
  assert.match(mealEditor, /await this\.notifyPreviousPageRefresh\(\);[\s\S]*wx\.navigateBack\(\)/);
  assert.match(mealEditor, /prevPage\.route [!=]==? 'pages\/daily-feeding\/index'/);
  assert.match(mealEditor, /await prevPage\.loadTodayData\(true\)/);

  assert.match(treatmentRecord, /notifyPreviousPageRefresh\s*\(/);
  assert.match(treatmentRecord, /await this\.notifyPreviousPageRefresh\(\);[\s\S]*wx\.navigateBack\(\)/);
  assert.match(treatmentRecord, /prevPage\.route [!=]==? 'pages\/daily-feeding\/index'/);
  assert.match(treatmentRecord, /await prevPage\.loadTodayData\(true\)/);

  [mealEditor, treatmentRecord, milkFeedingEditorV2].forEach((source) => {
    assert.match(source, /typeof prevPage\.fetchDailyRecords === 'function'/);
    assert.match(source, /await prevPage\.fetchDailyRecords\([^,]+,\s*\{[\s\S]*silent:\s*true[\s\S]*skipNextOnShowRefresh:\s*true[\s\S]*\}\)/);
    assert.doesNotMatch(source, /prevPage\.route === 'pages\/data-records-v2\/index'/);
  });
});

test('data records skips the onShow refresh after child editor already refreshed parent', () => {
  const dataRecords = fs.readFileSync('miniprogram/pages/data-records-v2/index.js', 'utf8');
  const onShowBlock = dataRecords.match(/onShow: async function\(\) \{[\s\S]*?\n  \},\n\n  consumeSkipNextOnShowRefresh/)[0];
  const fetchBlock = dataRecords.match(/async fetchDailyRecords\(dateStr, options = \{\}\) \{[\s\S]*?\n  \},\n\n  \/\/ 强制刷新数据/)[0];

  assert.match(onShowBlock, /this\.consumeSkipNextOnShowRefresh\(this\.data\.selectedDate\)/);
  assert.match(dataRecords, /consumeSkipNextOnShowRefresh\(dateStr\)/);
  assert.match(dataRecords, /markSkipNextOnShowRefresh\(dateStr,\s*options = \{\}\)/);
  assert.match(dataRecords, /options\.skipNextOnShowRefresh === true/);
  assert.match(fetchBlock, /this\.markSkipNextOnShowRefresh\(dateStr,\s*options\);[\s\S]*return/);
  assert.match(fetchBlock, /this\.markSkipNextOnShowRefresh\(dateStr,\s*options\);[\s\S]*\} catch \(error\)/);
});

test('daily feeding page counts food progress by meal records instead of food items', () => {
  const dailyFeeding = fs.readFileSync('miniprogram/pages/daily-feeding/index.js', 'utf8');

  assert.match(dailyFeeding, /dashboard\.buildFoodMealCount\(daily\.foodIntakeRecords \|\| \[\]\)/);
  assert.doesNotMatch(dailyFeeding, /const foodCount = \(daily\.foodIntakeRecords \|\| \[\]\)\.length/);
});

test('daily feeding target setup opens target modal while milk planner remains for calculation', () => {
  const dailyFeeding = fs.readFileSync('miniprogram/pages/daily-feeding/index.js', 'utf8');
  const dailyFeedingWxml = fs.readFileSync('miniprogram/pages/daily-feeding/index.wxml', 'utf8');
  const dailyFeedingJson = fs.readFileSync('miniprogram/pages/daily-feeding/index.json', 'utf8');
  const setupBlock = dailyFeeding.match(/openNutritionTargetSetup\(e = \{\}\) \{[\s\S]*?\n  \},\n\n  closeNutritionTargetSettings/)[0];

  assert.match(dailyFeedingJson, /nutrition-target-settings-modal/);
  assert.match(dailyFeeding, /targetSettingsModalVisible:\s*false/);
  assert.match(setupBlock, /targetSettingsModalVisible:\s*true/);
  assert.match(setupBlock, /targetSettingsMode:\s*mode/);
  assert.doesNotMatch(setupBlock, /navigateToMilkGoalPlanner/);
  assert.match(dailyFeeding, /handleNutritionTargetsSaved\(e = \{\}\)/);
  assert.match(dailyFeeding, /rebuildNutritionTargetWithPreferences\(preferences\)/);
  assert.match(dailyFeedingWxml, /<nutrition-target-settings-modal[\s\S]*visible="\{\{targetSettingsModalVisible\}\}"[\s\S]*bind:saved="handleNutritionTargetsSaved"/);
  assert.match(dailyFeedingWxml, /class="calc-btn" catchtap="navigateToMilkGoalPlanner"/);
  assert.match(dailyFeeding, /wx\.navigateTo\(\{ url: `\/pkg-milk\/milk-goal-planner-v2\/index/);
});

test('daily feeding uses themed first-paint loading and defers trend rebuild', () => {
  const dailyFeeding = fs.readFileSync('miniprogram/pages/daily-feeding/index.js', 'utf8');
  const dailyFeedingWxml = fs.readFileSync('miniprogram/pages/daily-feeding/index.wxml', 'utf8');
  const dailyFeedingWxss = fs.readFileSync('miniprogram/pages/daily-feeding/index.wxss', 'utf8');
  const initializePageBlock = dailyFeeding.match(/async initializePage\(\) \{[\s\S]*?\n  \},\n\n  \/\/ === 宝宝信息 ===/)[0];

  assert.doesNotMatch(initializePageBlock, /wx\.showLoading/);
  assert.match(initializePageBlock, /isHomeBooting:\s*false/);
  assert.match(dailyFeeding, /HOME_BOOT_MIN_DURATION/);
  assert.match(dailyFeeding, /consumeSkipHomeBootFlag/);
  assert.match(dailyFeeding, /skipHomeBoot \? false : true/);
  assert.match(dailyFeeding, /homeDataReady:\s*false/);
  assert.match(dailyFeeding, /homeDataReady:\s*true/);
  assert.match(dailyFeeding, /finishHomeBoot\(bootStartedAt, \{ skipMinDuration: skipHomeBoot \}\)/);
  assert.match(dailyFeeding, /HOME_BOOT_MIN_DURATION - elapsed/);
  assert.match(dailyFeeding, /homeLoadingText:\s*'宝宝记录准备中\.\.\.'/);
  assert.match(dailyFeeding, /homeLoadingText:\s*'宝宝记录准备中\.\.\.'/);
  assert.doesNotMatch(dailyFeeding, /正在同步宝宝信息/);
  assert.doesNotMatch(dailyFeeding, /正在摆好今日记录/);
  assert.doesNotMatch(dailyFeeding, /柠檬宝宝正在摆好今日记录/);
  assert.doesNotMatch(dailyFeeding, /waitForAppInitialization\(\(progress, text\)/);
  assert.match(initializePageBlock, /rebuildTrend:\s*false/);
  assert.match(dailyFeeding, /loadDeferredDashboardParts/);
  assert.match(dailyFeeding, /rebuildTrend\s*=\s*true/);
  assert.match(dailyFeeding, /const rangeSummariesPromise = rebuildTrend/);
  assert.match(dailyFeeding, /Promise\.resolve\(this\.rangeSummaries \|\| \[\]\)/);
  assert.match(dailyFeedingWxml, /class="home-boot-mask"/);
  assert.match(dailyFeedingWxml, /homeDataReady \? 'data-ready' : 'data-pending'/);
  assert.match(dailyFeedingWxml, /柠檬宝宝正在准备今日记录/);
  assert.match(dailyFeedingWxml, /class="home-milk-lemon-art"/);
  assert.match(dailyFeedingWxml, /src="\/images\/milk-lemon-loading\.png"/);
  assert.doesNotMatch(dailyFeedingWxml, /milk-lemon-loading\.svg/);
  assert.doesNotMatch(dailyFeedingWxml, /home-milk-foam/);
  assert.doesNotMatch(dailyFeedingWxml, /home-foam-dot/);
  assert.doesNotMatch(dailyFeedingWxml, /home-milk-bubble/);
  assert.doesNotMatch(dailyFeedingWxml, /home-boot-logo/);
  assert.doesNotMatch(dailyFeedingWxml, /lemon-orbit/);
  assert.match(dailyFeedingWxss, /\.home-boot-mask/);
  assert.match(dailyFeedingWxss, /\.home-boot-card\s*\{[\s\S]*background:\s*transparent/);
  assert.match(dailyFeedingWxss, /\.home-boot-card\s*\{[\s\S]*border:\s*0/);
  assert.match(dailyFeedingWxss, /\.home-boot-card\s*\{[\s\S]*box-shadow:\s*none/);
  assert.match(dailyFeedingWxss, /\.home\.data-pending/);
  assert.match(dailyFeedingWxss, /home-skeleton-shimmer/);
  assert.match(dailyFeedingWxss, /\.home-milk-lemon-art/);
  assert.match(dailyFeedingWxss, /\.lemon-loader\s*\{[\s\S]*width:\s*280rpx/);
  assert.match(dailyFeedingWxss, /\.lemon-loader\s*\{[\s\S]*height:\s*230rpx/);
  assert.match(dailyFeedingWxss, /\.home-milk-lemon-art\s*\{[\s\S]*width:\s*270rpx/);
  assert.match(dailyFeedingWxss, /\.home-milk-lemon-art\s*\{[\s\S]*height:\s*218rpx/);
  assert.doesNotMatch(dailyFeedingWxss, /\.home-milk-foam/);
  assert.doesNotMatch(dailyFeedingWxss, /\.home-foam-dot/);
  assert.doesNotMatch(dailyFeedingWxss, /\.home-milk-bubble/);
  assert.doesNotMatch(dailyFeedingWxss, /\.home-boot-logo/);
  assert.doesNotMatch(dailyFeedingWxss, /lemon-orbit/);
  assert.ok(fs.existsSync('miniprogram/images/milk-lemon-loading.png'));
  assertPngHasAlpha('miniprogram/images/milk-lemon-loading.png');
  assert.equal(fs.existsSync('miniprogram/images/milk-lemon-loading.svg'), false);
  assert.doesNotMatch(dailyFeedingWxss, /milk-lemon-loading\.svg/);
});

test('daily feeding skips passive onShow refresh within short fresh window', () => {
  const dailyFeeding = fs.readFileSync('miniprogram/pages/daily-feeding/index.js', 'utf8');
  const onShowBlock = dailyFeeding.match(/async onShow\(\) \{[\s\S]*?\n  \},\n\n  getHomeDashboardDirtyFlag/)[0];
  const shouldRefreshBlock = dailyFeeding.match(/shouldRefreshDashboardOnShow\(\) \{[\s\S]*?\n  \},\n\n  async refreshDashboardOnShow/)[0];
  const loadDashboardBlock = dailyFeeding.match(/async loadDashboard\(options = \{\}\) \{[\s\S]*?\n  \},\n\n  async loadDeferredDashboardParts/)[0];

  assert.match(dailyFeeding, /HOME_DASHBOARD_ONSHOW_TTL_MS\s*=\s*15 \* 1000/);
  assert.match(onShowBlock, /await this\.refreshDashboardOnShow\(\)/);
  assert.doesNotMatch(onShowBlock, /await this\.loadDashboard\(\{ silent: true, rebuildTrend: false \}\)/);
  assert.match(shouldRefreshBlock, /!this\._lastDashboardLoadAt/);
  assert.match(shouldRefreshBlock, /this\._lastDashboardDate !== today/);
  assert.match(shouldRefreshBlock, /this\._lastDashboardBabyUid !== babyUid/);
  assert.match(shouldRefreshBlock, /this\.hasPendingHomeDashboardDirty\(babyUid\)/);
  assert.match(shouldRefreshBlock, /Date\.now\(\) - this\._lastDashboardLoadAt >= HOME_DASHBOARD_ONSHOW_TTL_MS/);
  assert.match(loadDashboardBlock, /const loadStartedAt = Date\.now\(\)/);
  assert.match(loadDashboardBlock, /this\.markDashboardCacheFresh\(babyUid,\s*today,\s*loadStartedAt\)/);
});

test('current-device data changes mark home dashboard dirty before returning home', () => {
  const dailySummaryV2 = fs.readFileSync('miniprogram/models/dailySummaryV2.js', 'utf8');
  const nutritionTargetPreferences = fs.readFileSync('miniprogram/utils/nutritionTargetPreferences.js', 'utf8');
  const medicationsPage = fs.readFileSync('miniprogram/pkg-misc/medications/index.js', 'utf8');

  assert.match(dailySummaryV2, /function markHomeDashboardDirty\(babyUid,\s*date\)/);
  assert.match(dailySummaryV2, /async function markDirty\(babyUid,\s*date\) \{[\s\S]*markHomeDashboardDirty\(babyUid,\s*date\)/);
  assert.match(nutritionTargetPreferences, /reason:\s*'nutritionTargetPreferences'/);
  assert.match(nutritionTargetPreferences, /markHomeDashboardDirty\(babyUid\);[\s\S]*return cloudSaved/);
  assert.match(medicationsPage, /reason:\s*'medications'/);
  assert.match(medicationsPage, /markHomeDashboardDirty\(babyUid\);[\s\S]*this\.hideModal\(\)/);
  assert.match(medicationsPage, /doc\(id\)\.remove\(\);[\s\S]*markHomeDashboardDirty\(babyUid\)/);
});

test('daily feeding medication checklist uses raw medication history before deferred summaries', () => {
  const dailyFeeding = fs.readFileSync('miniprogram/pages/daily-feeding/index.js', 'utf8');

  assert.match(dailyFeeding, /MedicationRecordModel\s*\.\s*getLatestRecordsBeforeDateForMedications/);
  assert.match(dailyFeeding, /buildMedicationHistoryFromRecords/);
  assert.match(dailyFeeding, /medicationHistoryRecords/);
});

test('daily feeding derives planned meals from recent day records without duplicate query', () => {
  const dailyFeeding = fs.readFileSync('miniprogram/pages/daily-feeding/index.js', 'utf8');

  assert.doesNotMatch(dailyFeeding, /FeedingRecordV2Model\.getRecentDayMealCount/);
  assert.match(dailyFeeding, /FeedingRecordV2Model\.getRecentDayRecords\(babyUid,\s*today\)/);
  assert.match(dailyFeeding, /plannedMeals\s*=\s*Array\.isArray\(recentDay\?\.records\)\s*\?\s*recentDay\.records\.length\s*:\s*0/);
});

test('role selection startup loading uses lemon themed motion without a long forced wait', () => {
  const roleSelection = fs.readFileSync('miniprogram/pages/role-selection/index.js', 'utf8');
  const roleSelectionWxml = fs.readFileSync('miniprogram/pages/role-selection/index.wxml', 'utf8');
  const roleSelectionWxss = fs.readFileSync('miniprogram/pages/role-selection/index.wxss', 'utf8');
  const roleLoadingBlock = roleSelectionWxml.match(/<view class="loading-logo[\s\S]*?<\/view>\n      <view class="loading-message"/)[0];

  assert.doesNotMatch(roleSelection, /minLoadingTime\s*=\s*1000/);
  assert.match(roleSelection, /this\.app\.globalData\.skipHomeBootOnce = true/);
  assert.match(roleSelection, /this\.app\.globalData\.skipHomeBootOnce = false/);
  assert.doesNotMatch(roleSelection, /正在获取用户信息/);
  assert.doesNotMatch(roleSelection, /loadingMessages/);
  assert.doesNotMatch(roleSelection, /loadingMessageIndex/);
  assert.doesNotMatch(roleSelection, /rotateLoadingMessage/);
  assert.doesNotMatch(roleSelection, /startLoadingMessageRotation/);
  assert.doesNotMatch(roleSelection, /stopLoadingMessageRotation/);
  assert.doesNotMatch(roleSelection, /柠檬宝宝正在努力准备/);
  assert.doesNotMatch(roleSelection, /奶泡/);
  assert.doesNotMatch(roleSelection, /小奶泡正在轻轻冒泡/);
  assert.match(roleSelection, /loadingText:\s*'宝宝记录准备中\.\.\.'/);
  assert.match(roleSelection, /const isNavigating = this\.handleNavigation\(initResult\)/);
  assert.match(roleSelection, /if \(!isNavigating\) \{[\s\S]*isInitializing:\s*false/);
  assert.match(roleSelection, /return true;[\s\S]*\/\/ 如果已选择角色但未完成宝宝信息/);
  assert.match(roleSelectionWxml, /loading-logo \{\{initProgress >= 100 \? 'entering' : 'working'\}\}/);
  assert.match(roleLoadingBlock, /class="milk-lemon-art"/);
  assert.match(roleLoadingBlock, /src="\/images\/milk-lemon-loading\.png"/);
  assert.doesNotMatch(roleLoadingBlock, /milk-lemon-loading\.svg/);
  assert.doesNotMatch(roleLoadingBlock, /LemonLogo\.png/);
  assert.doesNotMatch(roleLoadingBlock, /lemon-character-body/);
  assert.doesNotMatch(roleLoadingBlock, /lemon-leaf-spark/);
  assert.doesNotMatch(roleLoadingBlock, /lemon-blush/);
  assert.doesNotMatch(roleLoadingBlock, /milk-foam/);
  assert.doesNotMatch(roleLoadingBlock, /foam-dot/);
  assert.doesNotMatch(roleLoadingBlock, /milk-bubble/);
  assert.doesNotMatch(roleLoadingBlock, /lemon-spark/);
  assert.doesNotMatch(roleLoadingBlock, /lemon-arm/);
  assert.doesNotMatch(roleLoadingBlock, /lemon-foot/);
  assert.doesNotMatch(roleLoadingBlock, /loading-sweat/);
  assert.match(roleSelectionWxml, /class="loading-message"/);
  assert.doesNotMatch(roleSelectionWxml, /loading-steps/);
  assert.doesNotMatch(roleSelectionWxml, /loading-spinner/);
  assert.doesNotMatch(roleSelectionWxml, /progress-text/);
  assert.doesNotMatch(roleSelectionWxml, /width: \{\{initProgress\}\}%/);
  assert.doesNotMatch(roleSelectionWxml, /loading-orbit/);
  assert.match(roleSelectionWxss, /\.milk-lemon-art/);
  assert.match(roleSelectionWxss, /\.loading-logo\s*\{[\s\S]*width:\s*268rpx/);
  assert.match(roleSelectionWxss, /\.loading-logo\s*\{[\s\S]*height:\s*224rpx/);
  assert.match(roleSelectionWxss, /\.milk-lemon-art\s*\{[\s\S]*width:\s*260rpx/);
  assert.match(roleSelectionWxss, /\.milk-lemon-art\s*\{[\s\S]*height:\s*210rpx/);
  assert.doesNotMatch(roleSelectionWxss, /\.milk-foam/);
  assert.doesNotMatch(roleSelectionWxss, /\.foam-dot/);
  assert.doesNotMatch(roleSelectionWxss, /\.milk-bubble/);
  assert.doesNotMatch(roleSelectionWxss, /\.lemon-character-body/);
  assert.match(roleSelectionWxss, /lemon-breath/);
  assert.doesNotMatch(roleSelectionWxss, /lemon-jelly-work/);
  assert.doesNotMatch(roleSelectionWxss, /milk-bubble-float/);
  assert.doesNotMatch(roleSelectionWxss, /milk-foam-bob/);
  assert.doesNotMatch(roleSelectionWxss, /lemon-spark-pop/);
  assert.doesNotMatch(roleSelectionWxss, /\.lemon-leaf-spark/);
  assert.doesNotMatch(roleSelectionWxss, /\.lemon-blush/);
  assert.doesNotMatch(roleSelectionWxss, /lemon-leaf-wiggle/);
  assert.doesNotMatch(roleSelectionWxss, /lemon-blush-pulse/);
  assert.doesNotMatch(roleSelectionWxss, /lemon-arm-wave/);
  assert.doesNotMatch(roleSelectionWxss, /lemon-foot-tap/);
  assert.doesNotMatch(roleSelectionWxss, /loading-sweat-drop/);
  assert.doesNotMatch(roleSelectionWxss, /\.loading-orbit/);
  assert.match(roleSelectionWxss, /\.loading-message/);
  assert.match(roleSelectionWxss, /\.loading-content\s*\{[\s\S]*width:\s*480rpx/);
  assert.match(roleSelectionWxss, /\.loading-content\s*\{[\s\S]*background:\s*transparent/);
  assert.match(roleSelectionWxss, /\.loading-content\s*\{[\s\S]*box-shadow:\s*none/);
  assert.match(roleSelectionWxss, /\.loading-message\s*\{[\s\S]*width:\s*100%/);
  assert.match(roleSelectionWxss, /\.loading-message\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.doesNotMatch(roleSelectionWxss, /loading-message-fade/);
  assert.doesNotMatch(roleSelectionWxss, /text-overflow:\s*ellipsis/);
  assert.doesNotMatch(roleSelectionWxss, /\.loading-step/);
  assert.doesNotMatch(roleSelectionWxss, /\.spinner/);
  assert.ok(fs.existsSync('miniprogram/images/milk-lemon-loading.png'));
  assertPngHasAlpha('miniprogram/images/milk-lemon-loading.png');
  assert.equal(fs.existsSync('miniprogram/images/milk-lemon-loading.svg'), false);
  assert.doesNotMatch(roleSelectionWxss, /milk-lemon-loading\.svg/);
});
