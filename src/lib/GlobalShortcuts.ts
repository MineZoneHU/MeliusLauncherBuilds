import * as fs from 'fs';
import * as path from 'path';
import * as Electron from 'electron';
import * as Debug from './Debug';
import * as DebugDumper from './DebugDumper';

export const registerShortcuts = () : void => {

	Electron.globalShortcut.register('CommandOrControl+Shift+F', () => {

		if(!process.env.GAME_FOLDER || !fs.existsSync(process.env.GAME_FOLDER)) return;

		Electron.shell.openPath(process.env.GAME_FOLDER);

	});

	Electron.globalShortcut.register('CommandOrControl+Shift+L', () => {

		if(!process.env.GAME_FOLDER || !fs.existsSync(process.env.GAME_FOLDER) || !fs.existsSync(path.resolve(process.env.GAME_FOLDER, 'debug.log'))) return;

		Electron.shell.openPath(path.resolve(process.env.GAME_FOLDER, 'debug.log'));

	});

	Electron.globalShortcut.register('CommandOrControl+Shift+M', () => {

		if(!process.env.GAME_FOLDER || !fs.existsSync(process.env.GAME_FOLDER) || !fs.existsSync(path.resolve(process.env.GAME_FOLDER, 'logs')) || !fs.existsSync(path.resolve(process.env.GAME_FOLDER, 'logs', 'latest.log'))) return;

		Electron.shell.openPath(path.resolve(process.env.GAME_FOLDER, 'logs', 'latest.log'));

	});

	let debugDumpingInProgress = false;

	Electron.globalShortcut.register('CommandOrControl+Alt+Shift+D', async () => {

		if(!process.env.GAME_FOLDER || !fs.existsSync(process.env.GAME_FOLDER) || debugDumpingInProgress) return;

		debugDumpingInProgress = true;

		const btnIdx = Electron.dialog.showMessageBoxSync(null, {
			type: 'warning',
			title: 'Debugolási adatok feltöltésének megerősítése',
			message: [
				'Kérlek, erősítsd meg, hogy fel szeretnéd tölteni a debugoláshoz szükséges adatokat.',
				'',
				'A feltöltött fájlok a következő adatokat tartalmazhatják:',
				'- információk a számítógépről (platform, architektúra, processzorok, videokártyák, memória, egyéb hardverinformációk),',
				'- információk a játékmenetekről (chat logok, játékosnevek, szervercímek),',
				'- információk a felhasználóról (felhasználónév, játékosnév, IP-cím).',
				'',
				'A fent említett információk kizárólagosan debugolási célból lesznek felhasználva.'
			].join('\n'),
			buttons: [
				'Megerősítem',
				'Mégsem'
			],
			defaultId: 0,
			cancelId: 1,
			noLink: true
		});

		if(btnIdx !== 0) {

			debugDumpingInProgress = false;
			return;

		}

		DebugDumper.createDump().then(dumpURL => {

			Electron.clipboard.writeText(dumpURL, 'clipboard');

			Electron.dialog.showMessageBoxSync(null, {
				type: 'info',
				title: 'Debugolási adatok feltöltve',
				message: [
					'A debugolási adatok sikeresen fel lettek töltve!',
					'Az alábbi linken érhetőek el (a link a vágólapra lett másolva):',
					dumpURL
				].join('\n'),
				buttons: [
					'Bezárás'
				],
				defaultId: 0,
				cancelId: 0,
				noLink: true
			});

			debugDumpingInProgress = false;

		}).catch(err => {

			Debug.log('Launcher', `[Error] An error occured in the debug dumping process: ${err}`);

			Electron.dialog.showErrorBox('Hiba', 'Hiba történt a debugolási adatok feltöltése közben, kérlek, próbáld újra!');

			debugDumpingInProgress = false;

		});


	});

};