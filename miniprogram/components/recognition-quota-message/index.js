const { MODEL_QUOTA_EXHAUSTED_MESSAGE } = require('../../utils/recognitionErrors');

const feedbackLabel = '发送反馈';
const feedbackIndex = MODEL_QUOTA_EXHAUSTED_MESSAGE.indexOf(feedbackLabel);

Component({
  data: {
    prefix: MODEL_QUOTA_EXHAUSTED_MESSAGE.slice(0, feedbackIndex),
    feedbackLabel,
    suffix: MODEL_QUOTA_EXHAUSTED_MESSAGE.slice(feedbackIndex + feedbackLabel.length)
  }
});
