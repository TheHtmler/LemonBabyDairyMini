'use strict';

// 查询能力以可执行字段定义，名称和简称由资料匹配，不在问句中枚举药名。
const ANSWER_FIELDS = {
  frequency: { label: '已设置频率', scopes: ['medication'], aliases: ['摄入频率', '服用频率', '用药频率', '服药频率', '服用频次', '用药频次', '服药频次', '频率', '频次', '隔多久吃一次', '多久吃一次', '多久服用一次', '几天吃一次', '一天吃几次', '每天吃几次', '一天几次', '每天几次'] },
  dosage: { label: '已设置单次剂量', scopes: ['medication'], aliases: ['单次剂量', '每次用量', '每次剂量', '一次用量', '剂量', '用量', '每次吃多少', '一次吃多少', '每次喝多少'] },
  concentration: { label: '已设置浓度', scopes: ['medication'], aliases: ['浓度'] },
  notes: { label: '备注', scopes: ['medication'], aliases: ['备注'] },
  intakeCount: { label: '已记录服用次数', scopes: ['medication'], history: true, aliases: ['服用次数', '服药次数', '用药次数', '吃了几次', '吃过几次', '服用了几次', '喝了几次', '吃了多少次', '一共吃了几次', '总共吃了几次'] },
  lastIntake: { label: '最近一次服用记录', scopes: ['medication'], history: true, aliases: ['最近一次服用', '上次服用时间', '上次吃药时间', '最后一次服用', '上次什么时候吃的', '上次什么时候吃', '上次吃的时间'] },
  ingredients: { label: '配料', scopes: ['recipe'], aliases: ['配料', '食材', '原料'] },
  calories: { label: '能量', scopes: ['food', 'powder'], aliases: ['能量', '热量'] },
  protein: { label: '蛋白质', scopes: ['food', 'powder'], aliases: ['蛋白质', '蛋白'] },
  fat: { label: '脂肪', scopes: ['food', 'powder'], aliases: ['脂肪'] },
  carbs: { label: '碳水', scopes: ['food', 'powder'], aliases: ['碳水化合物', '碳水'] },
  fiber: { label: '膳食纤维', scopes: ['food', 'powder'], aliases: ['膳食纤维', '纤维'] },
  sodium: { label: '钠', scopes: ['food', 'powder'], aliases: ['钠'] }
};

function configuredFrequency(doc) {
  const days = Number(doc.frequencyDays); const times = Number(doc.frequencyTimes);
  if (Number.isInteger(days) && days > 0 && Number.isInteger(times) && times > 0) return (days === 1 ? '每日 ' : '每 ' + days + ' 天 ') + times + ' 次';
  return String(doc.frequency || '').trim();
}

module.exports = { ANSWER_FIELDS, configuredFrequency };
