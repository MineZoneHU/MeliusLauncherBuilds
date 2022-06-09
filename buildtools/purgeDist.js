const fs = require('fs');
const path = require('path');

if(fs.existsSync(path.resolve(__dirname, 'dist'))) fs.rmSync(path.resolve(__dirname, 'dist'), { recursive: true, force: true });
if(fs.existsSync(path.resolve(__dirname, 'build/', 'tsconfig.tsbuildinfo'))) fs.rmSync(path.resolve(__dirname, 'build/', 'tsconfig.tsbuildinfo'), { recursive: true, force: true });