import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as childProcess from 'child_process';
import * as http from 'http';
import * as Electron from 'electron';
import * as ElectronUpdater from 'electron-updater';
import * as WebSocket from 'ws';
import * as Authenticator from './Authenticator';
import * as Debug from './Debug';
import * as Request from './Request';
import * as Config from './Config';
import * as Updater from './Updater';
import * as Utils from './Utils';
import { ServerList } from './ServerList';

const MAX_ALLOCATABLE_MEMORY = Math.min(4, Math.floor(os.totalmem() / Math.pow(2, 31))) * Math.pow(2, 10);
const AUTH_URL = 'https://melius-api.minezone.hu';

let launcherWindow : Electron.BrowserWindow;
let serverList : ServerList = { trusted: [], untrusted: [] };

const fetchLatestServerList = () => new Promise<ServerList>(async (resolve, reject) => {

	let fetchedSuccessfully = false;

	do {

		await Request.request(`${AUTH_URL}/client/serverList`, {
			rejectUnauthorized: false,
			method: 'POST',
			data: JSON.stringify({
				accessToken: Config.get('authentication.accessToken')
			}),
			headers: {
				'Content-Type': 'application/json'
			}
		}).then(res => {

			const parsedBody = JSON.parse(res.body.toString());

			if(parsedBody?.success !== true) {

				Debug.log('Launcher', `[Error] An error occured while fetching the latest server list: ${parsedBody.errorCode}`);

				return;

			}

			fetchedSuccessfully = true;

			resolve(parsedBody);

		}).catch(err => {

			Debug.log('Launcher', `[Error] An error occured while fetching the latest server list: ${err}`);

		});

		await new Promise((resolve, reject) => setTimeout(resolve, 3 * 1000));

	} while(!fetchedSuccessfully);

});

const putInQuotationMarksIfNeeded = (input : string) : string => /\s/.test(input) ? `"${input}"` : input;

let gameRunning = false;

const launchGame = () => new Promise<void>(async (resolve, reject) => {

	if(gameRunning) return;

	gameRunning = true;

	const websocketHTTPServer = http.createServer();

	websocketHTTPServer.listen();

	await (new Promise<void>((resolve, reject) => websocketHTTPServer.on('listening', resolve).on('error', reject))).catch(reject);

	const websocketServer = new WebSocket.Server({
		server: websocketHTTPServer
	});

	const websocketAuthenticationToken = crypto.randomBytes(32).toString('hex');

	let accessTokenUpdateInterval = null;
	let serverListUpdateInterval = null;
	let websocketClientConnected = false;
	let filesVerificationRequested = false;
	let filesVerified = false;

	websocketServer.on('connection', async (clientSocket, req) => {

		if(websocketClientConnected) {

			clientSocket.close(0, 'A client has already connected');
			return;

		}

		if(req.headers['x-authentication-token'] !== websocketAuthenticationToken) {

			clientSocket.close(0, 'Invalid authentication token');
			return;

		}

		websocketClientConnected = true;

		// launcherWindow.hide(); // TODO: only hide launcher when the client is ready (requires frontend implementation)
        
		clientSocket.on('message', async (data, isBinary) => {
            
			if(isBinary) return;

			const parsedMessage = JSON.parse(data.toString());

			switch(parsedMessage?.code) {

				case 'VERIFICATION_REQUEST': {

					if(filesVerificationRequested) return;

					filesVerificationRequested = true;

					const gameFilesAreValid = await Updater.verifyGameFiles();

					if(!gameFilesAreValid) {

						clientProcess.kill('SIGKILL');

						clientSocket.send(JSON.stringify({
							code: 'CLIENT_STOP_REQUEST'
						}));

						return;
							
					}

					filesVerified = true;

					clientSocket.send(JSON.stringify({
						code: 'VERIFICATION_STATE_UPDATE'
					}));

					let latestServerList = await fetchLatestServerList();

					clientSocket.send(JSON.stringify({
						code: 'SERVER_LIST_UPDATE',
						servers: serverList
					}));

					if(accessTokenUpdateInterval !== null) clearInterval(accessTokenUpdateInterval);

					accessTokenUpdateInterval = setInterval(() => {

						clientSocket.send(JSON.stringify({
							code: 'AUTHENTICATION_TOKEN_UPDATE',
							token: Authenticator.getAccessToken()
						}));

					}, .5 * 60 * 1000);

					if(serverListUpdateInterval !== null) clearInterval(serverListUpdateInterval);

					serverListUpdateInterval = setInterval(async () => {

						latestServerList = await fetchLatestServerList();

						if(JSON.stringify(serverList) === JSON.stringify(latestServerList)) return;

						serverList = latestServerList;

						clientSocket.send(JSON.stringify({
							code: 'SERVER_LIST_UPDATE',
							servers: serverList
						}));

					}, 5000);

					return;

				}

				case 'AUTHENTICATION_TOKEN_REQUEST': {

					if(!filesVerified) return;

					clientSocket.send(JSON.stringify({
						code: 'AUTHENTICATION_TOKEN_UPDATE',
						token: Authenticator.getAccessToken()
					}));

					return;

				}

				case 'SERVER_LIST_REQUEST': {

					if(!filesVerified) return;

					clientSocket.send(JSON.stringify({
						code: 'SERVER_LIST_UPDATE',
						servers: serverList
					}));

					return;

				}

			}

		});

		clientSocket.on('close', () => {

			websocketClientConnected = false;

		});

	});

	const websocketServerURI = `ws://localhost:${(websocketServer.address() as WebSocket.AddressInfo).port}`;

	serverList = await fetchLatestServerList();

	const clientProcessArgs = [
		os.platform() === 'darwin' ? '-XstartOnFirstThread' : null,
		`-Djava.library.path=${putInQuotationMarksIfNeeded(path.resolve(process.env.GAME_FOLDER, 'lib/'))}`,
		`-Dorg.lwjgl.librarypath=${putInQuotationMarksIfNeeded(path.resolve(process.env.GAME_FOLDER, 'lib/'))}`,
		'-DFabricMcEmu=net.minecraft.client.main.Main',
		'-Dminecraft.launcher.brand=melius-launcher',
		`-Dminecraft.launcher.version=${ElectronUpdater.autoUpdater.currentVersion.version}`,
		`-Dminecraft.client.jar=${putInQuotationMarksIfNeeded(path.resolve(process.env.GAME_FOLDER, 'client.jar'))}`,
		'-Dlog4j2.formatMsgNoLookups=true',
		'-classpath',
		[
			...Utils.collectFiles(path.resolve(process.env.GAME_FOLDER, 'libraries/')),
			path.resolve(process.env.GAME_FOLDER, 'client.jar')
		].map(putInQuotationMarksIfNeeded).join(path.delimiter),
		`-Xms${Config.get('settings.clientJVMMemory') as number}M`,
		`-Xmx${Config.get('settings.clientJVMMemory') as number}M`,
		`-Xmn${Math.floor((Config.get('settings.clientJVMMemory') as number) * 0.375)}M`,
		'-XX:+UnlockExperimentalVMOptions',
		'-XX:+UseG1GC',
		'-XX:+AlwaysPreTouch',
		'-XX:+DisableExplicitGC',
		'-XX:+ParallelRefProcEnabled',
		'-XX:+PerfDisableSharedMem',
		'-XX:G1NewSizePercent=20',
		'-XX:G1ReservePercent=20',
		'-XX:G1HeapRegionSize=32M',
		'-XX:MaxGCPauseMillis=50',
		'-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe',
		'net.fabricmc.loader.impl.launch.knot.KnotClient',
		'--username',
		Authenticator.getUsername(),
		'--uuid',
		Authenticator.generateUUID(),
		'--version',
		'1.18.1',
		'--gameDir',
		putInQuotationMarksIfNeeded(process.env.GAME_FOLDER),
		'--assetsDir',
		putInQuotationMarksIfNeeded(path.resolve(process.env.GAME_FOLDER, 'assets/')),
		'--assetIndex',
		'1.18',
		'--userType',
		'mojang',
		'--versionType',
		'release'
	].filter(arg => arg !== null);

	const clientProcessEnvironment : NodeJS.ProcessEnv = {
		WEBSOCKET_SERVER_URI: websocketServerURI,
		WEBSOCKET_AUTHENTICATION_TOKEN: websocketAuthenticationToken
	};

	if(Config.get('developerMode') === true) {
		clientProcessEnvironment.DEVELOPER_MODE = '';
	}

	const clientProcess = childProcess.spawn(
		putInQuotationMarksIfNeeded(path.resolve(process.env.GAME_FOLDER, 'jre/', 'bin/', os.platform() === 'win32' ? 'javaw.exe' : 'java')),
		clientProcessArgs,
		{
			cwd: process.env.GAME_FOLDER,
			env: clientProcessEnvironment,
			shell: true,
			detached: true
		}
	);

	const parentProcessExitListener = () => clientProcess.kill('SIGKILL');

	Electron.app.once('will-quit', parentProcessExitListener);
	process.once('exit', parentProcessExitListener);

	clientProcess.stdout.on('data', chunk => {

		Debug.log('Launcher', chunk.toString().replace(/(?:\r\n?|\n\r?)$/, '').split(/(?:\r\n?|\n\r?)/g).map(p => `[Client process STDOUT] ${p}`).join(os.EOL), false);

	});

	clientProcess.stderr.on('data', chunk => {

		Debug.log('Launcher', chunk.toString().replace(/(?:\r\n?|\n\r?)$/, '').split(/(?:\r\n?|\n\r?)/g).map(p => `[Client process STDERR] ${p}`).join(os.EOL));

	});

	clientProcess.once('spawn', () => {

		if(clientProcess.pid !== undefined) {
			
			os.setPriority(clientProcess.pid, os.constants.priority.PRIORITY_HIGH);
		
		}

		Debug.log('Launcher', 'Client process spawned!');

	});

	clientProcess.once('exit', exitCode => {

		if(exitCode !== 0) {

			Debug.log('Launcher', `[Error] The client process exited with non-zero exit code ${exitCode}`);

		}

		Debug.log('Launcher', 'Client process exited!');

		Electron.app.off('before-quit', parentProcessExitListener);
		process.off('exit', parentProcessExitListener);

		process.stdout.removeAllListeners('data');
		process.stderr.removeAllListeners('data');

		if(accessTokenUpdateInterval !== null) clearInterval(accessTokenUpdateInterval);
		if(serverListUpdateInterval !== null) clearInterval(serverListUpdateInterval);

		websocketServer.close();
		websocketHTTPServer.close();

		gameRunning = false;

		resolve();

	});

	clientProcess.once('error', err => {

		Debug.log('Launcher', `[Error] An error occured in the client process: ${err}`);

		clientProcess.kill('SIGKILL');

		resolve();

	});

});

export const start = () => new Promise<void>(async (resolve, reject) => {

	launcherWindow = new Electron.BrowserWindow({
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
			devTools: false
		}
	});

	launcherWindow.once('ready-to-show', () => {

		launcherWindow.show();
		launcherWindow.focus();
        
	});

	if(Config.get('settings.clientJVMMemory') as number > MAX_ALLOCATABLE_MEMORY) {

		Config.set('settings.clientJVMMemory', MAX_ALLOCATABLE_MEMORY);

	}

	launcherWindow.once('show', async () => {

		Debug.log('Launcher', 'Listening for launcher events...');

		launcherWindow.webContents.on('ipc-message', async (event, channel, message) => {

			if(gameRunning) return;

			switch(channel) {

				case 'request-user-data': {

					launcherWindow.webContents.send('user-data', {
						minMemory: 1024,
						maxMemory: MAX_ALLOCATABLE_MEMORY,
						currentMemorySetting: Config.get('settings.clientJVMMemory'),
						username: Authenticator.getUsername(),
						profileIconSrc: `https://zoneapi.minezone.hu/head/${Authenticator.getUsername()}/64`
					});

					break;

				}

				case 'set-setting': {

					const settingName = message.name;
					let settingValue = message.value;

					switch(settingName) {

						case 'clientJVMMemory':

							settingValue = parseInt(settingValue);

							if(!isNaN(settingValue)) {
								Config.set('settings.clientJVMMemory', Math.max(Math.min(settingValue, MAX_ALLOCATABLE_MEMORY), 1024));
							}

							break;

					}

					break;

				}

				case 'logout': {

					launcherWindow.webContents.removeAllListeners('ipc-message');

					launcherWindow.removeAllListeners('close');

					Config.remove('authentication.refreshToken');
					Config.remove('authentication.accessToken');
					Config.remove('authentication.username');

					launcherWindow.hide();
					launcherWindow.close();

					resolve();
                    
					break;

				}

				case 'launch-game': {

					launcherWindow.hide();

					await launchGame().catch(err => {
						Debug.log('Launcher', `[Error] An error has occured in the client process: ${err}`);
					});

					launcherWindow.show();
					launcherWindow.focus();

					break;

				}

			}

		});
        
	});

	launcherWindow.once('close', () => Electron.app.exit());

	await launcherWindow.loadFile(path.resolve(__dirname, '../', 'static/', 'launcher.html')).catch(reject);
    
});