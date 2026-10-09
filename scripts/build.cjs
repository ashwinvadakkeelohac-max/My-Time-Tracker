const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(path.join(root, 'index.html'), path.join(output, 'index.html'));
fs.mkdirSync(path.join(output,'vendor'),{recursive:true});
for (const filename of ['xlsx.full.min.js','SheetJS-LICENSE.txt']) fs.copyFileSync(path.join(root,'vendor',filename),path.join(output,'vendor',filename));
console.log('Built public/index.html. Google Sheets credentials remain server-side.');
