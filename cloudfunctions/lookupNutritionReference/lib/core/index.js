'use strict';

// 微信懒加载需要顶层静态引用，不能把 require 放进导出对象的展开表达式。
const contracts = require('./contracts');
const normalize = require('./normalize');
const reference = require('./reference');
const selection = require('./selection');
const estimate = require('./estimate');
const classification = require('./classification');

module.exports = { ...contracts, ...normalize, ...reference, ...selection, ...estimate, ...classification };
