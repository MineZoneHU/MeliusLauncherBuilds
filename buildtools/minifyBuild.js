const fs = require('fs');
const path = require('path');
const htmlMinifier = require('html-minifier');
const csso = require('csso');

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

const htmlOptions = {
	collapseWhitespace: true,
	removeAttributeQuotes: true,
	removeComments: true,
	removeRedundantAttributes: true,
	sortAttributes: true,
	sortClassName: true
};

const cssOptions = {

};

const ignoredFiles = collectFiles(path.resolve(__dirname, '../', 'build/', 'node_modules/'));

collectFiles(path.resolve(__dirname, '../', 'build/')).filter(file => (file.endsWith('.html') || file.endsWith('.css') || file.endsWith('.json')) && !ignoredFiles.includes(file)).forEach(file => {
	console.log(`Minifying ${file}`);
	if(file.endsWith('.html')) fs.writeFileSync(file, htmlMinifier.minify(fs.readFileSync(file).toString(), htmlOptions));
	else if(file.endsWith('.css')) fs.writeFileSync(file, csso.minify(fs.readFileSync(file).toString(), cssOptions).css);
	else if(file.endsWith('.json')) fs.writeFileSync(file, JSON.stringify(JSON.parse(fs.readFileSync(file).toString())));
});