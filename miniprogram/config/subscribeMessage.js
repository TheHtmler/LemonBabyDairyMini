// 在微信公众平台「订阅消息」中选择/申请模板后，把模板 ID 填到这里。
// 不要在小程序代码里放服务端密钥；发送订阅消息统一走云函数。
const FEEDING_REMINDER_TEMPLATE_ID = 'AYPTQ_RSsUtfzFrfXlDOdqzu7Sum2CA6u6prA41NBc8';

const SUBSCRIBE_MESSAGE_TEMPLATE_IDS = {
  feedingReminder: FEEDING_REMINDER_TEMPLATE_ID
};

module.exports = {
  FEEDING_REMINDER_TEMPLATE_ID,
  SUBSCRIBE_MESSAGE_TEMPLATE_IDS
};
