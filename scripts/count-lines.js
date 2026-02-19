/**
 * 项目代码统计脚本
 * 区分源代码和配置文件
 */

import fs from 'fs';
import path from 'path';

function countLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

function walkDir(dir, excludeDirs = ['node_modules', '.next', 'target', 'dist', 'build', '.git', 'out'], callback) {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!excludeDirs.includes(entry.name)) {
        walkDir(fullPath, excludeDirs, callback);
      }
    } else {
      callback(fullPath);
    }
  }
}

function getFiles(dir, pattern, excludeDirs = ['node_modules', '.next', 'target', 'dist', 'build', '.git', 'out']) {
  const files = [];
  const regex = new RegExp(pattern.replace('*', '.*'));

  walkDir(dir, excludeDirs, (file) => {
    if (regex.test(path.basename(file))) {
      files.push(file);
    }
  });

  return files;
}

function countFilesLines(files) {
  let total = 0;
  for (const file of files) {
    total += countLines(file);
  }
  return total;
}

// 源代码统计
const codeStats = {
  '*.ts': { name: 'TypeScript', count: 0 },
  '*.tsx': { name: 'TSX', count: 0 },
  '*.js': { name: 'JavaScript', count: 0 },
  '*.jsx': { name: 'JSX', count: 0 },
  '*.rs': { name: 'Rust', count: 0 },
  '*.css': { name: 'CSS', count: 0 },
  '*.scss': { name: 'SCSS', count: 0 },
};

const srcDirs = ['src-next', 'src-tauri/src'];

console.log('==========================================');
console.log('         项目代码统计');
console.log('==========================================');
console.log('');

console.log('📁 源代码统计 (src-next, src-tauri/src)');
console.log('------------------------------------------');

let totalCode = 0;

for (const [pattern, info] of Object.entries(codeStats)) {
  let files = [];
  for (const dir of srcDirs) {
    files = files.concat(getFiles(dir, pattern));
  }
  const count = countFilesLines(files);
  if (count > 0) {
    console.log(`  ${info.name.padEnd(15)} ${pattern}: ${String(count).padStart(5)} 行`);
    totalCode += count;
  }
}

console.log('');
console.log('📄 配置文件统计');
console.log('------------------------------------------');

const configFiles = [
  'package.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'next.config.ts',
  'tailwind.config.ts',
  'postcss.config.js',
  'rustfmt.toml',
  '.editorconfig',
  'src-tauri/Cargo.toml',
  'src-tauri/tauri.conf.json',
];

let totalConfig = 0;

for (const file of configFiles) {
  if (fs.existsSync(file)) {
    const count = countLines(file);
    console.log(`  ${file.padEnd(30)}: ${String(count).padStart(5)} 行`);
    totalConfig += count;
  }
}

console.log('');
console.log('==========================================');
console.log(`  源代码总计:  ${String(totalCode).padStart(5)} 行`);
console.log(`  配置文件总计: ${String(totalConfig).padStart(5)} 行`);
console.log('==========================================');
console.log(`  总计:        ${String(totalCode + totalConfig).padStart(5)} 行`);
console.log('');
