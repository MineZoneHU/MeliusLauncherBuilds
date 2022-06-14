import * as path from 'path';
import * as crypto from 'crypto';
import * as Electron from 'electron';
import * as Debug from './Debug';
import * as Request from './Request';
import * as Config from './Config';

let authenticatorWindow : Electron.BrowserWindow;
let accessTokenRefreshingTask = null;

const AUTH_URL = 'https://melius-api.minezone.hu';

const refreshToken = () => new Promise<boolean | string>(async (resolve, reject) => {

	if(!Config.has('authentication.refreshToken') || !Config.has('authentication.refreshToken.expiry') || Config.get('authentication.refreshToken.expiry') < Date.now() - 3 * 24 * 60 * 60 * 1000) {
        
		resolve(false);
		return;

	}

	Request.request(`${AUTH_URL}/authentication/refreshToken`, {
		method: 'POST',
		data: JSON.stringify({
			refreshToken: Config.get('authentication.refreshToken')
		}),
		headers: {
			'Content-Type': 'application/json'
		}
	}).then(res => {

		const parsedBody = JSON.parse(res.body.toString());

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

	Request.request(`${AUTH_URL}/authentication/login`, {
		method: 'POST',
		data: JSON.stringify({
			username: username,
			password: password
		}),
		headers: {
			'Content-Type': 'application/json'
		}
	}).then(res => {

		const parsedBody = JSON.parse(res.body.toString());

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

export const getUsername = () => Config.get('authentication.username') as string;

export const getAccessToken = () => Config.get('authentication.accessToken') as string;

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

			Debug.log('Authenticator', `Got error code ${refreshTokenResult} while refreshing the token`);

			Electron.app.exit(1);

		}).catch(err => {

			Debug.log('Authenticator', `An error has occured while refreshing the token: ${err}`);

			Electron.app.exit(1);

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
    
	if(await refreshToken() === true) {

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
						forgotPasswordPage: 'https://bolt.minezone.hu/auth/forgot-password',
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
							Debug.log('Authenticator', `An unknown error has occured during the authentication. (${authenticationResult})`);
							break;

						}

						case 'INTERNAL_ERROR':
						case 'MISSING_USERNAME':
						case 'MISSING_PASSWORD':
						case 'ONLY_IPV4': {

							errorDialogContent = 'Belső hiba lépett fel!';
							Debug.log('Authenticator', `An internal error has occured during the authentication. (${authenticationResult})`);
							break;

						}

						case 'MISMATCHING_IP': {

							errorDialogContent = 'Ez a karakter egy másik IP-címre van levédve!';
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
					break;

				}

			}

		});

	});

	authenticatorWindow.once('close', () => Electron.app.exit());

	await authenticatorWindow.loadFile(path.resolve(__dirname, '../', 'static/', 'authenticator.html')).catch(reject);
    
});