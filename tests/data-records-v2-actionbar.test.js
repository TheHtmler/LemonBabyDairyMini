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
