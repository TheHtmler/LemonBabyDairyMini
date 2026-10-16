'use strict';
const policy = require('./policy');
const usage = require('./usage');
module.exports = { ...policy, ...usage };
