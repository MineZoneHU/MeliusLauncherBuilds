import * as path from 'path';
import * as crypto from 'crypto';
import * as Electron from 'electron';
import Axios from './AxiosProxy';
import * as Debug from './Debug';
import * as Config from './Config';

let authenticatorWindow : Electron.BrowserWindow;
let accessTokenRefreshingTask = null;

const API_URL = 'https://melius-api.minezone.hu';

const UNSCRAMBLING_TABLE = [103,187,212,175,7,69,221,178,50,178,30,60,249,2,114,163,114,225,45,39,4,113,59,121,210,126,253,219,253,41,54,132,156,56,158,237,13,247,37,168,138,1,190,161,206,206,155,60,163,158,28,254,156,106,88,221,38,237,127,227,201,187,194,164,152,79,99,165,34,71,94,169,159,249,180,125,14,243,12,138,179,89,169,230,68,146,57,171,217,18,16,214,11,182,239,167,43,107,193,193,97,155,226,213,170,252,119,39,74,161,115,146,7,157,135,86,173,52,141,125,132,231,92,50,40,124,211,117,180,81,140,51,78,96,101,129,98,110,242,56,231,65,216,251,73,73,55,102,231,139,245,222,154,88,91,160,200,173,136,112,174,109,65,167,222,140,101,20,207,20,27,142,58,29,34,123,156,103,218,51,42,227,8,246,146,136,53,171,19,38,189,29,172,236,116,71,168,95,192,119,118,198,177,67,70,193,202,99,234,195,111,42,225,252,0,88,248,105,92,99,245,172,128,19,250,223,31,17,166,86,254,23,24,176,102,204,27,33,152,27,103,14,54,13,128,230,146,171,224,216,1,211,194,110,119,155,216,210,0,110,161,17,141,94,126,96,112,45,164,83,66,162,182,67,98,100,83,36,15,137,117,51,192,101,22,34,251,173,241,135,220,154,234,246,204,247,73,122,225,22,195,64,157,169,147,42,48,247,12,225,40,221,68,232,76,95,215,37,88,8,53,135,143,16,244,31,231,26,111,180,77,236,199,26,55,189,2,43,227,201,33,83,165,3,72,195,197,254,229,150,183,183,238,37,141,47,43,121,81,182,53,184,233,0,212,98,145,66,84,74,65,158,108,72,84,185,52,112,15,21,245,57,188,78,10,55,89,33,200,206,47,81,248,60,196,80,151,185,233,113,224,59,117,32,151,127,5,163,250,148,202,190,137,159,175,15,114,147,4,56,170,123,61,91,117,149,127,133,21,156,114,6,249,128,248,83,121,69,226,136,235,28,36,0,143,9,226,94,154,247,75,198,124,139,238,200,250,23,246,14,140,10,65,134,253,132,48,121,160,165,61,20,202,201,4,49,244,58,239,20,70,44,239,76,184,94,153,144,181,238,56,130,52,64,120,148,221,226,93,153,126,183,158,164,198,174,49,238,214,77,120,18,197,32,66,235,157,218,115,90,252,76,140,62,25,11,95,229,212,245,205,177,64,21,23,13,166,1,59,204,6,232,87,25,131,210,24,218,251,160,228,43,183,35,165,205,192,150,108,98,93,243,93,39,176,131,106,215,170,206,198,148,29,189,120,102,196,208,67,49,176,149,208,191,154,181,22,107,135,90,122,137,199,232,186,100,234,115,46,108,35,130,70,212,175,44,10,82,67,80,228,85,16,197,123,116,201,37,244,148,97,188,138,101,133,111,25,134,126,128,139,151,68,5,200,3,113,51,131,109,104,55,30,244,185,177,82,170,240,111,142,9,60,87,80,63,25,133,85,178,228,250,168,186,62,254,187,145,197,91,152,214,224,75,229,191,203,105,16,224,242,182,229,26,1,74,253,133,129,116,28,23,166,18,240,220,174,105,2,191,216,13,54,230,75,12,89,241,167,40,104,208,199,124,252,2,213,132,69,236,118,4,243,86,22,190,196,217,232,15,3,47,219,171,34,3,174,161,89,188,107,44,241,179,0,84,11,166,191,73,155,207,190,8,215,5,68,84,110,194,79,240,235,85,5,33,203,45,125,194,64,162,1,29,186,45,239,42,163,74,104,177,181,103,115,119,222,100,181,48,246,28,26,159,44,75,95,21,204,6,118,185,144,63,218,202,205,179,6,125,19,9,24,149,196,243,214,62,49,251,167,116,235,173,52,129,153,234,169,143,81,38,180,58,211,70,130,210,48,223,147,150,248,124,208,213,35,53,97,61,176,79,134,24,77,58,38,143,8,12,57,31,3,240,222,152,63,100,31,207,69,150,153,192,80,209,203,54,141,50,97,233,32,30,159,85,112,207,203,91,172,82,72,106,189,178,35,63,96,27,139,237,145,46,78,188,90,217,211,144,122,99,242,14,168,41,213,136,193,39,179,162,149,129,47,209,79,71,50,109,90,109,219,2,223,46,11,36,123,41,237,223,228,36,17,122,227,32,157,30,131,118,7,113,184,17,92,205,209,120,7,195,72,175,172,71,93,108,66,62,134,151,186,249,164,199,107,106,87,78,220,59,57,220,187,82,184,142,230,9,102,209,46,61,215,96,105,160,236,41,138,144,137,127,217,241,77,18,10,130,145,162,76,104,147,40,86,142,233,19,242,219,92,87];

const deobfuscate = (input : Buffer) => {

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

	if(!Config.has('authentication.refreshToken') || !Config.has('authentication.refreshToken.expiry') || Config.get('authentication.refreshToken.expiry') < Date.now() - 3 * 24 * 60 * 60 * 1000) {
        
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
			refreshToken: Config.get('authentication.refreshToken')
		}),
		responseType: 'arraybuffer',
		validateStatus: () => true
	}).then(res => {

		if(res.status !== 200) {

			resolve(`HTTP_STATUS_${res.status}`);

			return;

		}

		const parsedBody = JSON.parse(deobfuscate(res.data).toString());

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
			password: password
		}),
		responseType: 'arraybuffer',
		validateStatus: () => true
	}).then(res => {

		const parsedBody = JSON.parse(deobfuscate(res.data).toString());

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
    
	if(await refreshToken().catch(reject) === true) {

		Debug.log('Authenticator', 'Authenticated with token, further authentication is not required');

		startAccessTokenRefreshingTask();

		resolve();

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
			contextIsolation: true,
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

	authenticatorWindow.once('close', () => Electron.app.exit());

	await authenticatorWindow.loadFile(path.resolve(__dirname, '../', 'static/', 'authenticator.html')).catch(reject);
    
});