const fs = require('fs');
const path = require('path');

// Find all files recursively
function findFiles(dir, ext, files = []) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory() && !item.includes('node_modules') && !item.includes('.git')) {
      findFiles(fullPath, ext, files);
    } else if (item.endsWith(ext)) {
      files.push(fullPath);
    }
  }
  return files;
}

// Read all JS files to find class name patterns
const jsFiles = findFiles('src', '.js');
const allStrings = new Set();

jsFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  
  // Match all quoted strings that look like class names
  const regex = /['"]([a-zA-Z][a-zA-Z0-9_-]*(?:\s+[a-zA-Z][a-zA-Z0-9_-]*)*)['"]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    match[1].split(/\s+/).forEach(s => {
      if (s.length > 2) allStrings.add(s);
    });
  }
});

// Read all CSS classes
const cssFiles = findFiles('src', '.css');
const cssClasses = new Set();

cssFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const regex = /\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    cssClasses.add(match[1]);
  }
});

// Find truly unused
const trulyUnused = [];
cssClasses.forEach(cls => {
  if (!allStrings.has(cls)) {
    trulyUnused.push(cls);
  }
});

console.log('Total CSS classes:', cssClasses.size);
console.log('Truly unused:', trulyUnused.length);
console.log('\nFirst 50 truly unused:');
trulyUnused.slice(0, 50).forEach(c => console.log('  .' + c));
