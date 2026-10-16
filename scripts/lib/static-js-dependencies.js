'use strict';

const { parse } = require('acorn');

// 使用语法树区分真实引用与注释、字符串；动态路径不能被当作检查通过。
function staticJsDependencies(source) {
  const options = { ecmaVersion: 'latest', locations: true, allowReturnOutsideFunction: true };
  let tree;
  try { tree = parse(source, { ...options, sourceType: 'script' }); }
  catch (error) {
    if (!/sourceType: module/.test(error.message)) throw error;
    tree = parse(source, { ...options, sourceType: 'module' });
  }
  const dependencies = [];
  const pending = [tree];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node.type !== 'string') continue;
    const isRequire = node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require';
    const isAsyncRequire = node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.name === 'require';
    if (isAsyncRequire || node.type === 'ImportExpression') {
      throw new Error('第 ' + node.loc.start.line + ' 行：异步模块引用需单独校验，本检查器不将其视为通过');
    }
    if (isRequire) {
      const argument = node.arguments[0];
      if (node.arguments.length !== 1 || argument?.type !== 'Literal' || typeof argument.value !== 'string') {
        throw new Error('第 ' + node.loc.start.line + ' 行：require 必须使用明确的字符串路径，不能动态拼接');
      }
      dependencies.push({ specifier: argument.value, line: node.loc.start.line });
    } else if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) {
      dependencies.push({ specifier: node.source.value, line: node.loc.start.line });
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) pending.push(...value.filter(item => item && typeof item.type === 'string'));
      else if (value && typeof value.type === 'string') pending.push(value);
    }
  }
  return dependencies;
}

module.exports = { staticJsDependencies };
