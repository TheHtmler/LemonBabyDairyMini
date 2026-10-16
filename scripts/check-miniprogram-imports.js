'use strict';
const fs = require('fs');
const path = require('path');
const { staticJsDependencies } = require('./lib/static-js-dependencies');
const root = path.resolve(__dirname, '..');
const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const miniRoot = path.resolve(root, project.miniprogramRoot || '.');
const appFile = path.join(miniRoot, 'app.json');
const app = JSON.parse(fs.readFileSync(appFile, 'utf8'));
const packages = (app.subPackages || app.subpackages || []).map(item => ({
  ...item,
  directory: path.resolve(miniRoot, item.root)
}));
const entries = process.argv.slice(2);
const pending = entries.map(file => path.resolve(root, file));
const visited = new Set();
const failures = [];
const components = new Set();
let references = 0;
const relative = file => path.relative(root, file).split(path.sep).join('/');
const inDirectory = (file, directory) => file === directory || file.startsWith(directory + path.sep);
const packageOf = file => packages.find(item => inDirectory(file, item.directory));
const isFile = file => fs.existsSync(file) && fs.statSync(file).isFile();

function matchesPackRule(file, rule) {
  const name = path.relative(miniRoot, file).split(path.sep).join('/');
  const value = String(rule.value || '').replace(/^\.\//, '').replace(/\/$/, '');
  switch (rule.type) {
    case 'file': return name === value;
    case 'folder': return name === value || name.startsWith(value + '/');
    case 'suffix': return name.endsWith(value);
    case 'prefix': return name.startsWith(value);
    case 'regexp': return new RegExp(value).test(name);
    default: throw new Error('未识别的打包规则类型：' + rule.type);
  }
}

function validateFile(file, location) {
  if (!inDirectory(file, miniRoot)) {
    failures.push(location + '：引用超出小程序目录');
    return false;
  }
  if (!isFile(file)) {
    const directoryIndex = path.join(file.replace(/\.js$/, ''), 'index.js');
    failures.push(location + (isFile(directoryIndex) ? '：不能依赖目录自动查找 index.js，请显式引用文件' : '：目标文件不存在（' + relative(file) + '）'));
    return false;
  }
  // macOS 的默认文件系统不区分大小写，上传后仍必须保持路径大小写完全一致。
  let directory = miniRoot;
  for (const name of path.relative(miniRoot, file).split(path.sep)) {
    if (!fs.readdirSync(directory).includes(name)) {
      failures.push(location + '：文件路径大小写不一致（' + relative(file) + '）');
      return false;
    }
    directory = path.join(directory, name);
  }
  const options = project.packOptions || {};
  const ignored = (options.ignore || []).some(rule => matchesPackRule(file, rule));
  const included = (options.include || []).some(rule => matchesPackRule(file, rule));
  if (ignored && !included) {
    failures.push(location + '：依赖被 packOptions.ignore 排除（' + relative(file) + '）');
    return false;
  }
  return true;
}

function validateBoundary(from, to, location) {
  const sourcePackage = packageOf(from);
  const targetPackage = packageOf(to);
  if ((targetPackage && sourcePackage !== targetPackage) || (sourcePackage?.independent && sourcePackage !== targetPackage)) {
    failures.push(location + '：不能同步引用其他分包，独立分包也不能引用主包（' + relative(to) + '）');
  }
}

function resolveLocal(from, specifier) {
  return specifier.startsWith('/') ? path.join(miniRoot, specifier.slice(1)) : path.resolve(path.dirname(from), specifier);
}

function addReference(from, specifier, location, extension = '.js') {
  references++;
  let target = resolveLocal(from, specifier);
  if (!path.extname(target)) target += extension;
  validateBoundary(from, target, location);
  if (validateFile(target, location)) pending.push(target);
}

function addView(base, isComponent = false) {
  if (components.has(base)) return;
  components.add(base);
  const extensions = ['.js', '.wxml'];
  if (isComponent || isFile(base + '.json')) extensions.push('.json');
  for (const extension of extensions) {
    const file = base + extension;
    if (validateFile(file, relative(file))) pending.push(file);
  }
  if (isFile(base + '.wxss')) pending.push(base + '.wxss');
  if (isComponent && isFile(base + '.json')) {
    const config = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
    if (config.component !== true) failures.push(relative(base + '.json') + '：组件缺少 component: true');
  }
}

// 默认检查真实应用入口、所有分包页面和组件，不再只检查搜索页。
if (!entries.length) {
  pending.push(path.join(miniRoot, 'app.js'), appFile);
  if (isFile(path.join(miniRoot, 'app.wxss'))) pending.push(path.join(miniRoot, 'app.wxss'));
  (app.pages || []).forEach(page => addView(path.join(miniRoot, page)));
  packages.forEach(item => (item.pages || []).forEach(page => addView(path.join(item.directory, page))));
  if (app.tabBar?.custom) addView(path.join(miniRoot, 'custom-tab-bar/index'), true);
}

// 按小程序文件规则检查静态相对引用，刻意不使用 Node 的 require.resolve 目录回退。
while (pending.length) {
  const file = pending.pop();
  if (visited.has(file)) continue;
  visited.add(file);
  if (!validateFile(file, relative(file))) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) {
    const config = JSON.parse(source);
    const componentPaths = [...Object.values(config.usingComponents || {}), ...Object.values(config.componentGenerics || {}).map(item => item.default).filter(Boolean)];
    componentPaths.forEach(specifier => {
      if (specifier.startsWith('plugin://')) return;
      const target = resolveLocal(file, specifier);
      validateBoundary(file, target, relative(file) + ': ' + specifier);
      addView(target, true);
    });
    continue;
  }
  if (/\.(wxml|wxss|wxs)$/.test(file)) {
    const withoutComments = source.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, '');
    const resourcePattern = file.endsWith('.wxml') ? /<(?:import|include|wxs)\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/g : file.endsWith('.wxss') ? /@import\s+['"]([^'"]+)['"]/g : /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    for (const match of withoutComments.matchAll(resourcePattern)) addReference(file, match[1], relative(file) + ': ' + match[1], path.extname(file));
    continue;
  }
  if (!file.endsWith('.js')) continue;
  let dependencies;
  try { dependencies = staticJsDependencies(source); }
  catch (error) { failures.push(relative(file) + '：' + error.message); continue; }
  for (const { specifier, line } of dependencies) {
    const location = relative(file) + ':' + line + ': ' + specifier;
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
      failures.push(location + '：非相对引用需先构建 npm 并明确核对产物');
      continue;
    }
    addReference(file, specifier, location);
  }
}
if (failures.length) {
  failures.forEach(message => process.stderr.write(message + '\n'));
  process.exitCode = 1;
} else {
  process.stdout.write('小程序静态依赖检查通过：' + components.size + ' 个页面/组件，' + visited.size + ' 个文件，' + references + ' 处引用。\n');
  process.stdout.write('已检查入口、静态引用、分包边界、打包排除、大小写和 JS 语法；不替代微信编译器或真机验收。\n');
}
