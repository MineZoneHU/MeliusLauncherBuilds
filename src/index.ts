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

if(!Electron.app.requestSingleInstanceLock()) {
	
	Electron.dialog.showErrorBox('Hiba', 'Már fut a Launcher.');

	Electron.app.exit(1);
	process.exit(1);

}

Electron.app.once('ready', async () => {

	AxiosProxy.setVersion(ElectronUpdater.autoUpdater.currentVersion.version);

	Electron.ipcMain.once('exit-app', () => {

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
			const gpus = GPUList.getGPUs();
			const gpuCountLength = Math.floor(Math.log10(gpus.length - 1)) + 1;
			Debug.log('Main', `- GPUs (${gpus.length}):`);
			i = 0;
			for(const gpu of gpus) Debug.log('Main', `\t${(++i).toString().padStart(gpuCountLength, '0')}. - ${gpu}`);
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
        
		Debug.log('Main', 'Updating...');
		await Updater.update();
		Debug.log('Main', 'Updated!');

		// eslint-disable-next-line no-constant-condition
		while(true) {

			Debug.log('Main', 'Authenticating...');
			await Authenticator.authenticate();
			Debug.log('Main', 'Authenticated!');

			Debug.log('Main', 'Starting launcher...');
			await Launcher.start();

		}

	} catch(err) {

		Debug.log('Main', `[Error] ${err}`);

		Electron.app.exit(1);
		process.exit(1);

	}

});

Electron.app.on('will-quit', event => {
	event.preventDefault();
});

process.on('uncaughtException', err => {

	Debug.log('Main', `Process unhandled exception: ${err.message}`);
	Debug.log('Main', err.stack);

});