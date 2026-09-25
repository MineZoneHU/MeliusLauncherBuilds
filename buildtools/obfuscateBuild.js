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
	target: 'node',
	compact: true,
	controlFlowFlattening: true,
	controlFlowFlatteningThreshold: 0.8,
	deadCodeInjection: true,
	deadCodeInjectionThreshold: 0.4,
	identifierNamesGenerator: 'hexadecimal',
	numbersToExpressions: true,
	renameGlobals: false,
	selfDefending: false,
	simplify: true,
	splitStrings: true,
	splitStringsChunkLength: 6,
	stringArray: true,
	stringArrayCallsTransform: true,
	stringArrayCallsTransformThreshold: 0.8,
	stringArrayEncoding: ['rc4', 'base64'],
	stringArrayIndexShift: true,
	stringArrayRotate: true,
	stringArrayShuffle: true,
	stringArrayWrappersCount: 2,
	stringArrayWrappersChainedCalls: true,
	stringArrayWrappersParametersMaxCount: 4,
	stringArrayWrappersType: 'function',
	stringArrayThreshold: 0.85,
	transformObjectKeys: true,
	unicodeEscapeSequence: false
};

const ignoredFiles = collectFiles(path.resolve(__dirname, '../', 'build/', 'node_modules/'));

collectFiles(path.resolve(__dirname, '../', 'build/')).filter(file => file.endsWith('.js') && !ignoredFiles.includes(file)).forEach(file => {
	console.log(`Obfuscating ${file}`);
	let result = JSO.obfuscate(fs.readFileSync(file).toString(), options);
	fs.writeFileSync(file, result.getObfuscatedCode());
});