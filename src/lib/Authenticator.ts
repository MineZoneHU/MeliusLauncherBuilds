import * as path from 'path';
import * as crypto from 'crypto';
import * as Electron from 'electron';
import Axios from './AxiosProxy';
import * as Debug from './Debug';
import * as Config from './Config';
import * as HWIDManager from './HWIDManager';

let authenticatorWindow : Electron.BrowserWindow;
let accessTokenRefreshingTask = null;

const API_URL = 'https://api.minezone.hu';

const UNSCRAMBLING_TABLE = Buffer.from('67bbd4af0745ddb232b21e3cf90272a372e12d2704713b79d27efddbfd2936849c389eed0df725a88a01bea1cece9b3ca39e1cfe9c6a58dd26ed7fe3c9bbc2a4984f63a522475ea99ff9b47d0ef30c8ab359a9e6449239abd91210d60bb6efa72b6bc1c1619be2d5aafc77274aa17392079d8756ad348d7d84e75c32287cd375b4518c334e606581626ef238e741d8fb49493766e78bf5de9a585ba0c8ad8870ae6d41a7de8c6514cf141b8e3a1d227b9c67da332ae308f6928835ab1326bd1dacec7447a85fc07776c6b14346c1ca63eac36f2ae1fc0058f8695c63f5ac8013fadf1f11a656fe1718b066cc1b21981b670e360d80e692abe0d801d3c26e779bd8d2006ea1118d5e7e60702da45342a2b643626453240f897533c0651622fbadf187dc9aeaf6ccf7497ae116c3409da9932a30f70ce128dd44e84c5fd725580835878f10f41fe71a6fb44decc71a37bd022be3c92153a50348c3c5fee596b7b7ee258d2f2b7951b635b8e900d4629142544a419e6c4854b934700f15f539bc4e0a375921c8ce2f51f83cc45097b9e971e03b7520977f05a3fa94cabe899faf0f72930438aa7b3d5b75957f85159c7206f980f8537945e288eb1c24008f09e25e9af74bc67c8beec8fa17f60e8c0a4186fd843079a0a53d14cac90431f43aef14462cef4cb85e9990b5ee388234407894dde25d997eb79ea4c6ae31eed64d7812c52042eb9dda735afc4c8c3e190b5fe5d4f5cdb14015170da6013bcc06e8571983d218dafba0e42bb723a5cdc0966c625df35d27b0836ad7aacec6941dbd7866c4d04331b095d0bf9ab5166b875a7a89c7e8ba64ea732e6c238246d4af2c0a524350e45510c57b74c925f49461bc8a65856f19867e808b974405c8037133836d68371ef4b9b152aaf06f8e093c57503f198555b2e4faa8ba3efebb91c55b98d6e04be5bfcb6910e0f2b6e51a014afd8581741c17a612f0dcae6902bfd80d36e64b0c59f1a72868d0c77cfc02d58445ec7604f35616bec4d9e80f032fdbab2203aea159bc6b2cf1b300540ba6bf499bcfbe08d70544546ec24ff0eb550521cb2d7dc240a2011dba2def2aa34a68b1b5677377de64b530f61c1a9f2c4b5f15cc0676b9903fdacacdb3067d13091895c4f3d63e31fba774ebad348199eaa98f5126b43ad34682d230df9396f87cd0d52335613db04f86184d3a268f080c391f03f0de983f641fcf459699c050d1cb368d3261e9201e9f5570cfcb5bac52486abdb2233f601b8bed912e4ebc5ad9d3907a63f20ea829d588c127b3a295812fd14f47326d5a6ddb02df2e0b247b29eddfe424117ae3209d1e83760771b8115ccdd17807c348afac475d6c423e8697baf9a4c76b6a574edc3b39dcbb52b88ee60966d12e3dd76069a0ec298a90897fd9f14d120a8291a24c689328568ee913f2db5c57', 'hex');

const unscramble = (input : Buffer) => {

	for(let i = 0; i < input.length; i++) input[i] ^= UNSCRAMBLING_TABLE[i % UNSCRAMBLING_TABLE.length];
    
	const buf = Buffer.alloc(input[0] << 24 | input[1] << 16 | input[2] << 8 | input[3]);

	let p = 4;
	for(let i = 0; i < buf.length; i++) {
		buf[i] = input[p];
		p = input[p + 1] << 24 | input[p + 2] << 16 | input[p + 3] << 8 | input[p + 4];
	}

	return buf;

};

const refreshToken = () => new Promise<boolean | string>(async (resolve, reject) => {

	if(!Config.has('authentication.refreshToken') || !Config.has('authentication.refreshToken.expiry') || Config.get('authentication.refreshToken.expiry') as number < Date.now() - 3 * 24 * 60 * 60 * 1000) {
        
		resolve(false);

		return;

	}

	Axios({
		method: 'POST',
		url: `${API_URL}/client/authentication/refreshToken`,
		headers: {
			'content-type': 'application/json'
		},
		data: JSON.stringify({
			refreshToken: Config.get('authentication.refreshToken'),
			hwid: HWIDManager.getHWID()
		}),
		responseType: 'arraybuffer',
		validateStatus: () => true
	}).then(res => {

		if(res.status !== 200) {

			resolve(`HTTP_STATUS_${res.status}`);

			return;

		}

		const parsedBody = JSON.parse(unscramble(res.data).toString());

		if(!parsedBody.success) {

			resolve(parsedBody.errorCode);

			return;

		}

		Config.set('authentication.accessToken', parsedBody.accessToken);
		Config.set('authentication.accessToken.expiry', parsedBody.accessTokenExpiry);

		resolve(true);

	}).catch(err => {

		reject(err);

	});

});

const login = (username : string, password : string) => new Promise<true | string>(async (resolve, reject) => {

	Axios({
		method: 'POST',
		url: `${API_URL}/client/authentication/login`,
		headers: {
			'content-type': 'application/json'
		},
		data: JSON.stringify({
			username: username,
			password: password,
			hwid: HWIDManager.getHWID()
		}),
		responseType: 'arraybuffer',
		validateStatus: () => true
	}).then(res => {

		const parsedBody = JSON.parse(unscramble(res.data).toString());

		if(!parsedBody.success) {

			resolve(parsedBody.errorCode);

			return;

		}

		Config.set('authentication.username', parsedBody.username);

		Config.set('authentication.refreshToken', parsedBody.refreshToken);
		Config.set('authentication.refreshToken.expiry', parsedBody.refreshTokenExpiry);

		Config.set('authentication.accessToken', parsedBody.accessToken);
		Config.set('authentication.accessToken.expiry', parsedBody.accessTokenExpiry);

		resolve(true);

	}).catch(reject);

});

export const getUsername = () => Config.get('authentication.username') as string ?? null;

export const getAccessToken = () => Config.get('authentication.accessToken') as string ?? null;

export const generateUUID = () => {

	if(Config.has('authentication.username') === null) return null;

	const uuid = crypto.createHash('md5').update(`OfflinePlayer:${Config.get('authentication.username')}`).digest();
	uuid[6] = uuid[6] & 0x0f | 0x30;
	uuid[8] = uuid[8] & 0x3f | 0x80;
    
	return uuid.toString('hex');

};

const startAccessTokenRefreshingTask = () => {

	accessTokenRefreshingTask = setInterval(() => {

		refreshToken().then(refreshTokenResult => {

			if(refreshTokenResult === true) return;

			Debug.log('Authenticator', `[Error] Got error code ${refreshTokenResult} while refreshing the token`);

		}).catch(err => {

			Debug.log('Authenticator', `[Error] An error has occured while refreshing the token: ${err}`);

		});

	}, .5 * 60 * 1000);

};

const stopAccessTokenRefreshingTask = () => {

	if(accessTokenRefreshingTask === null) return;

	clearInterval(accessTokenRefreshingTask);
	accessTokenRefreshingTask = null;

};

export const authenticate = () => new Promise<void>(async (resolve, reject) => {

	stopAccessTokenRefreshingTask();

	Debug.log('Authenticator', 'Authenticating with token...');

	if(Config.has('authentication.refreshToken.expiry') && Config.get('authentication.refreshToken.expiry') as number + 3 * 24 * 60 * 60 * 1000 < Date.now()) {
        
		Config.remove('authentication.refreshToken');
		Config.remove('authentication.refreshToken.expiry');
    
	}
    
	const tokenRefreshResult = await refreshToken().catch(reject);
	if(tokenRefreshResult === true) {

		Debug.log('Authenticator', 'Authenticated with token, further authentication is not required');

		startAccessTokenRefreshingTask();

		resolve();

		return;

	} else if(tokenRefreshResult === 'HWID_BAN' || tokenRefreshResult === 'SUSPENDED_ACCOUNT') {
		Config.remove('authentication.refreshToken');
		Config.remove('authentication.refreshToken.expiry');
		Config.remove('authentication.accessToken');
		Config.remove('authentication.accessToken.expiry');
		Config.remove('authentication.username');

		Electron.dialog.showErrorBox(
			'MineZone - Kitiltás',
			tokenRefreshResult === 'HWID_BAN'
				? 'Ez a számítógép ki lett tiltva a MineZone szerverről!'
				: 'Ez a felhasználói fiók fel van függesztve a MineZone szerverről!'
		);
		return;
	}

	Debug.log('Authenticator', 'Couldn\'t authenticate with token, authentication with credentials is required');

	authenticatorWindow = new Electron.BrowserWindow({
		title: 'MineZone',
		titleBarStyle: 'hidden',
		transparent: true,
		frame: false,
		darkTheme: true,
		width: 1280,
		height: 720,
		resizable: false,
		maximizable: false,
		fullscreenable: false,
		show: false,
		webPreferences: {
			preload: path.resolve(__dirname, '../', 'static/', 'js/', 'preload.js'),
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			devTools: false
		}
	});
    
	authenticatorWindow.once('ready-to-show', () => {

		authenticatorWindow.show();
		authenticatorWindow.focus();
        
	});

	authenticatorWindow.once('show', async () => {

		authenticatorWindow.webContents.on('ipc-message', async (event, channel, message) => {

			switch(channel) {

				case 'open-external-website': {

					const openableWebsites = {
						registrationPage: 'https://bolt.minezone.hu/auth/registration',
						forgotPasswordPage: 'https://bolt.minezone.hu/auth/forgot-password'
					};

					if(openableWebsites[message.website] === undefined) return;

					Electron.shell.openExternal(openableWebsites[message.website]);

					return;

				}

				case 'authenticate-with-credentials': {
                    
					const authenticationResult = await login(message.username, message.password).catch(reject); 
                    
					if(authenticationResult === true) {

						authenticatorWindow.webContents.removeAllListeners('ipc-message');

						authenticatorWindow.removeAllListeners('close');
						authenticatorWindow.close();

						startAccessTokenRefreshingTask();
                
						resolve();

						return;

					}

					let errorDialogContent;

					switch(authenticationResult) {

						default: {

							errorDialogContent = 'Ismeretlen eredetű hiba lépett fel!';
							Debug.log('Authenticator', `[Error] An unknown error has occured during the authentication. (${authenticationResult})`);
							break;

						}

						case 'INTERNAL_ERROR':
						case 'MISSING_USERNAME':
						case 'MISSING_PASSWORD':
						case 'ONLY_IPV4': {

							errorDialogContent = 'Belső hiba lépett fel!';
							Debug.log('Authenticator', `[Error] An internal error has occured during the authentication. (${authenticationResult})`);
							break;

						}

						case 'MISMATCHING_IP': {

							errorDialogContent = 'Ez a fiók egy másik IP-címre van levédve!';
							break;

						}

						case 'HWID_BAN': {

							errorDialogContent = 'Ez a számítógép ki lett tiltva!';
							break;

						}

						case 'SUSPENDED_ACCOUNT': {

							errorDialogContent = 'Ez a karakter fel van függesztve!';
							break;

						}

						case 'MALFORMED_USERNAME': {

							errorDialogContent = 'A megadott felhasználónév formátuma érvénytelen!';
							break;

						}

						case 'MALFORMED_PASSWORD': {

							errorDialogContent = 'A megadott jelszó formátuma érvénytelen!';
							break;

						}

						case 'INVALID_USERNAME': {

							errorDialogContent = 'A megadott felhasználónévvel nem létezik fiók!';
							break;

						}

						case 'INVALID_PASSWORD': {

							errorDialogContent = 'A megadott jelszó helytelen!';
							break;

						}

					}

					Electron.dialog.showErrorBox('Autentikációs hiba', errorDialogContent);
					
					return;

				}

			}

		});

	});

	await authenticatorWindow.loadFile(path.resolve(__dirname, '../', 'static/', 'authenticator.html')).catch(reject);
    
});