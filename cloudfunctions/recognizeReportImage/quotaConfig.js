/**
 * 报告 OCR 应用层限额（守住微信 printedText 约 100 次/天的 AppID 共享额度）。
 *
 * 业务背景：化验报告通常 10 天～3 个月才上传一次；单次录入可能重拍 2～5 张。
 * 设计原则：
 * - globalDaily：全站日上限，预留缓冲，避免开发调试或其它入口耗尽微信额度
 * - perBabyUidDaily：单宝宝日上限，允许当天重拍纠错
 * - perBabyUidMonthly：单宝宝月上限，防止异常刷接口，正常录入远用不完
 * - perOpenidDaily：单操作者日上限，防止单人误操作或滥用
 *
 * 可在云开发 app_config 写入 { key: 'report_ocr_quota', value: { ... } } 热更新。
 * 各数值字段为 0 表示该维度不限制；enabled 为 false 时关闭应用层限额。
 */
// 开发阶段：关闭应用层限额；微信 printedText 仍约 100 次/天（全 AppID 共享，代码无法放开）
module.exports = {
  enabled: false,
  globalDaily: 0,
  perBabyUidDaily: 100,
  perBabyUidMonthly: 500,
  perOpenidDaily: 0,
  timezoneOffsetHours: 8
};
