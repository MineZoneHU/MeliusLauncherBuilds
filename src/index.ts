// HACK: this will disable the rejection of invalid SSL certs, i should look for a fix 
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import * as os from 'os';
import * as Electron from 'electron';
import * as CLIArgsParser from './lib/CLIArgsParser';
import * as Folders from './lib/Folders';
import * as Debug from './lib/Debug';
import * as GlobalShortcuts from './lib/GlobalShortcuts';
import * as Encrypter from './lib/Encrypter';
import * as Config from './lib/Config';
import * as Updater from './lib/Updater';
import * as Authenticator from './lib/Authenticator';
import * as Launcher from './lib/Launcher';

const supportedPlatformsAndArchitectures = {
	darwin: [ 'x64', 'arm64' ],
	//linux: [ 'ia32', 'x64', 'arm64' ], // TODO: linux? no.
	win32: [ 'ia32', 'x64', 'arm64' ]
};

if(supportedPlatformsAndArchitectures[os.platform()] === undefined || !supportedPlatformsAndArchitectures[os.platform()].includes(os.arch())) {

	Electron.dialog.showErrorBox('Nem támogatott rendszer', `Ez a platform (${os.platform()}) és/vagy architektúra (${os.arch()}) sajnos nem támogatott!`);

	Electron.app.exit(1);
	process.exit(1);

}

if(!Electron.app.requestSingleInstanceLock()) {
	
	Electron.dialog.showErrorBox('Már fut a Launcher', 'Egyszerre csak egy Launcher futhat.');

	Electron.app.exit(1);
	process.exit(1);

}

Electron.app.once('ready', async () => {

	try {

		CLIArgsParser.parse();

		await Folders.initFolders();

		await Debug.init();

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

		// TODO: implement state machine (so we can get rid of this eslint suppression lol)
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
		Electron.app.quit();
		process.exit(1);

	}

});

Electron.app.on('will-quit', event => event.preventDefault());

process.on('uncaughtException', err => {

	Debug.log('Main', `Process unhandled exception: ${err.message}`);
	Debug.log('Main', err.stack);

});