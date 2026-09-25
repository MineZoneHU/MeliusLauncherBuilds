const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_SEND_CHANNELS = new Set([
	'exit-app',
	'authenticate-with-credentials',
	'open-external-website',
	'set-setting',
	'logout',
	'launch-game',
	'request-user-data',
	'social-overlay-hide',
	'social-overlay-fetch-chat',
	'social-overlay-send-msg',
	'social-overlay-add-friend'
]);

const ALLOWED_RECEIVE_CHANNELS = new Set([
	'status-label-update',
	'status-progress-update',
	'user-data',
	'game-exit',
	'tray-game-launching',
	'trigger-logout',
	'switch-screen-tray',
	'set-user-info',
	'update-presence',
	'update-friends',
	'sync-chat'
]);

contextBridge.exposeInMainWorld('ipcRenderer', {
	on: function(channel, listener) {
		if (ALLOWED_RECEIVE_CHANNELS.has(channel)) {
			const safeListener = (event, ...args) => listener(event, ...args);
			return ipcRenderer.on(channel, safeListener);
		} else {
			console.warn(`[Security] Blocked unauthorized IPC listener on channel: ${channel}`);
		}
	},
	send: function(channel, ...args) {
		if (ALLOWED_SEND_CHANNELS.has(channel)) {
			return ipcRenderer.send(channel, ...args);
		} else {
			console.warn(`[Security] Blocked unauthorized IPC send on channel: ${channel}`);
		}
	}
});