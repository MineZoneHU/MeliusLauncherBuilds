const fs = require('fs');
const path = require('path');

if(fs.existsSync(path.resolve(__dirname, '../', 'build/'))) fs.rmSync(path.resolve(__dirname, '../', 'build/'), { recursive: true, force: true });