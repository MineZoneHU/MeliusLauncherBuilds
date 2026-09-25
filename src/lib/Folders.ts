import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

export const initFolders = () => new Promise<void>((resolve, reject) => {

	switch(os.platform()) {

		case 'win32':
			process.env.LEGACY_GAME_FOLDER = path.resolve(process.env.APPDATA, '.minezone/');
			process.env.GAME_FOLDER = path.resolve(process.env.APPDATA, '.minezone.hu/');
			break;

		case 'darwin':
			process.env.LEGACY_GAME_FOLDER = path.resolve(process.env.HOME, 'Library/', 'Application Support/', 'minezone/');
			process.env.GAME_FOLDER = path.resolve(process.env.HOME, 'Library/', 'Application Support/', 'minezone.hu/');
			break;

		case 'linux':
			process.env.LEGACY_GAME_FOLDER = path.resolve(process.env.HOME, '.local/', 'share/', 'minezone/');
			process.env.GAME_FOLDER = path.resolve(process.env.HOME, '.local/', 'share/', 'minezone.hu/');
			break;
            
	}
    
	if(fs.existsSync(process.env.LEGACY_GAME_FOLDER)) {
		
		fs.rmSync(process.env.LEGACY_GAME_FOLDER, {
			force: true,
			recursive: true
		});
	
	}

	if(!fs.existsSync(process.env.GAME_FOLDER)) {
		fs.mkdirSync(process.env.GAME_FOLDER, {
			recursive: true
		});
	}

	const subdirs = ['assets', 'assets/indexes', 'assets/objects', 'libraries', 'mods', 'lib'];
	for (const sub of subdirs) {
		const fullSubPath = path.resolve(process.env.GAME_FOLDER, sub);
		if (!fs.existsSync(fullSubPath)) {
			fs.mkdirSync(fullSubPath, { recursive: true });
		}
	}

	resolve();

});