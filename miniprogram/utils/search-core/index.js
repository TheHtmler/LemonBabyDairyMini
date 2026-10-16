'use strict';
const contracts = require('./contracts');
const period = require('./period');
const nutrition = require('./nutrition');
const match = require('./match');
const language = require('./language');
const answerFields = require('./answerFields');
module.exports = { ...contracts, ...period, ...nutrition, ...match, ...language, ...answerFields, ...require('./capabilities'), ...require('./intentV2'), ...require('./dailyMetrics'), ...require('./queryText') };
