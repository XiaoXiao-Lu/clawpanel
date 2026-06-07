const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = 'E:/Code/codex/ChatCraw/src';
const REPORT_PATH = 'E:/Code/codex/ChatCraw/unused-css-report.md';

const EXCLUDE_DIRS = ['node_modules', 'dist', 'src-tauri/target', '.git', 'locales'];

function walk(dir, exts) {
  let results = [];
  for (const file of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (EXCLUDE_DIRS.some(x => fullPath.includes(x))) continue;
      results = results.concat(walk(fullPath, exts));
    } else if (stat.isFile() && exts.some(e => file.endsWith(e))) {
      results.push(fullPath);
    }
  }
  return results;
}

const cssFiles = walk(PROJECT_ROOT, ['.css']);
console.log('Found ' + cssFiles.length + ' CSS files');

const jsFiles = walk(PROJECT_ROOT, ['.js', '.html', '.htm']);
console.log('Found ' + jsFiles.length + ' JS/HTML files');

const cssClasses = new Map();
const cssClassRegex = /\.([a-zA-Z_\-][a-zA-Z0-9_\-]*)/g;

const pseudoClasses = new Set(['hover','focus','active','disabled','checked','selected','first-child','last-child','nth-child','not','is','where','has','before','after','placeholder','root','empty','even','odd','valid','invalid','required','optional','read-only','read-write','in-range','out-of-range','indeterminate','default','enabled','visited','link','target','lang','dir','scope','host','host-context','slotted','part','defined','fullscreen','picture-in-picture','autofill','webkit-scrollbar','webkit-scrollbar-thumb','webkit-scrollbar-track','moz-focus-inner','ms-clear','selection','cue','backdrop','marker','placeholder-shown','focus-visible','focus-within','any-link','local-link','target-within','playing','paused','current','past','future','blank','user-invalid','nth-last-child','nth-of-type','nth-last-of-type','first-of-type','last-of-type','only-child','only-of-type']);

// File extensions that should never be treated as CSS classes
const fileExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'css', 'js', 'html', 'htm', 'json', 'xml', 'woff', 'woff2', 'ttf', 'eot', 'ico', 'webp', 'mp3', 'mp4', 'webm', 'pdf', 'doc', 'docx']);

// Single-word generic classes that are commonly used as modifiers
const genericModifiers = new Set(['active', 'disabled', 'selected', 'checked', 'open', 'closed', 'visible', 'hidden', 'loading', 'error', 'success', 'warning', 'info', 'primary', 'secondary', 'tertiary', 'small', 'medium', 'large', 'xl', 'sm', 'md', 'lg', 'pinned', 'waiting', 'streaming', 'denied', 'missing', 'exists', 'on', 'off', 'accent', 'inactive', 'user', 'assistant', 'raw', 'debug']);

for (const cssFile of cssFiles) {
  const content = fs.readFileSync(cssFile, 'utf-8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('/*') || line.trim().startsWith('*')) continue;
    let match;
    while ((match = cssClassRegex.exec(line)) !== null) {
      const className = match[1];
      if (pseudoClasses.has(className)) continue;
      if (fileExtensions.has(className.toLowerCase())) continue;
      if (!cssClasses.has(className)) {
        cssClasses.set(className, []);
      }
      cssClasses.get(className).push({
        file: cssFile,
        line: i + 1,
        context: line.trim()
      });
    }
  }
}

console.log('Extracted ' + cssClasses.size + ' unique CSS class definitions');

const referencedClasses = new Set();
const dynamicPatterns = new Set();

for (const jsFile of jsFiles) {
  const content = fs.readFileSync(jsFile, 'utf-8');
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    const classAttrRegex = /class\s*=\s*["\']([^"\']+)["\']/g;
    let match;
    while ((match = classAttrRegex.exec(line)) !== null) {
      const classes = match[1].split(/\s+/).filter(Boolean);
      for (const cls of classes) {
        if (!cls.includes('${') && !cls.includes('}')) {
          referencedClasses.add(cls);
        }
      }
    }
    
    const classNameRegex = /className\s*[:=]\s*["\']([^"\']+)["\']/g;
    while ((match = classNameRegex.exec(line)) !== null) {
      const classes = match[1].split(/\s+/).filter(Boolean);
      for (const cls of classes) {
        if (!cls.includes('${') && !cls.includes('}')) {
          referencedClasses.add(cls);
        }
      }
    }
    
    const classListAddRegex = /classList\.add\s*\(([^)]+)\)/g;
    while ((match = classListAddRegex.exec(line)) !== null) {
      const args = match[1];
      const stringMatches = args.match(/["\']([^"\']+)["\']/g);
      if (stringMatches) {
        for (const sm of stringMatches) {
          const cls = sm.replace(/["\']/g, '');
          referencedClasses.add(cls);
        }
      }
    }
    
    const classListRemoveRegex = /classList\.remove\s*\(([^)]+)\)/g;
    while ((match = classListRemoveRegex.exec(line)) !== null) {
      const args = match[1];
      const stringMatches = args.match(/["\']([^"\']+)["\']/g);
      if (stringMatches) {
        for (const sm of stringMatches) {
          const cls = sm.replace(/["\']/g, '');
          referencedClasses.add(cls);
        }
      }
    }
    
    const classListToggleRegex = /classList\.toggle\s*\(([^)]+)\)/g;
    while ((match = classListToggleRegex.exec(line)) !== null) {
      const args = match[1];
      const stringMatches = args.match(/["\']([^"\']+)["\']/g);
      if (stringMatches) {
        for (const sm of stringMatches) {
          const cls = sm.replace(/["\']/g, '');
          referencedClasses.add(cls);
        }
      }
    }
    
    const containsRegex = /contains\s*\(\s*["\']([^"\']+)["\']\s*\)/g;
    while ((match = containsRegex.exec(line)) !== null) {
      referencedClasses.add(match[1]);
    }
    
    const templateClassRegex = /class\s*=\s*\`([^\`]+)\`/g;
    while ((match = templateClassRegex.exec(line)) !== null) {
      const templateContent = match[1];
      const staticParts = templateContent.split(/\$\{[^}]+\}/);
      for (const part of staticParts) {
        const classes = part.split(/\s+/).filter(Boolean);
        for (const cls of classes) {
          if (cls.match(/^[a-zA-Z0-9_-]+$/)) {
            referencedClasses.add(cls);
          }
        }
      }
    }
    
    const stringLiteralRegex = /["\']([a-zA-Z][a-zA-Z0-9_-]{2,})["\']/g;
    while ((match = stringLiteralRegex.exec(line)) !== null) {
      const potentialClass = match[1];
      if (potentialClass.includes('-') || potentialClass.includes('_')) {
        referencedClasses.add(potentialClass);
      }
    }
  }
  
  const fullContent = content;
  const dynamicRegex = /\$\{([^}]+)\}--\$\{([^}]+)\}/g;
  let dynMatch;
  while ((dynMatch = dynamicRegex.exec(fullContent)) !== null) {
    dynamicPatterns.add(dynMatch[0]);
  }
}

console.log('Found ' + referencedClasses.size + ' referenced classes');
console.log('Found ' + dynamicPatterns.size + ' dynamic class patterns');

const unusedClasses = [];
const dynamicPrefixSuffix = new Set();

for (const pattern of dynamicPatterns) {
  const parts = pattern.split('--');
  if (parts.length === 2) {
    const base = parts[0].replace(/\$\{|\}/g, '').trim();
    const variant = parts[1].replace(/\$\{|\}/g, '').trim();
    dynamicPrefixSuffix.add(base);
    dynamicPrefixSuffix.add(variant);
  }
}

for (const [className, locations] of cssClasses) {
  if (referencedClasses.has(className)) continue;
  
  // Skip generic single-word modifiers if they appear as compound selectors
  // but only if there's a parent/base class that IS referenced
  if (genericModifiers.has(className)) {
    // Check if this modifier is used with any referenced base class
    const isUsedAsModifier = Array.from(referencedClasses).some(ref => {
      return ref.includes(className) && ref !== className;
    });
    if (isUsedAsModifier) continue;
    
    // Also check if any CSS rule uses this as a modifier on a referenced base
    const baseClasses = locations.map(loc => {
      const ctx = loc.context;
      const match = ctx.match(new RegExp('\\.([a-zA-Z0-9_-]+)\\.' + className + '\\b'));
      return match ? match[1] : null;
    }).filter(Boolean);
    
    if (baseClasses.some(bc => referencedClasses.has(bc))) continue;
  }
  
  if (className.includes('--')) {
    const base = className.split('--')[0];
    if (referencedClasses.has(base) || dynamicPrefixSuffix.has(base)) {
      continue;
    }
  }
  
  if (className.includes('__')) {
    const base = className.split('__')[0];
    if (referencedClasses.has(base)) continue;
  }
  
  if (className.match(/^(is-|has-|show-|hide-|active-|open-|closed-|visible-|hidden-|disabled-|enabled-|loading-|error-|success-|warning-|info-|primary-|secondary-|tertiary-|small-|medium-|large-|xl-|sm-|md-|lg-)/)) {
    const prefix = className.split('-')[0];
    if (referencedClasses.has(prefix) || Array.from(referencedClasses).some(r => r.startsWith(prefix + '-'))) {
      continue;
    }
  }
  
  unusedClasses.push({ className, locations });
}

let report = '# ClawPanel 未使用 CSS 类分析报告\n\n';
report += '生成时间: ' + new Date().toLocaleString() + '\n\n';
report += '## 统计摘要\n\n';
report += '- CSS 文件数量: ' + cssFiles.length + '\n';
report += '- JS/HTML 文件数量: ' + jsFiles.length + '\n';
report += '- CSS 中定义的唯一类名: ' + cssClasses.size + '\n';
report += '- JS/HTML 中引用的类名: ' + referencedClasses.size + '\n';
report += '- 疑似未使用的类名: ' + unusedClasses.length + '\n\n';

report += '## 分析说明\n\n';
report += '> **注意**: 本报告通过静态分析生成，可能存在误报。以下情况类名虽被标记为\"未使用\"，但可能仍在运行时被动态使用：\n';
report += '> 1. 由 Tauri/Rust 后端动态生成的类名\n';
report += '> 2. 通过模板字符串动态拼接的类名（如 `${base}--${variant}`）\n';
report += '> 3. 通过 JavaScript 动态计算后赋值的类名\n';
report += '> 4. 作为 BEM 修饰符（modifier）或元素（element）与基础类配合使用\n';
report += '> 5. 第三方库或框架注入的类名\n\n';
report += '**建议在删除前，手动确认每个类名的实际使用情况！**\n\n';

if (dynamicPatterns.size > 0) {
  report += '## 检测到的动态类名模式\n\n';
  report += '以下模式表明存在运行时动态拼接的类名，相关类名已排除：\n\n';
  for (const pattern of dynamicPatterns) {
    report += '- `' + pattern + '`\n';
  }
  report += '\n';
}

report += '## 疑似未使用的 CSS 类 (' + unusedClasses.length + ' 个)\n\n';

const byFile = new Map();
for (const item of unusedClasses) {
  for (const loc of item.locations) {
    if (!byFile.has(loc.file)) {
      byFile.set(loc.file, []);
    }
    byFile.get(loc.file).push({
      className: item.className,
      line: loc.line,
      context: loc.context
    });
  }
}

for (const [file, classes] of byFile) {
  const relativeFile = path.relative('E:/Code/codex/ChatCraw', file);
  report += '### ' + relativeFile + '\n\n';
  report += '| 类名 | 行号 | 上下文 |\n';
  report += '|------|------|--------|\n';
  
  const seen = new Set();
  for (const cls of classes) {
    const key = cls.className + ':' + cls.line;
    if (seen.has(key)) continue;
    seen.add(key);
    const shortContext = cls.context.length > 60 ? cls.context.substring(0, 60) + '...' : cls.context;
    report += '| `.' + cls.className + '` | ' + cls.line + ' | `' + shortContext.replace(/`/g, "'") + '` |\n';
  }
  report += '\n';
}

report += '## 所有被引用的类名（用于交叉验证）\n\n';
report += '<details>\n<summary>点击展开 (' + referencedClasses.size + ' 个)</summary>\n\n';
const sortedRefs = Array.from(referencedClasses).sort();
for (let i = 0; i < sortedRefs.length; i += 5) {
  report += sortedRefs.slice(i, i + 5).map(c => '`' + c + '`').join(', ');
  report += '\n';
}
report += '\n</details>\n\n';

report += '---\n\n';
report += '*报告由自动化脚本生成，仅供参考。删除 CSS 前请务必在浏览器开发者工具中验证。*\n';

fs.writeFileSync(REPORT_PATH, report, 'utf-8');
console.log('\nReport saved to: ' + REPORT_PATH);
console.log('Total unused classes found: ' + unusedClasses.length);
