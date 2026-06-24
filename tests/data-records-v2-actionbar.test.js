const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('treatment record tab uses the same titleless icon action as feeding record', () => {
  const pageWxml = fs.readFileSync('miniprogram/pages/data-records-v2/index.wxml', 'utf8');
  const pageJs = fs.readFileSync('miniprogram/pages/data-records-v2/index.js', 'utf8');
  const componentWxml = fs.readFileSync('miniprogram/components/treatment-record-list/treatment-record-list.wxml', 'utf8');
  const componentJs = fs.readFileSync('miniprogram/components/treatment-record-list/treatment-record-list.js', 'utf8');
  const componentWxss = fs.readFileSync('miniprogram/components/treatment-record-list/treatment-record-list.wxss', 'utf8');
  const pageWxss = fs.readFileSync('miniprogram/pages/data-records-v2/index.wxss', 'utf8');

  assert.match(pageWxml, /<view class="copy-btn" bindtap="onCopyTreatmentToDate">[\s\S]*<text>导入数据<\/text>/);
  assert.match(pageWxml, /选择要导入的 \{\{copyCalendarContext\.label\}\} 来源日期/);
  assert.match(pageWxml, /<text class="calendar-today-label" wx:if="\{\{item\.isToday\}\}">今天<\/text>\s*<text class="calendar-day-number" wx:else>\{\{item\.day\}\}<\/text>/);
  assert.doesNotMatch(pageWxml, /复制数据/);
  assert.match(pageWxml, /<view class="add-btn" bindtap="navigateToTreatmentRecord">[\s\S]*<text>补充记录<\/text>/);
  assert.match(pageWxml, /<treatment-record-list[\s\S]*show-title="\{\{false\}\}"[\s\S]*show-action="\{\{false\}\}"/);
  assert.doesNotMatch(pageWxml, /<treatment-record-list[\s\S]*title="治疗记录"[\s\S]*action-text="补充记录"/);
  assert.match(pageJs, /treatment:\s*\{[\s\S]*hasSource:\s*\(\) => true[\s\S]*label:\s*'治疗记录'/);
  assert.match(pageJs, /onCopyTreatmentToDate\(\)\s*\{[\s\S]*this\.openCopyCalendar\('treatment'\)/);
  assert.match(pageJs, /const sourceDateStr = targetDateStr;/);
  assert.match(pageJs, /const targetDate = this\.data\.selectedDate/);
  assert.match(pageJs, /title:\s*'当前日期已有记录'/);
  assert.doesNotMatch(pageJs, /title:\s*'目标日期已有记录'/);
  assert.match(pageJs, /await this\.applyFeedingCopyToDate\(sourceDateStr, targetDate\)/);
  assert.match(pageJs, /await this\.applyFoodCopyToDate\(sourceDateStr, targetDate\)/);
  assert.match(pageJs, /await this\.applyMedicationCopyToDate\(sourceDateStr, targetDate\)/);
  assert.match(pageJs, /if \(type === 'treatment'\) \{[\s\S]*await this\.applyTreatmentCopyToDate\(sourceDateStr, targetDate\)/);
  assert.match(pageJs, /FeedingRecordV2Model\.getRecordsByDate\(babyUid, sourceDateStr\)/);
  assert.match(pageJs, /FoodIntakeRecordModel\.findByDate\(babyUid, sourceDateStr\)/);
  assert.match(pageJs, /MedicationRecordModel\.findByDate\(sourceDateStr, babyUid\)/);
  assert.match(pageJs, /async applyTreatmentCopyToDate\(sourceDateStr, targetDateStr\)/);
  assert.match(pageJs, /TreatmentRecordModel\.findByDate\(sourceDateStr, babyUid\)/);
  assert.match(pageJs, /TreatmentRecordModel\.delete\(record\._id \|\| record\.id\)/);
  assert.match(pageJs, /TreatmentRecordModel\.create\(record\)/);
  assert.match(pageJs, /已导入到当前日期/);
  assert.match(componentJs, /showTitle:\s*\{[\s\S]*type:\s*Boolean,[\s\S]*value:\s*true/);
  assert.match(componentJs, /showAction:\s*\{[\s\S]*type:\s*Boolean,[\s\S]*value:\s*true/);
  assert.match(componentWxml, /wx:if="\{\{showTitle && title\}\}"/);
  assert.match(componentWxml, /class="treatment-panel-action" wx:if="\{\{showAction\}\}"/);
  assert.match(pageWxss, /\.calendar-today-label\s*\{/);
  assert.match(componentWxml, /<image class="treatment-panel-action-icon" src="\/images\/icons\/add\.svg" mode="aspectFit"><\/image>/);
  assert.match(componentWxml, /<text class="treatment-panel-action-text">\{\{actionText\}\}<\/text>/);
  assert.match(componentWxss, /\.treatment-panel-header\.actions-only\s*\{[^}]*justify-content: flex-end;/s);
  assert.match(componentWxss, /\.treatment-panel-action-icon\s*\{[^}]*width: 24rpx;[^}]*height: 24rpx;/s);
});

test('data records supports seven-day future prerecording without future weight edits', () => {
  const pageJs = fs.readFileSync('miniprogram/pages/data-records-v2/index.js', 'utf8');
  const pageWxml = fs.readFileSync('miniprogram/pages/data-records-v2/index.wxml', 'utf8');
  const pageWxss = fs.readFileSync('miniprogram/pages/data-records-v2/index.wxss', 'utf8');
  const mealEditorJs = fs.readFileSync('miniprogram/pkg-records/meal-editor/index.js', 'utf8');

  assert.match(pageJs, /const FUTURE_PRERECORD_DAYS\s*=\s*7/);
  assert.match(pageJs, /function addDaysToDateKey\(dateKey,\s*days\)/);
  assert.match(pageJs, /function getFuturePrerecordEndDateKey\(/);
  assert.match(pageJs, /function isBeyondFuturePrerecordDate\(dateStr\)/);
  assert.match(pageJs, /const historyRangeLength = Math\.max\(baseRangeLength - 1,\s*daysToToday\)/);
  assert.match(pageJs, /const futureRangeLength = FUTURE_PRERECORD_DAYS/);
  assert.match(pageJs, /for \(let offset = futureRangeLength; offset >= -historyRangeLength; offset -= 1\)/);
  assert.match(pageJs, /date\.setDate\(today\.getDate\(\) \+ offset\)/);
  assert.match(pageJs, /isFuture:\s*this\.formatDate\(date\) > todayKey/);
  assert.match(pageWxml, /date-item[\s\S]*\{\{item\.isFuture \? 'future' : ''\}\}/);
  assert.match(pageWxml, /isBeyondFuturePrerecordDate\(item\.date\) \? 'disabled-future' : ''/);
  assert.match(pageWxss, /\.date-item\.future\s*\{/);
  assert.match(pageJs, /title:\s*'最多可提前记录7天'/);
  assert.match(pageJs, /const selectedIndex = this\.initDateList\(today\)/);
  assert.match(pageJs, /currentDateId:\s*`date-\$\{selectedIndex\}`/);
  assert.match(pageJs, /const selectedIndex = futureRangeLength - dayOffsetFromToday/);

  assert.match(pageJs, /isSelectedFuture:\s*isFutureDateKey\(selectedDate\)/);
  assert.match(pageWxml, /wx:if="\{\{item\.field && !isSelectedFuture\}\}"/);
  assert.match(pageJs, /openBasicInfoEditor\(e\)\s*\{[\s\S]*if \(this\.data\.isSelectedFuture\)/);

  assert.doesNotMatch(mealEditorJs, /暂不支持记录未来日期/);
  assert.doesNotMatch(mealEditorJs, /if \(isFutureDateKey\(this\.data\.selectedDate\)\)/);

  assert.match(pageJs, /async markFuturePrerecordSummariesDirty\(babyUid,\s*startDateStr\)/);
  assert.match(pageJs, /for \(let offset = 0; offset <= FUTURE_PRERECORD_DAYS; offset \+= 1\)/);
  assert.match(pageJs, /await DailySummaryV2Model\.markDirty\(babyUid,\s*targetDateStr\)/);
  assert.match(pageJs, /await this\.markFuturePrerecordSummariesDirty\(babyUid,\s*selectedDate\)/);
});

test('data record modals avoid null string props and component tag selectors', () => {
  const pageJs = fs.readFileSync('miniprogram/pages/data-records-v2/index.js', 'utf8');
  const pageWxml = fs.readFileSync('miniprogram/pages/data-records-v2/index.wxml', 'utf8');
  const foodModalWxml = fs.readFileSync('miniprogram/components/food-intake-modal/food-intake-modal.wxml', 'utf8');
  const foodModalWxss = fs.readFileSync('miniprogram/components/food-intake-modal/food-intake-modal.wxss', 'utf8');
  const feedingModalWxml = fs.readFileSync('miniprogram/components/feeding-modal/feeding-modal.wxml', 'utf8');
  const feedingModalWxss = fs.readFileSync('miniprogram/components/feeding-modal/feeding-modal.wxss', 'utf8');

  assert.match(pageWxml, /selectedMedicationName="\{\{newMedication\.name \|\| ''\}\}"/);
  assert.match(pageWxml, /dosage="\{\{newMedication\.dosage \|\| ''\}\}"/);
  assert.match(pageWxml, /unit="\{\{newMedication\.unit \|\| ''\}\}"/);
  assert.match(pageWxml, /time="\{\{newMedication\.time \|\| ''\}\}"/);
  assert.match(pageWxml, /frequency="\{\{newMedication\.frequency \|\| ''\}\}"/);
  assert.match(pageWxml, /notes="\{\{newMedication\.notes \|\| ''\}\}"/);
  assert.match(pageWxml, /selectedMedicationName="\{\{editingMedication \? \(editingMedication\.medicationName \|\| ''\) : ''\}\}"/);
  assert.match(pageWxml, /dosage="\{\{editingMedication \? \(editingMedication\.dosage \|\| ''\) : ''\}\}"/);
  assert.match(pageWxml, /unit="\{\{editingMedication \? \(editingMedication\.unit \|\| ''\) : ''\}\}"/);
  assert.match(pageWxml, /time="\{\{editingMedication \? \(editingMedication\.actualTime \|\| ''\) : ''\}\}"/);
  assert.match(pageWxml, /frequency="\{\{editingMedication \? \(editingMedication\.frequency \|\| ''\) : ''\}\}"/);
  assert.match(pageWxml, /notes="\{\{editingMedication \? \(editingMedication\.notes \|\| ''\) : ''\}\}"/);
  assert.match(pageJs, /dosage:\s*medication\.dosage \|\| ''/);
  assert.match(pageJs, /unit:\s*medication\.unit \|\| ''/);

  assert.match(foodModalWxml, /class="[^"]*input-group-input[^"]*"/);
  assert.match(foodModalWxml, /class="[^"]*food-search-control[^"]*"/);
  assert.match(foodModalWxml, /placeholder-class="food-search-placeholder"/);
  assert.match(foodModalWxss, /\.input-group-input\s*\{/);
  assert.match(foodModalWxss, /\.food-search-control\s*\{/);
  assert.match(foodModalWxss, /\.food-search-placeholder\s*\{/);
  assert.doesNotMatch(foodModalWxss, /\.[\w-]+\s+(input|text|view|button|textarea|picker|image|scroll-view)\b/);
  assert.doesNotMatch(foodModalWxss, /::placeholder/);
  assert.match(feedingModalWxml, /class="goal-coef-control"/);
  assert.match(feedingModalWxml, /class="goal-calorie-control"/);
  assert.match(feedingModalWxml, /class="nutrient-row-text"/);
  assert.match(feedingModalWxml, /placeholder-class="notes-input-placeholder"/);
  assert.match(feedingModalWxss, /\.goal-coef-control\s*\{/);
  assert.match(feedingModalWxss, /\.goal-calorie-control\s*\{/);
  assert.match(feedingModalWxss, /\.nutrient-row-text\s*\{/);
  assert.match(feedingModalWxss, /\.notes-input-placeholder\s*\{/);
  assert.doesNotMatch(feedingModalWxss, /\.[\w-]+\s+(input|text|view|button|textarea|picker|image|scroll-view)\b/);
  assert.doesNotMatch(feedingModalWxss, /::placeholder/);
});

test('data records food catalog setData uses slim items without duplicated category buckets', () => {
  const pageJs = fs.readFileSync('miniprogram/pages/data-records-v2/index.js', 'utf8');

  assert.match(pageJs, /buildSlimFoodCatalogItem\(food = \{\}\)/);
  assert.match(pageJs, /const slimFoods = combinedFoods\.map\(food => this\.buildSlimFoodCatalogItem\(food\)\)/);
  assert.match(pageJs, /this\._foodCatalog = slimFoods/);
  assert.match(pageJs, /this\._foodCatalogById = new Map\(slimFoods\.map\(food => \[food\._id, food\]\)\)/);
  assert.match(pageJs, /getFoodCatalog\(\)/);
  assert.match(pageJs, /foodCatalog: \[\]/);
  assert.doesNotMatch(pageJs, /foodCatalog: slimFoods/);
  assert.doesNotMatch(pageJs, /foodCatalog: combinedFoods/);
  assert.doesNotMatch(pageJs, /categorizedFoods,\s*\n\s*foodCategories/);
  assert.doesNotMatch(pageJs, /categorizedFoods\[[^\]]+\]\.push\(food\)/);
});

test('data records loads medications through MedicationModel instead of direct db query', () => {
  const pageJs = fs.readFileSync('miniprogram/pages/data-records-v2/index.js', 'utf8');
  const loadMedicationsBlock = pageJs.match(/async loadMedications\(\) \{[\s\S]*?\n  \},\n\n  \/\/ 选择药物处理/)[0];

  assert.match(pageJs, /const MedicationModel = require\('\.\.\/\.\.\/models\/medication'\)/);
  assert.match(loadMedicationsBlock, /MedicationModel\.getMedications\(\)/);
  assert.doesNotMatch(loadMedicationsBlock, /db\.collection\('medications'\)\.where/);
});

test('data records lazy-loads food and medication catalogs only when opening related modals', () => {
  const pageJs = fs.readFileSync('miniprogram/pages/data-records-v2/index.js', 'utf8');
  const initializeBlock = pageJs.match(/async initializePage\(formattedDate\) \{[\s\S]*?\n  \},\n\n  onShow:/)[0];
  const onShowBlock = pageJs.match(/onShow: async function\(\) \{[\s\S]*?\n  \},\n\n  onShareAppMessage/)[0];
  const foodModalBlock = pageJs.match(/(?:async\s+)?showFoodIntakeModal\(options = \{\}\) \{[\s\S]*?\n  \},\n\n  hideFoodIntakeModal/)[0];
  const foodExperimentBlock = pageJs.match(/(?:async\s+)?showFoodIntakeExperimentModal\(\) \{[\s\S]*?\n  \},\n\n  navigateToMealEditor/)[0];
  const editFoodBlock = pageJs.match(/(?:async\s+)?openEditFoodModal\(e\) \{[\s\S]*?\n  \},\n\n  \/\/ 迁移\/回滚辅助/)[0];
  const medicationModalBlock = pageJs.match(/(?:async\s+)?showAddMedicationModal\(\) \{[\s\S]*?\n  \},\n\n  goToMedicationManage/)[0];

  assert.doesNotMatch(initializeBlock, /this\.loadMedications\(\)/);
  assert.doesNotMatch(initializeBlock, /this\.loadFoodCatalog\(\)/);
  assert.doesNotMatch(onShowBlock, /this\.loadMedications\(\)/);
  assert.doesNotMatch(onShowBlock, /this\.loadFoodCatalog\(\)/);

  assert.match(foodModalBlock, /async\s+showFoodIntakeModal/);
  assert.match(foodModalBlock, /await this\.loadFoodCatalog\(\)/);
  assert.match(foodExperimentBlock, /async\s+showFoodIntakeExperimentModal/);
  assert.match(foodExperimentBlock, /await this\.loadFoodCatalog\(\)/);
  assert.match(editFoodBlock, /async\s+openEditFoodModal/);
  assert.match(editFoodBlock, /await this\.loadFoodCatalog\(\)/);
  assert.match(medicationModalBlock, /async\s+showAddMedicationModal/);
  assert.match(medicationModalBlock, /await this\.loadMedications\(\)/);
});
