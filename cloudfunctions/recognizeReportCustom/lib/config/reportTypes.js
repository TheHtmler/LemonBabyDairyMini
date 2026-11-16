const REPORT_ENTRY_TYPES = [
  { key: 'blood_ms', name: '血串联质谱', icon: '🩸' },
  { key: 'urine_ms', name: '尿串联质谱', icon: '🧪' },
  { key: 'blood_gas', name: '血气分析', icon: '💨' },
  { key: 'blood_cbc', name: '血常规', icon: '🩺' },
  { key: 'blood_cbc_crp', name: '血五分类CRP', icon: '🔬' },
  { key: 'blood_biochem', name: '大生化', icon: '🧬' },
  { key: 'blood_ammonia', name: '血氨检测', icon: '⚡' }
];

// 大生化当前仅支持手动录入，拍照入口与填写页共用同一份支持列表。
const REPORT_OCR_TYPES = REPORT_ENTRY_TYPES.filter(type => type.key !== 'blood_biochem');
const REPORT_MAX_PHOTOS = 6;
const REPORT_MAX_IMAGE_BYTES = 6 * 1024 * 1024;
// 前后端交付与幂等缓存共用版本，旧结果不能绕过原行证据校验。
const REPORT_RECOGNITION_VERSION = 'report-evidence-v2-generic';
// 内部转录协议单独版本化，不要求前端为每次原行格式调整更换交付协议。
const REPORT_OCR_PIPELINE_VERSION = 'qwen-report-v17-segmented-source';
// 前端、模型调用、云函数与请求有效期统一预算，给结果落库和清理预留时间。
const REPORT_OCR_TIMING = Object.freeze({
  modelMs: 90000,
  functionMs: 120000,
  clientMs: 130000,
  leaseMs: 150000,
  finalizeMs: 15000
});

module.exports = {
  REPORT_ENTRY_TYPES,
  REPORT_OCR_TYPES,
  REPORT_MAX_PHOTOS,
  REPORT_MAX_IMAGE_BYTES,
  REPORT_RECOGNITION_VERSION,
  REPORT_OCR_PIPELINE_VERSION,
  REPORT_OCR_TIMING
};
