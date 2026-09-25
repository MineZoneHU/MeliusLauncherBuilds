import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as childProcess from 'child_process';
import * as http from 'http';
import * as Electron from 'electron';
import * as ElectronUpdater from 'electron-updater';
import * as WebSocket from 'ws';
import Axios from './AxiosProxy';
import * as Authenticator from './Authenticator';
import * as Debug from './Debug';
import * as Config from './Config';
import * as Updater from './Updater';
import * as Utils from './Utils';
import * as JavaManager from './JavaManager';
import * as MCPinger from './MCPinger';
import { ServerList } from './ServerList';
import { DiscordRPC } from './DiscordRPC';
import * as TrayManager from './TrayManager';
import * as CrashReporter from './CrashReporter';
import * as HWIDManager from './HWIDManager';
import * as AntiCheat from './AntiCheat';

const MIN_ALLOCATABLE_MEMORY = 1024;
const MAX_ALLOCATABLE_MEMORY = Math.min(8, Math.ceil(os.totalmem() / Math.pow(2, 31))) * Math.pow(2, 10);
const API_URL = 'https://api.minezone.hu';
const PING_ADDRESS = 'launcher-ping.minezone.hu';

let launcherWindow : Electron.BrowserWindow;
let socialOverlayWindow : Electron.BrowserWindow = null;
let currentServerPresence : string = 'MineZone • Elérhető';
const DEFAULT_SERVER_LIST: ServerList = {
	trusted: [
		{
			name: 'MineZone Network',
			address: 'play.minezone.hu'
		}
	],
	untrusted: []
};

let serverList : ServerList = {
	trusted: [
		{
			name: 'MineZone Network',
			address: 'play.minezone.hu'
		}
	],
	untrusted: []
};
const localDeletedFriends = new Set<string>();

// eslint-disable-next-line prefer-const
let pingerTask = null; // TODO: Patch pinging
let activeClientProcess : childProcess.ChildProcess | null = null;

const fetchLatestServerList = () => new Promise<ServerList>(async (resolve, reject) => {

	let fetchedSuccessfully = false;
	let attempts = 0;

	do {

		attempts++;
		const currentToken = Authenticator.getAccessToken() || Config.get('authentication.accessToken');
		await Axios({
			method: 'POST',
			url: `${API_URL}/client/serverList`,
			headers: {
				'content-type': 'application/json'
			},
			data: JSON.stringify({
				accessToken: currentToken
			}),
			responseType: 'json',
			validateStatus: () => true
		}).then(res => {

			if(res.data?.success !== true) {

				Debug.log('Launcher', `[Error] An error occured while fetching the latest server list: ${res.data?.errorCode}`);

				return;

			}

			fetchedSuccessfully = true;

			const rawTrusted = Array.isArray(res.data.trusted) ? res.data.trusted : [];
			const fetchedUntrusted = Array.isArray(res.data.untrusted) ? res.data.untrusted : [];

			const fetchedTrusted: any[] = [];
			const seenAddresses = new Set<string>();

			// MineZone Network is always first and unique
			fetchedTrusted.push({
				name: 'MineZone Network',
				address: 'play.minezone.hu'
			});
			seenAddresses.add('play.minezone.hu');
			seenAddresses.add('212.73.137.119');

			for (const s of rawTrusted) {
				const addr = (s.address || '').toLowerCase().trim();
				if (addr && !seenAddresses.has(addr)) {
					seenAddresses.add(addr);
					fetchedTrusted.push(s);
				}
			}

			resolve({
				trusted: fetchedTrusted,
				untrusted: fetchedUntrusted
			});

		}).catch(err => {

			Debug.log('Launcher', `[Error] An error occured while fetching the latest server list: ${err}`);

		});

		if(fetchedSuccessfully) return;

		if(attempts >= 2) {
			Debug.log('Launcher', '[Warning] Falling back to default server list');
			resolve(serverList.trusted.length > 0 ? serverList : DEFAULT_SERVER_LIST);
			return;
		}

		await new Promise((resolve, reject) => setTimeout(resolve, 2 * 1000));

	} while(!fetchedSuccessfully);

});

let gameRunning = false;
let currentChatFriend: string | null = null;

function createSocialOverlayWindow() {
    if (socialOverlayWindow !== null && !socialOverlayWindow.isDestroyed()) return;

    const primaryDisplay = Electron.screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    socialOverlayWindow = new Electron.BrowserWindow({
        width: Math.min(width, 1280),
        height: Math.min(height, 780),
        center: true,
        transparent: true,
        backgroundColor: '#00000000',
        frame: false,
        alwaysOnTop: true,
        resizable: true,
        show: false,
        skipTaskbar: true,
        hasShadow: false,
        webPreferences: {
            preload: path.resolve(__dirname, '../', 'static/', 'js/', 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            devTools: false
        }
    });

    socialOverlayWindow.loadFile(path.resolve(__dirname, '../', 'static/', 'social_overlay.html'));

    socialOverlayWindow.on('closed', () => {
        socialOverlayWindow = null;
    });
}


const launchGame = () => new Promise<void>(async (resolve, reject) => {

	if(gameRunning) return;

	// Pre-launch client ban check
	try {
		const checkHwid = HWIDManager.getHWID();
		const checkUser = Authenticator.getUsername() || (Config.get('authentication.username') as string) || '';
		const banRes = await Axios({
			url: `https://zoneapi.minezone.hu/isBanned?hwid=${encodeURIComponent(checkHwid)}&username=${encodeURIComponent(checkUser)}`,
			method: 'GET',
			timeout: 3000,
			validateStatus: () => true
		});
		if (banRes.data?.isBanned) {
			const expiryText = banRes.data.expiresAt ? `Lejárat: ${new Date(banRes.data.expiresAt).toLocaleDateString('hu-HU')}` : 'Időtartam: Végleges';
			Electron.dialog.showErrorBox(
				'MineZone - Kitiltott Kliens',
				`Ez a számítógép vagy fiók ki van tiltva a MineZone szerverről!\n\nIndok: ${banRes.data.reason || 'Kliens kitiltás'}\n${expiryText}`
			);
			resolve();
			return;
		}
	} catch (_) {}

	// Anti-Cheat pre-launch verification
	const acCheck = AntiCheat.performPreLaunchCheck();
	if (!acCheck.passed) {
		await Electron.dialog.showMessageBox(launcherWindow || undefined, {
			type: 'error',
			title: 'MineZone Anti-Cheat Riasztás',
			message: 'A játék indítása biztonsági okokból megtagadva!',
			detail: `${acCheck.details}\n\nKérlek, távolítsd el a tiltott modot vagy zárd be a csalóprogramot a játék indításához!`,
			buttons: ['Rendben']
		});
		resolve();
		return;
	}

	gameRunning = true;
	TrayManager.updateTrayMenu();

	const websocketHTTPServer = http.createServer();

	websocketHTTPServer.listen();

	await (new Promise<void>((resolve, reject) => websocketHTTPServer.on('listening', resolve).on('error', reject))).catch(reject);

	const websocketServer = new WebSocket.Server({
		server: websocketHTTPServer
	});

	const websocketAuthenticationToken = crypto.randomBytes(32).toString('hex');

	let accessTokenUpdateInterval = null;
	let serverListUpdateInterval = null;
	let socialSyncInterval = null;
	let currentChatFriend: string | null = null;
	let websocketClientConnected = false;
	let filesVerificationRequested = false;
	let filesVerified = false;

	websocketServer.on('connection', async (clientSocket, req) => {

		// Multi-client support: Allow multiple game clients to connect concurrently
		// (e.g. testing with 2 accounts on the same machine)

		if(req.headers['x-authentication-token'] !== websocketAuthenticationToken) {

			clientSocket.close(0, 'Invalid authentication token');
			return;

		}

		websocketClientConnected = true;

		launcherWindow.hide();
        
		clientSocket.on('message', async (data, isBinary) => {
            
			if(isBinary) return;

			const parsedMessage = JSON.parse(data.toString());

			switch(parsedMessage?.code) {

				case 'CLIENT_INIT': {
					if (parsedMessage.username) {
						(clientSocket as any).customUsername = parsedMessage.username;
						Debug.log('Social', `Client identified as: ${parsedMessage.username}`);

						Axios({
							url: `https://zoneapi.minezone.hu/api/social/status?username=${encodeURIComponent(parsedMessage.username)}`,
							method: 'GET',
							timeout: 4000
						}).then(res => {
							if (res.data?.success && clientSocket.readyState === WebSocket.OPEN) {
								clientSocket.send(JSON.stringify({
									code: 'USER_INFO_UPDATE',
									username: parsedMessage.username,
									rank: res.data.rank || 'default',
									rankName: res.data.rankName || 'Játékos',
									rankColor: res.data.rankColor || '#94A3B8',
									status: res.data.status || ''
								}));
							}
						}).catch(() => {});
					}
					return;
				}

				case 'USER_INFO_REQUEST': {
					const myUsername = (clientSocket as any).customUsername || parsedMessage?.username || Authenticator.getUsername();
					if (myUsername) {
						Axios({
							url: `https://zoneapi.minezone.hu/api/social/status?username=${encodeURIComponent(myUsername)}`,
							method: 'GET',
							timeout: 4000
						}).then(res => {
							if (res.data?.success && clientSocket.readyState === WebSocket.OPEN) {
								clientSocket.send(JSON.stringify({
									code: 'USER_INFO_UPDATE',
									username: myUsername,
									rank: res.data.rank || 'default',
									rankName: res.data.rankName || 'Játékos',
									rankColor: res.data.rankColor || '#94A3B8',
									status: res.data.status || ''
								}));
							}
						}).catch(() => {});
					}
					return;
				}

				case 'FILES_VERIFICATION_REQUEST':
				case 'VERIFICATION_REQUEST': {

					if(filesVerificationRequested) return;

					filesVerificationRequested = true;

					filesVerified = true;

					clientSocket.send(JSON.stringify({
						code: 'VERIFICATION_STATE_UPDATE'
					}));

					serverList = await fetchLatestServerList();

					clientSocket.send(JSON.stringify({
						code: 'AUTHENTICATION_TOKEN_UPDATE',
						token: Authenticator.getAccessToken()
					}));

					try {
						const acToken = AntiCheat.generateLauncherToken(Authenticator.getUsername(), HWIDManager.getHWID());
						clientSocket.send(JSON.stringify({
							code: 'LAUNCHER_TOKEN_UPDATE',
							token: acToken,
							verifiedLauncher: true
						}));
					} catch (_) {}

					AntiCheat.startContinuousMonitoring((violation) => {
						Debug.log('Launcher', `[AntiCheat Continuous Alert] ${violation.details}`, false);

						if (violation.action === 'TERMINATED' || violation.action === 'BLOCKED') {
							Debug.log('Launcher', `[AntiCheat Kill] Terminating game client due to: ${violation.violationType}`, false);
							if (activeClientProcess) {
								try {
									if (activeClientProcess.pid) {
										childProcess.execSync(`taskkill /F /T /PID ${activeClientProcess.pid}`, { windowsHide: true });
									}
								} catch (_) {}
								try {
									activeClientProcess.kill('SIGKILL');
								} catch (_) {}
								activeClientProcess = null;
							}

							try {
								if (launcherWindow && !launcherWindow.isDestroyed()) {
									launcherWindow.show();
									launcherWindow.focus();
								}
								Electron.dialog.showErrorBox(
									'MineZone Anti-Cheat Riasztás',
									`A játék leállításra került egy biztonsági szabálysértés miatt:\n\n${violation.details}\n\nKérjük, távolítsd el a tiltott szoftvert a játék folytatásához!`
								);
							} catch (_) {}
						}
					});

					if(accessTokenUpdateInterval !== null) clearInterval(accessTokenUpdateInterval);

					accessTokenUpdateInterval = setInterval(() => {

						clientSocket.send(JSON.stringify({
							code: 'AUTHENTICATION_TOKEN_UPDATE',
							token: Authenticator.getAccessToken()
						}));

					}, .5 * 60 * 1000);

					if(serverListUpdateInterval !== null) clearInterval(serverListUpdateInterval);

					serverListUpdateInterval = setInterval(async () => {

						const latestServerList = await fetchLatestServerList();

						if(Utils.areObjectsEqual(serverList, latestServerList)) return;

						serverList = latestServerList;

						clientSocket.send(JSON.stringify({
							code: 'SERVER_LIST_UPDATE',
							servers: serverList
						}));

					}, 5000);

					if(socialSyncInterval !== null) clearInterval(socialSyncInterval);

					socialSyncInterval = setInterval(async () => {
						const myUsername = (clientSocket as any).customUsername || parsedMessage?.username || Authenticator.getUsername();
						if (!myUsername) return;

						try {
							// 1. Heartbeat
							Axios({
								url: 'https://zoneapi.minezone.hu/api/social/heartbeat',
								method: 'POST',
								data: { 
									username: myUsername,
									presence: currentServerPresence || 'MineZone • Elérhető',
									server: (currentServerPresence && currentServerPresence !== 'MineZone • Elérhető') ? currentServerPresence.replace(/^MineZone\s*[•\-]\s*/i, '').trim() : 'Elérhető'
								},
								timeout: 2000
							}).catch(() => {});

							// 2. Friends List (Pure Database Sync)
							Axios({
								url: `https://zoneapi.minezone.hu/api/social/friends?username=${encodeURIComponent(myUsername)}`,
								method: 'GET',
								timeout: 2000
							}).then(res => {
								if (res.data?.success && res.data?.friends && clientSocket.readyState === WebSocket.OPEN) {
									clientSocket.send(JSON.stringify({
										code: 'FRIENDS_LIST_UPDATE',
										friends: res.data.friends
									}));
									if (socialOverlayWindow && !socialOverlayWindow.isDestroyed()) {
										socialOverlayWindow.webContents.send('update-friends', res.data.friends);
									}
								}
							}).catch(() => {});

							// 3. Pending Friend Requests (Realtime Sync)
							Axios({
								url: `https://zoneapi.minezone.hu/api/social/requests?username=${encodeURIComponent(myUsername)}`,
								method: 'GET',
								timeout: 2000
							}).then(res => {
								if (res.data?.success && res.data?.requests && clientSocket.readyState === WebSocket.OPEN) {
									clientSocket.send(JSON.stringify({
										code: 'FRIEND_REQUESTS_UPDATE',
										requests: res.data.requests
									}));
								}
							}).catch(() => {});

							// 4. Live Chat Messages
							if (currentChatFriend) {
								Axios({
									url: `https://zoneapi.minezone.hu/api/social/messages?user1=${encodeURIComponent(myUsername)}&user2=${encodeURIComponent(currentChatFriend)}`,
									method: 'GET',
									timeout: 2000
								}).then(res => {
									if (res.data?.success && res.data?.messages && clientSocket.readyState === WebSocket.OPEN) {
										clientSocket.send(JSON.stringify({
											code: 'CHAT_SYNC_UPDATE',
											friend: currentChatFriend,
											messages: res.data.messages
										}));
										if (socialOverlayWindow && !socialOverlayWindow.isDestroyed()) {
											socialOverlayWindow.webContents.send('sync-chat', {
												friend: currentChatFriend,
												messages: res.data.messages
											});
										}
									}
								}).catch(() => {});
							}
						} catch (_) {}
					}, 1000);

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

				case 'DISCORD_PRESENCE_UPDATE': {

					const { state, serverName, serverAddress } = parsedMessage;
					if (state === 'IN_SERVER') {
						DiscordRPC.setInGameActivity(serverName, serverAddress, Authenticator.getUsername());
					} else {
						DiscordRPC.setInGameActivity(undefined, undefined, Authenticator.getUsername());
						currentServerPresence = 'MineZone • Elérhető';
						if (socialOverlayWindow && !socialOverlayWindow.isDestroyed()) {
							socialOverlayWindow.webContents.send('set-user-info', {
								username: Authenticator.getUsername(),
								activity: currentServerPresence,
								presence: currentServerPresence
							});
						}
					}
					return;

				}

				case 'SERVER_PRESENCE_UPDATE': {

					const { server, presence } = parsedMessage;
					currentServerPresence = presence || (server ? `MineZone • ${server}` : 'MineZone • Elérhető');
					if (socialOverlayWindow && !socialOverlayWindow.isDestroyed()) {
						socialOverlayWindow.webContents.send('set-user-info', {
							username: Authenticator.getUsername(),
							activity: currentServerPresence,
							presence: currentServerPresence
						});
					}
					return;

				}

				case 'SEND_CLIENT_MESSAGE': {

					const { recipient, content } = parsedMessage;
					currentChatFriend = recipient;
					const myUsername = (clientSocket as any).customUsername || parsedMessage?.username || Authenticator.getUsername();
					Debug.log('Social', `In-client message from ${myUsername} to ${recipient}: ${content}`);
					try {
						Axios({
							url: 'https://zoneapi.minezone.hu/api/social/messages/send',
							method: 'POST',
							data: {
								sender: myUsername,
								recipient,
								content
							},
							timeout: 3000
						}).then(() => {
							Axios({
								url: `https://zoneapi.minezone.hu/api/social/messages?user1=${encodeURIComponent(myUsername)}&user2=${encodeURIComponent(recipient)}`,
								method: 'GET',
								timeout: 3000
							}).then(res => {
								if (res.data?.success && res.data?.messages && clientSocket.readyState === WebSocket.OPEN) {
									clientSocket.send(JSON.stringify({
										code: 'CHAT_SYNC_UPDATE',
										friend: recipient,
										messages: res.data.messages
									}));
								}
							}).catch(() => {});
						}).catch(() => {});
					} catch (_) {}
					return;

				}

				case 'FETCH_CHAT_HISTORY': {

					const { friendName } = parsedMessage;
					currentChatFriend = friendName;
					const myUsername = (clientSocket as any).customUsername || parsedMessage?.username || Authenticator.getUsername();
					if (myUsername && friendName) {
						Axios({
							url: `https://zoneapi.minezone.hu/api/social/messages?user1=${encodeURIComponent(myUsername)}&user2=${encodeURIComponent(friendName)}`,
							method: 'GET',
							timeout: 3000
						}).then(res => {
							if (res.data?.success && res.data?.messages && clientSocket.readyState === WebSocket.OPEN) {
								clientSocket.send(JSON.stringify({
									code: 'CHAT_SYNC_UPDATE',
									friend: friendName,
									messages: res.data.messages
								}));
							}
						}).catch(() => {});
					}
					return;

				}

				case 'TOGGLE_SOCIAL_OVERLAY': {
					if (!socialOverlayWindow || socialOverlayWindow.isDestroyed()) {
						createSocialOverlayWindow();
					}
					if (socialOverlayWindow && !socialOverlayWindow.isDestroyed()) {
						if (socialOverlayWindow.isVisible()) {
							socialOverlayWindow.hide();
						} else {
							socialOverlayWindow.show();
							socialOverlayWindow.focus();
							socialOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
							socialOverlayWindow.webContents.send('set-user-info', {
								username: Authenticator.getUsername(),
								activity: currentServerPresence,
								presence: currentServerPresence
							});
						}
					}
					return;
				}

				case 'REQUEST_FRIENDS_LIST': {

					const myUsername = (clientSocket as any).customUsername || parsedMessage?.username || Authenticator.getUsername();
					Debug.log('Social', `Requested friends list for ${myUsername}`);
					try {
						Axios({
							url: `https://zoneapi.minezone.hu/api/social/friends?username=${encodeURIComponent(myUsername)}`,
							method: 'GET',
							timeout: 4000
						}).then(res => {
							if (res.data && res.data.success && res.data.friends && clientSocket.readyState === WebSocket.OPEN) {
								const validFriends = res.data.friends.filter((f: any) => !localDeletedFriends.has(f.name.toLowerCase()));
								clientSocket.send(JSON.stringify({
									code: 'FRIENDS_LIST_UPDATE',
									friends: validFriends
								}));
							}
						}).catch(() => {});
					} catch (_) {}
					return;

				}

				case 'SET_CUSTOM_STATUS': {
					const { status } = parsedMessage;
					try {
						Axios({
							url: `https://zoneapi.minezone.hu/api/social/status`,
							method: 'POST',
							data: {
								username: Authenticator.getUsername(),
								status
							},
							timeout: 4000
						}).catch(() => {});
					} catch (_) {}
					return;
				}

				case 'TOGGLE_FAVORITE_FRIEND': {
					const { friendName } = parsedMessage;
					try {
						Axios({
							url: `https://zoneapi.minezone.hu/api/social/favorite`,
							method: 'POST',
							data: {
								username: Authenticator.getUsername(),
								friendName
							},
							timeout: 4000
						}).then(() => {
							Axios({
								url: `https://zoneapi.minezone.hu/api/social/friends?username=${encodeURIComponent(Authenticator.getUsername())}`,
								method: 'GET',
								timeout: 4000
							}).then(res => {
								if (res.data && res.data.success && res.data.friends && clientSocket.readyState === WebSocket.OPEN) {
									clientSocket.send(JSON.stringify({
										code: 'FRIENDS_LIST_UPDATE',
										friends: res.data.friends
									}));
								}
							}).catch(() => {});
						}).catch(() => {});
					} catch (_) {}
					return;
				}

								case 'REMOVE_FRIEND': {
					const { friendName } = parsedMessage;
					const myUsername = (clientSocket as any).customUsername || parsedMessage?.username || Authenticator.getUsername();
					const token = Authenticator.getAccessToken();
					Debug.log('Social', `Removing friend: ${friendName} for ${myUsername}`);
					
					// 1. Immediately notify client socket
					if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
						clientSocket.send(JSON.stringify({
							code: 'FRIEND_REMOVED',
							friendName: friendName
						}));
					}

					// 2. Call remote ZoneAPI /api/social/friends/remove
					try {
						Axios({
							url: `https://zoneapi.minezone.hu/api/social/friends/remove`,
							method: 'POST',
							data: {
								username: myUsername,
								friendName
							},
							timeout: 4000
						}).catch(() => {});
					} catch (_) {}

					// 3. Call remote ZoneAPI /friendRequests/remove with Bearer token
					try {
						Axios({
							url: `https://zoneapi.minezone.hu/friendRequests/remove`,
							method: 'POST',
							headers: {
								'Authorization': `Bearer ${token}`,
								'x-access-token': token
							},
							data: {
								username: friendName
							},
							timeout: 4000
						}).then(() => {
							Axios({
								url: `https://zoneapi.minezone.hu/api/social/friends?username=${encodeURIComponent(myUsername)}`,
								method: 'GET',
								timeout: 4000
							}).then(res => {
								if (res.data && res.data.success && res.data.friends && clientSocket.readyState === WebSocket.OPEN) {
									clientSocket.send(JSON.stringify({
										code: 'FRIENDS_LIST_UPDATE',
										friends: res.data.friends
									}));
								}
							}).catch(() => {});
						}).catch(() => {});
					} catch (_) {}
					return;
				}

				case 'JUMP_TO_FRIEND': {
					const { friendName } = parsedMessage;
					Debug.log('Social', `Jump to friend server requested: ${friendName}`);
					return;
				}

				case 'REQUEST_FRIEND_REQUESTS': {
					const myUsername = (clientSocket as any).customUsername || parsedMessage?.username || Authenticator.getUsername();
					try {
						Axios({
							url: `https://zoneapi.minezone.hu/api/social/requests?username=${encodeURIComponent(myUsername)}`,
							method: 'GET',
							timeout: 4000
						}).then(res => {
							if (res.data && res.data.success && res.data.requests && clientSocket.readyState === WebSocket.OPEN) {
								clientSocket.send(JSON.stringify({
									code: 'FRIEND_REQUESTS_UPDATE',
									requests: res.data.requests
								}));
							}
						}).catch(() => {});
					} catch (_) {}
					return;
				}

												case 'ACCEPT_FRIEND_REQUEST': {
					const { fromUser } = parsedMessage;
					const myUsername = (clientSocket as any).customUsername || parsedMessage?.username || Authenticator.getUsername();
					try {
						Axios({
							url: 'https://zoneapi.minezone.hu/api/social/requests/accept',
							method: 'POST',
							data: { username: myUsername, fromUser },
							timeout: 4000
						}).then(() => {
							Axios({
								url: `https://zoneapi.minezone.hu/api/social/friends?username=${encodeURIComponent(myUsername)}`,
								method: 'GET',
								timeout: 4000
							}).then(r => {
								if (r.data?.success && r.data?.friends && clientSocket.readyState === WebSocket.OPEN) {
									clientSocket.send(JSON.stringify({ code: 'FRIENDS_LIST_UPDATE', friends: r.data.friends }));
								}
							}).catch(() => {});
							Axios({
								url: `https://zoneapi.minezone.hu/api/social/requests?username=${encodeURIComponent(myUsername)}`,
								method: 'GET',
								timeout: 4000
							}).then(r => {
								if (r.data?.success && r.data?.requests && clientSocket.readyState === WebSocket.OPEN) {
									clientSocket.send(JSON.stringify({ code: 'FRIEND_REQUESTS_UPDATE', requests: r.data.requests }));
								}
							}).catch(() => {});
						}).catch(() => {});
					} catch (_) {}
					return;
				}

				case 'DECLINE_FRIEND_REQUEST': {
					const { fromUser } = parsedMessage;
					const myUsername = (clientSocket as any).customUsername || parsedMessage?.username || Authenticator.getUsername();
					try {
						Axios({
							url: 'https://zoneapi.minezone.hu/api/social/requests/decline',
							method: 'POST',
							data: { username: myUsername, fromUser },
							timeout: 4000
						}).then(() => {
							Axios({
								url: `https://zoneapi.minezone.hu/api/social/requests?username=${encodeURIComponent(myUsername)}`,
								method: 'GET',
								timeout: 4000
							}).then(r => {
								if (r.data?.success && r.data?.requests && clientSocket.readyState === WebSocket.OPEN) {
									clientSocket.send(JSON.stringify({ code: 'FRIEND_REQUESTS_UPDATE', requests: r.data.requests }));
								}
							}).catch(() => {});
						}).catch(() => {});
					} catch (_) {}
					return;
				}

				case 'SEND_FRIEND_REQUEST': {

					const { friendName } = parsedMessage;
					const myUsername = (clientSocket as any).customUsername || parsedMessage?.username || Authenticator.getUsername();
					Debug.log('Social', `Adding friend: ${friendName} for ${myUsername}`);
					
					if (friendName) {
						localDeletedFriends.delete(friendName.toLowerCase());
					}

					Axios({
						url: `https://zoneapi.minezone.hu/api/social/friends/add`,
						method: 'POST',
						data: {
							username: myUsername,
							friendName
						},
						timeout: 4000
					}).then(res => {
						if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
							clientSocket.send(JSON.stringify({
								code: 'FRIEND_REQUEST_RESULT',
								success: true,
								message: res.data?.message || 'Barátkérelem sikeresen elküldve!'
							}));
						}

						// Refresh friends list immediately
						Axios({
							url: `https://zoneapi.minezone.hu/api/social/friends?username=${encodeURIComponent(myUsername)}`,
							method: 'GET',
							timeout: 4000
						}).then(r => {
							if (r.data && r.data.success && r.data.friends && clientSocket.readyState === WebSocket.OPEN) {
								const validFriends = r.data.friends.filter((f: any) => !localDeletedFriends.has(f.name.toLowerCase()));
								clientSocket.send(JSON.stringify({
									code: 'FRIENDS_LIST_UPDATE',
									friends: validFriends
								}));
							}
						}).catch(() => {});
					}).catch(err => {
						const errMsg = err.response?.data?.error || 'Nem sikerült elküldeni a barátkérelmet!';
						if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
							clientSocket.send(JSON.stringify({
								code: 'FRIEND_REQUEST_RESULT',
								success: false,
								error: errMsg
							}));
						}
					});
					return;

				}

			}

		});

		clientSocket.on('close', () => {

			if(socialSyncInterval !== null) clearInterval(socialSyncInterval);
			websocketClientConnected = false;

		});

	});

	// Clean old servers.dat to ensure a single, fresh, deduplicated server list on every launch
	try {
		if (process.env.GAME_FOLDER) {
			const sFiles = ['servers.dat', 'servers.dat_old', 'servers.dat.bak'];
			for (const sf of sFiles) {
				const p = path.resolve(process.env.GAME_FOLDER, sf);
				if (fs.existsSync(p)) {
					fs.unlinkSync(p);
					Debug.log('Launcher', `Deleted ${sf} for clean server list regeneration.`);
				}
			}
		}
	} catch (e) {
		Debug.log('Launcher', `Failed to clean old server list files: ${e}`);
	}

	const websocketServerURI = `ws://localhost:${(websocketServer.address() as WebSocket.AddressInfo).port}`;

	serverList = await fetchLatestServerList();

	let gameVersion = '1.21.4';
	const indexesDir = path.resolve(process.env.GAME_FOLDER, 'assets/indexes/');
	if (fs.existsSync(indexesDir) && fs.readdirSync(indexesDir).length > 0) {
		gameVersion = /^(?<version>\d+(?:\.\d+)*)\.json$/.exec(fs.readdirSync(indexesDir)[0])?.groups?.version ?? '1.21.4';
	}

	let allocMem = (Config.get('settings.clientJVMMemory') as number) || 2048;
	const freeMemMB = Math.floor(os.freemem() / (1024 * 1024));
	if (freeMemMB < allocMem + 256) {
		const safeAlloc = Math.max(1024, Math.min(allocMem, freeMemMB - 300));
		Debug.log('Launcher', `Safe memory clamp: requested ${allocMem}MB, free physical RAM is ${freeMemMB}MB. Adjusted to ${safeAlloc}MB.`);
		allocMem = safeAlloc;
	}
	const minMem = Math.min(512, Math.floor(allocMem * 0.5));

	const clientProcessArgs = [
		os.platform() === 'darwin' ? '-XstartOnFirstThread' : null,
		`-Djava.library.path=${Utils.putInQuotationMarksIfNeeded(path.relative(process.env.GAME_FOLDER, path.resolve(process.env.GAME_FOLDER, 'lib/')))}`,
		`-Dorg.lwjgl.librarypath=${Utils.putInQuotationMarksIfNeeded(path.relative(process.env.GAME_FOLDER, path.resolve(process.env.GAME_FOLDER, 'lib/')))}`,
		'-DFabricMcEmu=net.minecraft.client.main.Main',
		'-Dminecraft.launcher.brand=melius-launcher',
		`-Dminecraft.launcher.version=${ElectronUpdater.autoUpdater.currentVersion.version}`,
		`-Dminecraft.client.jar=${Utils.putInQuotationMarksIfNeeded(path.relative(process.env.GAME_FOLDER, path.resolve(process.env.GAME_FOLDER, 'client.jar')))}`,
		'-Dlog4j2.formatMsgNoLookups=true',
		'-classpath',
		[
			...Utils.collectFiles(path.resolve(process.env.GAME_FOLDER, 'libraries/')).map(filePath => path.relative(process.env.GAME_FOLDER, filePath)),
			path.relative(process.env.GAME_FOLDER, path.resolve(process.env.GAME_FOLDER, 'client.jar'))
		].map(Utils.putInQuotationMarksIfNeeded).join(path.delimiter),
		`-Xms${minMem}M`,
		`-Xmx${allocMem}M`,
		`-Xmn${Math.floor(allocMem * 0.375)}M`,
		'-XX:+UnlockExperimentalVMOptions',
		'-XX:+DisableAttachMechanism',
		'-Dminezone.anticheat=enabled',
		'-Dminezone.verified=true',
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
		gameVersion,
		'--gameDir',
		'.',
		'--assetsDir',
		Utils.putInQuotationMarksIfNeeded(path.relative(process.env.GAME_FOLDER, path.resolve(process.env.GAME_FOLDER, 'assets/'))),
		'--assetIndex',
		gameVersion,
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

	// Clean up any lingering/hung Minecraft instance from previous runs
	if (os.platform() === 'win32') {
		try {
			childProcess.execSync('powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process -Filter \\"Name = \'javaw.exe\'\\" | Where-Object { $_.CommandLine -like \'*minezone*\' } | Stop-Process -Force"', { timeout: 3000, stdio: 'ignore' });
		} catch (_) {}
	}

	let javaExec = JavaManager.getJavaExecutable();
	if (!JavaManager.isJavaReady()) {
		Debug.log('Launcher', 'Java 21 not ready before launch, setting up in background...');
		try {
			if (launcherWindow && !launcherWindow.isDestroyed()) {
				launcherWindow.webContents.send('launch-status', 'Java 21 előkészítése...');
			}
			javaExec = await JavaManager.ensureJava();
		} catch (jErr) {
			Debug.log('Launcher', `[Error] Failed to prepare Java: ${jErr}`);
		}
	}

	const totalArgsLength = clientProcessArgs.reduce((acc, a) => acc + (a ? String(a).length + 1 : 0), 0);
	let launchArgs = clientProcessArgs;

	if (totalArgsLength > 30000) {
		const argsFilePath = path.resolve(process.env.GAME_FOLDER, 'launch_args.txt');
		const formattedArgs = clientProcessArgs.map(arg => {
			const str = String(arg);
			if (str.includes(' ') && !str.startsWith('"') && !str.endsWith('"')) {
				return `"${str}"`;
			}
			return str;
		}).join(os.EOL);
		fs.writeFileSync(argsFilePath, formattedArgs, 'utf-8');
		launchArgs = [`@${argsFilePath}`];
	}

	const clientProcess = childProcess.spawn(
		javaExec,
		launchArgs,
		{
			cwd: process.env.GAME_FOLDER,
			env: clientProcessEnvironment,
			shell: false,
			detached: true
		}
	);

	activeClientProcess = clientProcess;

	const parentProcessExitListener = () => clientProcess.kill('SIGKILL');

	Electron.app.once('will-quit', parentProcessExitListener);
	process.once('exit', parentProcessExitListener);

	let stderrBuffer = '';
	const spawnStartTime = Date.now();

	clientProcess.stdout.on('data', chunk => {

		Debug.log('Launcher', chunk.toString().replace(/(?:\r\n?|\n\r?)$/, '').split(/(?:\r\n?|\n\r?)/g).map(p => `[Client process STDOUT] ${p}`).join(os.EOL), false);

	});

	clientProcess.stderr.on('data', chunk => {

		const text = chunk.toString();
		stderrBuffer += text;
		if (stderrBuffer.length > 8192) {
			stderrBuffer = stderrBuffer.substring(stderrBuffer.length - 8192);
		}
		Debug.log('Launcher', text.replace(/(?:\r\n?|\n\r?)$/, '').split(/(?:\r\n?|\n\r?)/g).map(p => `[Client process STDERR] ${p}`).join(os.EOL));

	});

	clientProcess.once('spawn', () => {

		if(clientProcess.pid !== undefined) {
			
			os.setPriority(clientProcess.pid, os.constants.priority.PRIORITY_HIGH);
		
		}

		Debug.log('Launcher', 'Client process spawned!');
		DiscordRPC.setInGameActivity(undefined, undefined, Authenticator.getUsername());

		AntiCheat.startContinuousMonitoring((violation) => {
			Debug.log('Launcher', `[AntiCheat Continuous Alert] ${violation.details}`, false);

			if (violation.action === 'TERMINATED' || violation.action === 'BLOCKED') {
				Debug.log('Launcher', `[AntiCheat Kill] Terminating game client due to: ${violation.violationType}`, false);
				if (activeClientProcess) {
					try {
						if (activeClientProcess.pid) {
							childProcess.execSync(`taskkill /F /T /PID ${activeClientProcess.pid}`, { windowsHide: true });
						}
					} catch (_) {}
					try {
						activeClientProcess.kill('SIGKILL');
					} catch (_) {}
					activeClientProcess = null;
				}

				try {
					if (launcherWindow && !launcherWindow.isDestroyed()) {
						launcherWindow.show();
						launcherWindow.focus();
					}
					Electron.dialog.showErrorBox(
						'MineZone Anti-Cheat Riasztás',
						`A játék leállításra került egy biztonsági szabálysértés miatt:\n\n${violation.details}\n\nKérjük, távolítsd el a tiltott szoftvert a játék folytatásához!`
					);
				} catch (_) {}
			}
		});

	});

	clientProcess.once('exit', exitCode => {
		activeClientProcess = null;
		AntiCheat.stopContinuousMonitoring();

		if(exitCode !== 0) {

			Debug.log('Launcher', `[Error] The client process exited with non-zero exit code ${exitCode}`);
			const runningTimeSec = (Date.now() - spawnStartTime) / 1000;
			if (runningTimeSec < 15) {
				const errorCode = CrashReporter.generateErrorCode();

				// Send full logs & specs to ZoneAPI Telemetry
				CrashReporter.sendTelemetry({
					code: errorCode,
					exitCode,
					runningTimeSec,
					stderrBuffer,
					javaExec
				});

				// Auto-recovery cleanup if Java version mismatch
				if (stderrBuffer.includes('UnsupportedClassVersionError')) {
					try { fs.rmSync(path.resolve(process.env.GAME_FOLDER, 'jre'), { recursive: true, force: true }); } catch (_) {}
				}

				// Show concise friendly dialog to player
				CrashReporter.showUserFriendlyCrashDialog(errorCode);
			}

		}

		Debug.log('Launcher', 'Client process exited!');
		DiscordRPC.setLauncherActivity();

		Electron.app.off('before-quit', parentProcessExitListener);
		process.off('exit', parentProcessExitListener);

		process.stdout.removeAllListeners('data');
		process.stderr.removeAllListeners('data');

		if(accessTokenUpdateInterval !== null) clearInterval(accessTokenUpdateInterval);
		if(serverListUpdateInterval !== null) clearInterval(serverListUpdateInterval);

		websocketServer.close();
		websocketHTTPServer.close();

		AntiCheat.stopContinuousMonitoring();

		gameRunning = false;
		TrayManager.updateTrayMenu();

		resolve();

	});

	clientProcess.once('error', err => {

		Debug.log('Launcher', `[Error] An error occured in the client process: ${err}`);

		const errorCode = CrashReporter.generateErrorCode();

		CrashReporter.sendTelemetry({
			code: errorCode,
			exitCode: null,
			runningTimeSec: 0,
			errorEvent: err,
			javaExec
		});

		CrashReporter.showUserFriendlyCrashDialog(errorCode);

		clientProcess.kill('SIGKILL');

		resolve();

	});

});

const fetchPlayerCount = () => {

	if(launcherWindow === null || gameRunning) return;

	MCPinger.ping(PING_ADDRESS, {
		timeout: 5000
	}).then(pingRes => {

		launcherWindow.webContents.send('online-count', pingRes?.players?.online);

	}).catch(err => {
		
		Debug.log('Launcher', `[Error] An error occured in the pinging process: ${err}`);

	});

};

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
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			devTools: false
		}
	});

	launcherWindow.on('close', (event) => {
		if (TrayManager.isTrayActive()) {
			event.preventDefault();
			TrayManager.hideLauncherWindow();
		}
	});

	launcherWindow.once('ready-to-show', () => {

		/*fetchPlayerCount();
		pingerTask = setInterval(fetchPlayerCount, 10 * 1000);*/

		launcherWindow.show();
		launcherWindow.focus();
        
	});

	launcherWindow.once('show', async () => {

		Debug.log('Launcher', 'Listening for launcher events...');

		if(Config.get('settings.clientJVMMemory') as number < MIN_ALLOCATABLE_MEMORY) {

			Config.set('settings.clientJVMMemory', MIN_ALLOCATABLE_MEMORY);

		} else if(Config.get('settings.clientJVMMemory') as number > MAX_ALLOCATABLE_MEMORY) {

			Config.set('settings.clientJVMMemory', MAX_ALLOCATABLE_MEMORY);

		}

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
					Config.remove('authentication.refreshToken.expiry');
					Config.remove('authentication.accessToken');
					Config.remove('authentication.accessToken.expiry');
					Config.remove('authentication.username');

					launcherWindow.hide();
					launcherWindow.close();

					launcherWindow = null;

					/*if(pingerTask !== null) {
						
						clearInterval(pingerTask);
						pingerTask = null;

					}*/

					resolve();
                    
					break;

				}

				case 'launch-game': {

					await launchGame().catch(err => {
						Debug.log('Launcher', `[Error] An error has occured in the client process: ${err}`);
					});

					launcherWindow.show();
					launcherWindow.focus();

					launcherWindow.webContents.send('game-exit');

					break;

				}

			}

		});
        
	});

	await launcherWindow.loadFile(path.resolve(__dirname, '../', 'static/', 'launcher.html')).catch(reject);
    
});

function isTrustedSender(event: Electron.IpcMainEvent): boolean {
    if (!event.sender || event.sender.isDestroyed()) return false;
    const url = event.senderFrame ? event.senderFrame.url : event.sender.getURL();
    if (!url || !url.startsWith('file://')) return false;
    const win = Electron.BrowserWindow.fromWebContents(event.sender);
    return win !== null && !win.isDestroyed();
}

Electron.ipcMain.on('social-overlay-hide', (event) => {
    if (!isTrustedSender(event)) return;
    if (socialOverlayWindow && !socialOverlayWindow.isDestroyed()) {
        socialOverlayWindow.hide();
    }
});

Electron.ipcMain.on('social-overlay-fetch-chat', (event, { friendName }) => {
    if (!isTrustedSender(event)) return;
    currentChatFriend = friendName;
    const myUsername = Authenticator.getUsername();
    if (!myUsername || !friendName) return;

    Axios({
        url: `https://zoneapi.minezone.hu/api/social/messages?user1=${encodeURIComponent(myUsername)}&user2=${encodeURIComponent(friendName)}`,
        method: 'GET',
        timeout: 3000
    }).then(res => {
        if (res.data?.success && res.data?.messages && socialOverlayWindow && !socialOverlayWindow.isDestroyed()) {
            socialOverlayWindow.webContents.send('sync-chat', {
                friend: friendName,
                messages: res.data.messages
            });
        }
    }).catch(() => {});
});

Electron.ipcMain.on('social-overlay-send-msg', (event, { recipient, content }) => {
    if (!isTrustedSender(event)) return;
    const myUsername = Authenticator.getUsername();
    if (!myUsername || !recipient || !content) return;

    Axios({
        url: 'https://zoneapi.minezone.hu/api/social/messages',
        method: 'POST',
        data: {
            sender: myUsername,
            recipient: recipient,
            content: content
        },
        timeout: 3000
    }).catch(() => {});
});

Electron.ipcMain.on('social-overlay-add-friend', (event, { friendName }) => {
    if (!isTrustedSender(event)) return;
    const myUsername = Authenticator.getUsername();
    if (!myUsername || !friendName) return;

    Axios({
        url: 'https://zoneapi.minezone.hu/api/social/friends/request',
        method: 'POST',
        data: {
            sender: myUsername,
            target: friendName
        },
        timeout: 3000
    }).catch(() => {});
});

export const getLauncherWindow = () => launcherWindow;
export const isGameRunning = () => gameRunning;
export const triggerGameLaunch = async () => {
	if(gameRunning) return;
	if (launcherWindow && !launcherWindow.isDestroyed()) {
		launcherWindow.webContents.send('tray-game-launching');
	}
	await launchGame().catch(err => {
		Debug.log('Launcher', `[Error] An error has occured in the client process: ${err}`);
	});
	if (launcherWindow && !launcherWindow.isDestroyed()) {
		launcherWindow.show();
		launcherWindow.focus();
		launcherWindow.webContents.send('game-exit');
	}
};
export const triggerLogout = () => {
	if (launcherWindow && !launcherWindow.isDestroyed()) {
		launcherWindow.webContents.send('trigger-logout');
	}
};
