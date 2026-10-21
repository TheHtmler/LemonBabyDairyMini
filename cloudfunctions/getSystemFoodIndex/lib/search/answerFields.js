'use strict';

function configuredFrequency(doc) {
  const days = Number(doc.frequencyDays); const times = Number(doc.frequencyTimes);
  if (Number.isInteger(days) && days > 0 && Number.isInteger(times) && times > 0) return (days === 1 ? '每日 ' : '每 ' + days + ' 天 ') + times + ' 次';
  return String(doc.frequency || '').trim();
}

module.exports = { configuredFrequency };
