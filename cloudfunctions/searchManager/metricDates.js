'use strict';
const { businessDate, shanghaiDate, shiftDate, validatePeriod, resolvePeriod, fail } = require('./lib/search');
const { active } = require('./access');

// 只定位实际饮食记录日期，不把汇总缓存的更新时间当作摄入日期，也不生成营养答案。
async function recentIntakeDates({ db, accessContext, period, now = Date.now(), latest = true }) {
  const effective = resolvePeriod(validatePeriod(period || { kind: 'all' }), now);
  const today = shanghaiDate(now);
  const end = effective.endDateExclusive && effective.endDateExclusive <= today ? effective.endDateExclusive : shiftDate(today, 1);
  const sources = [
    { collection: 'food_intake_records' }, { collection: 'feeding_records_v2' },
    { collection: 'feeding_records' }, { collection: 'feeding_records', dateObject: true }
  ];
  const dates = new Set();
  const limit = latest ? 1 : 7;
  const requested = latest ? 1 : limit + 1;
  await Promise.all(sources.map(async source => {
    let after; const found = new Set();
    for (let batch = 0; batch < 10; batch++) {
      const lower = effective.startDate || '1900-01-01';
      const asDate = value => source.dateObject ? new Date(value + 'T00:00:00+08:00') : value;
      const where = { babyUid: accessContext.babyUid, date: db.command.gte(asDate(lower)).and(db.command.lt(asDate(end))) };
      let condition = where;
      if (after) condition = db.command.and([where, db.command.or([{ date: db.command.lt(after.date) }, { date: after.date, _id: db.command.lt(after._id) }])]);
      let response;
      try { response = await db.collection(source.collection).where(condition).orderBy('date', 'desc').orderBy('_id', 'desc').limit(40).get(); }
      catch (error) {
        if (/COLLECTION_NOT_EXIST|DATABASE_COLLECTION_NOT_EXIST/.test(String(error.code))) return;
        throw error;
      }
      const rows = response.data || [];
      for (const row of rows) {
        if (!active(row)) continue;
        const date = businessDate(row.date);
        if (date && date <= today) { found.add(date); dates.add(date); }
        if (found.size >= requested) return;
      }
      if (rows.length < 40) return;
      after = rows[rows.length - 1];
    }
    fail('INVALID_QUERY', '历史记录较多，请指定日期范围后再查询系数');
  }));
  const sorted = [...dates].sort().reverse();
  const pageDates = sorted.slice(0, limit);
  const nextEnd = pageDates[pageDates.length - 1];
  const nextStart = effective.startDate || '1900-01-01';
  const nextPeriod = !latest && sorted.length > limit && nextStart < nextEnd
    ? { kind: 'range', startDate: nextStart, endDateExclusive: nextEnd } : null;
  return { dates: pageDates, effectivePeriod: effective, latest, limit, nextPeriod };
}
module.exports = { recentIntakeDates };
