const fs = require('fs');
const path = require('path');
const JSO = require('javascript-obfuscator');

/**
 * @param {string} dirPath 
 * @returns {string[]}
 */
const collectFiles = (dirPath) => {
	if(!fs.existsSync(dirPath)) return [];
	let collectedFiles = [];
	let files = fs.readdirSync(dirPath).map(file => path.resolve(dirPath, file));
	for(let file of files) {
		if(fs.statSync(file).isDirectory()) collectedFiles.push(...collectFiles(file));
		else collectedFiles.push(file);
	}
	return collectedFiles;
};

const options = {
	deadCodeInjection: true,
	deadCodeInjectionThreshold: 0.75,
	seed: 0x13371337,
	stringArray: true,
	stringArrayEncoding: [
		'base64'
	]
};

const ignoredFiles = collectFiles(path.resolve(__dirname, '../', 'build/', 'node_modules/'));

collectFiles(path.resolve(__dirname, '../', 'build/')).filter(file => file.endsWith('.js') && !ignoredFiles.includes(file)).forEach(file => {
	console.log(`Obfuscating ${file}`);
	let result = JSO.obfuscate(fs.readFileSync(file).toString(), options);
	fs.writeFileSync(file, result.getObfuscatedCode());
});