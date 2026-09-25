process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import * as os from 'os';
import * as Electron from 'electron';
import * as ElectronUpdater from 'electron-updater';
import * as CLIArgsParser from './lib/CLIArgsParser';
import * as Folders from './lib/Folders';
import * as Debug from './lib/Debug';
import * as GlobalShortcuts from './lib/GlobalShortcuts';
import * as Encrypter from './lib/Encrypter';
import * as Config from './lib/Config';
import * as Updater from './lib/Updater';
import * as Authenticator from './lib/Authenticator';
import * as Launcher from './lib/Launcher';
import * as Utils from './lib/Utils';
import * as AxiosProxy from './lib/AxiosProxy';
import * as GPUList from './lib/GPUList';
import { DiscordRPC } from './lib/DiscordRPC';
import * as TrayManager from './lib/TrayManager';

const supportedPlatformsAndArchitectures = {
	darwin: [ 'x64', 'arm64' ],
	win32: [ 'x64', 'arm64' ]
};

const osPlatform = os.platform(), osArch = os.arch(), osVersion = os.version(), osTotalmem = os.totalmem(), osFreemem = os.freemem();

if(supportedPlatformsAndArchitectures[osPlatform] === undefined || !supportedPlatformsAndArchitectures[osPlatform].includes(osArch)) {

	Electron.dialog.showErrorBox('Nem támogatott rendszer', `Ez a platform (${osPlatform}) és/vagy architektúra (${osArch}) sajnos nem támogatott!`);

	Electron.app.exit(1);
	process.exit(1);

}

Electron.app.name = 'MineZone';
if (process.platform === 'win32') {
	Electron.app.setAppUserModelId('MineZone');
}

const gotTheLock = Electron.app.requestSingleInstanceLock();

if(!gotTheLock) {

	Electron.app.exit(0);
	process.exit(0);

} else {

	Electron.app.on('second-instance', () => {

		TrayManager.showLauncherWindow();

	});

}

Electron.app.on('browser-window-created', (_, window) => {
	// Prevent unauthorized navigation away from file://
	window.webContents.on('will-navigate', (event, navigationUrl) => {
		try {
			const parsed = new URL(navigationUrl);
			if (parsed.protocol !== 'file:') {
				event.preventDefault();
				Electron.shell.openExternal(navigationUrl);
			}
		} catch (_) {
			event.preventDefault();
		}
	});

	// Restrict window.open / target="_blank" to prevent unauthorized popups
	window.webContents.setWindowOpenHandler(({ url }) => {
		try {
			const parsed = new URL(url);
			if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
				Electron.shell.openExternal(url);
			}
		} catch (_) {}
		return { action: 'deny' };
	});

	if (!Config.get('developerMode') && process.env.DEVELOPER_MODE === undefined) {
		window.webContents.on('devtools-opened', () => {
			window.webContents.closeDevTools();
		});
		window.webContents.on('before-input-event', (event, input) => {
			if ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i') {
				event.preventDefault();
			}
			if (input.key === 'F12') {
				event.preventDefault();
			}
		});
	}
});

Electron.app.once('ready', async () => {

	AxiosProxy.setVersion(ElectronUpdater.autoUpdater.currentVersion.version);

	Electron.ipcMain.on('exit-app', (event) => {

		if (event.sender) {
			const senderUrl = event.senderFrame ? event.senderFrame.url : event.sender.getURL();
			if (!senderUrl || !senderUrl.startsWith('file://')) return;
		}

		const win = Launcher.getLauncherWindow();
		if (win && !win.isDestroyed() && TrayManager.isTrayActive()) {
			TrayManager.hideLauncherWindow();
			return;
		}

		Electron.app.exit(0);
		process.exit(0);

	});

	try {

		CLIArgsParser.parse();

		await Folders.initFolders();

		await Debug.init();

		Debug.log('Main', `Process started at ${(new Date(Date.now() - process.uptime() * 1000)).toISOString()}`);
		Debug.log('Main', 'System information:');
		Debug.log('Main', `- OS: ${osVersion} (${osPlatform}, ${osArch})`);
		Debug.log('Main', `- Total memory: ${Utils.bytesToHuman(osTotalmem)} (${osTotalmem} B)`);
		Debug.log('Main', `- Free memory: ${Utils.bytesToHuman(osFreemem)} (${osFreemem} B)`);
		const cpus = os.cpus();
		const cpuCountLength = Math.floor(Math.log10(cpus.length - 1)) + 1;
		Debug.log('Main', `- CPUs (${cpus.length}):`);
		let i = 0;
		for(const cpu of cpus) Debug.log('Main', `\t${(++i).toString().padStart(cpuCountLength, '0')}. - ${cpu.model} (${cpu.speed / 1000} Ghz)`);
		if(osPlatform === 'win32') {
			try {
				const gpus = GPUList.getGPUs();
				if (gpus && gpus.length > 0) {
					const gpuCountLength = Math.max(1, Math.floor(Math.log10(Math.max(1, gpus.length - 1))) + 1);
					Debug.log('Main', `- GPUs (${gpus.length}):`);
					let i = 0;
					for(const gpu of gpus) Debug.log('Main', `\t${(++i).toString().padStart(gpuCountLength, '0')}. - ${gpu}`);
				}
			} catch (gpuErr) {
				Debug.log('Main', `[Warning] GPU enumeration failed: ${gpuErr}`);
			}
		}
		Debug.log('Main', 'Registering the global shortcuts...');
		await GlobalShortcuts.registerShortcuts();
		Debug.log('Main', 'Registered the global shortcuts!');

		Debug.log('Main', 'Initializing the encryption util...');
		await Encrypter.init();
		Debug.log('Main', 'Initialized the encryption util!');

		Debug.log('Main', 'Loading configuration...');
		await Config.loadConfig();
		Debug.log('Main', 'Loaded the configuration!');

		TrayManager.initTray();
        
		Debug.log('Main', 'Updating...');
		await Updater.update();
		Debug.log('Main', 'Updated!');

		DiscordRPC.init();

		// eslint-disable-next-line no-constant-condition
		while(true) {

			Debug.log('Main', 'Authenticating...');
			DiscordRPC.setLauncherActivity();
			await Authenticator.authenticate();
			DiscordRPC.setLauncherActivity();
			Debug.log('Main', 'Authenticated!');
			TrayManager.updateTrayMenu();

			Debug.log('Main', 'Starting launcher...');
			await Launcher.start();

		}

	} catch(err) {

		Debug.log('Main', `[Error] ${err}`);

		try {
			Electron.dialog.showErrorBox(
				'Hiba a MineZone indításakor',
				`A kliens indítása közben váratlan hiba történt:\n\n${err && (err as any).stack ? (err as any).stack : err}\n\nKérlek, küldd el a hibát a fejlesztőknek!`
			);
		} catch (_) {}

		Electron.app.exit(1);
		process.exit(1);

	}

});

Electron.app.on('window-all-closed', () => {
	// Do not quit when all windows are closed because the launcher transitions
	// between the Updater window, Authenticator window, and Launcher window,
	// and stays alive in the background / system tray.
});

Electron.app.on('will-quit', event => {
	// Prevent spontaneous quitting from default handlers. Explicit quits use Electron.app.exit(0).
	event.preventDefault();
});

process.on('uncaughtException', err => {

	Debug.log('Main', `Process unhandled exception: ${err.message}`);
	Debug.log('Main', err.stack);

});