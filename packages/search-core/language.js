'use strict';

function chineseNumber(text) {
  if (/^\d+$/.test(text)) return Number(text);
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100, 千: 1000 };
  let result = 0; let digit = 0;
  for (const char of text) {
    if (digits[char] !== undefined) digit = digits[char];
    else if (units[char]) { result += (digit || 1) * units[char]; digit = 0; }
    else return NaN;
  }
  return result + digit;
}

function parsePeriodPhrase(text) {
  const relative = text.match(/(?:最近|近|过去)(?:的)?([0-9零一二两三四五六七八九十百千]+)(?:个)?(星期|礼拜|周|天|日|月)(?:以内|内|以来|期间)?/);
  if (relative) {
    const count = chineseNumber(relative[1]);
    const days = count * ({ 星期: 7, 礼拜: 7, 周: 7, 天: 1, 日: 1, 月: 30 }[relative[2]]);
    if (days >= 1 && days <= 36600) return { period: { kind: 'last_n_days', days }, rest: text.replace(relative[0], ''), label: '近 ' + days + ' 天' };
  }
  const named = text.match(/今天|今日|昨天|昨日|上一周|上个星期|上周|这个星期|本周|这周|本月|这个月|全部历史/);
  if (!named) return null;
  return { period: { kind: { 今天: 'today', 今日: 'today', 昨天: 'yesterday', 昨日: 'yesterday', 上一周: 'previous_calendar_week', 上个星期: 'previous_calendar_week', 上周: 'previous_calendar_week', 这个星期: 'current_calendar_week', 本周: 'current_calendar_week', 这周: 'current_calendar_week', 本月: 'current_month', 这个月: 'current_month', 全部历史: 'all' }[named[0]] }, rest: text.replace(named[0], ''), label: named[0] };
}

module.exports = { chineseNumber, parsePeriodPhrase };
