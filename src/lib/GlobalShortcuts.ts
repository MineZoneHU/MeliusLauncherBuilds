import * as fs from 'fs';
import * as path from 'path';
import * as Electron from 'electron';

export const registerShortcuts = () : void => {

	Electron.globalShortcut.register('CommandOrControl+Shift+F', () => {

		if(!process.env.GAME_FOLDER || !fs.existsSync(process.env.GAME_FOLDER)) return;

		Electron.shell.openPath(process.env.GAME_FOLDER);

	});

	Electron.globalShortcut.register('CommandOrControl+Shift+L', () => {

		if(!process.env.GAME_FOLDER || !fs.existsSync(process.env.GAME_FOLDER) || !fs.existsSync(path.resolve(process.env.GAME_FOLDER, 'debug.log'))) return;

		Electron.shell.openPath(path.resolve(process.env.GAME_FOLDER, 'debug.log'));

	});

};