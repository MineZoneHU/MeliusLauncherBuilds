import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as Electron from 'electron';

export const initFolders = () => new Promise<void>((resolve, reject) => {

	switch(os.platform()) {

		case 'win32':
			process.env.GAME_FOLDER = path.resolve(process.env.APPDATA, '.minezone.hu/');
			break;

		case 'darwin':
			process.env.GAME_FOLDER = path.resolve(process.env.HOME, 'Library/', 'Application Support/', 'minezone.hu/');
			break;

		case 'linux':
			process.env.GAME_FOLDER = path.resolve(process.env.HOME, '.local/', 'share/', 'minezone.hu/');
			break;
            
	}
    
	if(!fs.existsSync(process.env.GAME_FOLDER)) fs.mkdirSync(process.env.GAME_FOLDER, { recursive: true });

	if(Electron.app.getPath('exe')) {
		process.env.LAUNCHER_FOLDER = path.dirname(Electron.app.getPath('exe'));
	} else {
		process.env.LAUNCHER_FOLDER = path.resolve(os.tmpdir(), 'MineZoneAppFolder/');
		if(!fs.existsSync(process.env.LAUNCHER_FOLDER)) fs.mkdirSync(process.env.LAUNCHER_FOLDER, { recursive: true });
	}

	resolve();

});