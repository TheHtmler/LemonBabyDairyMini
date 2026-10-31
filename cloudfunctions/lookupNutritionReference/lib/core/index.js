'use strict';

// 微信懒加载需要顶层静态引用，不能把 require 放进导出对象的展开表达式。
const contracts = require('./contracts');
// 预览包需在公共入口显式加载证据校验，避免仅作为 normalize 的间接依赖时未注册。
const evidenceValidation = require('./evidenceValidation');
const normalize = require('./normalize');
const reference = require('./reference');
const selection = require('./selection');
const estimate = require('./estimate');
const classification = require('./classification');
const identitySafety = require('./identitySafety');

module.exports = { ...contracts, ...evidenceValidation, ...normalize, ...reference, ...selection, ...estimate, ...classification, ...identitySafety };
