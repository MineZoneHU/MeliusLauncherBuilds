const fs = require('fs');
const path = require('path');

const copyFileSync = (source, target) => {
	if(fs.existsSync(target)) fs.rmSync(target, { recursive: true });
	fs.copyFileSync(source, target);
};

const copyFolderRecursivelySync = (source, target) => {
	if(fs.existsSync(target)) fs.rmSync(target, { recursive: true });
	fs.mkdirSync(target, { recursive: true });
	let files = fs.readdirSync(source);
	for(let file of files) {
		if(fs.lstatSync(path.resolve(source, file)).isFile()) copyFileSync(path.resolve(source, file), path.resolve(target, file));
		else copyFolderRecursivelySync(path.resolve(source, file), path.resolve(target, file));
	}
};

copyFolderRecursivelySync(path.resolve(__dirname, '../', 'src/', 'static/'), path.resolve(__dirname, '../', 'build/', 'static/'));
copyFolderRecursivelySync(path.resolve(__dirname, '../', 'src/', 'etc/'), path.resolve(__dirname, '../', 'build/', 'etc/'));
copyFileSync(path.resolve(__dirname, '../', 'package.json'), path.resolve(__dirname, '../', 'build/', 'package.json'));
copyFileSync(path.resolve(__dirname, '../', 'app-update.yml'), path.resolve(__dirname, '../', 'build/', 'app-update.yml'));
//copyFileSync(path.resolve(__dirname, '../', 'dev-app-update.yml'), path.resolve(__dirname, '../', 'build/', 'dev-app-update.yml'));