'use strict';

const QUERY_VERB = '(?:查询|搜索|查找|查看|查一查|查查|看一看|看看|了解|知道|告诉我|查|看)';
const REQUEST_SUBJECT = new RegExp('^(?:(?:能不能|可不可以|是否可以|能否|可以|可否|能)(?:帮我|给我|为我)?|(?:我)?(?:想要|想)|帮我|给我|为我)(?=' + QUERY_VERB + ')');
const REQUEST_VERB = new RegExp('^' + QUERY_VERB + '(?:一下|下)?[,，:：]*');

// 仅去掉句首请求语和句尾语气词，保留日期、否定、比较、数值及单位。
// 供明确语法的降级解析共用；自然问句仍以原句交给模型理解。
function normalizeSearchRequest(input) {
  return String(input || '').normalize('NFKC').replace(/\s+/g, '')
    .replace(/^(?:请问|麻烦(?:你)?|劳驾|请)[,，:：]*/, '')
    .replace(REQUEST_SUBJECT, '').replace(REQUEST_VERB, '')
    .replace(/[?？。!！]+$/, '').replace(/[吗呢呀啊吧]$/, '');
}

module.exports = { normalizeSearchRequest };
