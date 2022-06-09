const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ipcRenderer', {
	on: function(channel, listener) {
		return ipcRenderer.on(channel, listener);
	},
	send: function(channel, ...args) {
		return ipcRenderer.send(channel, ...args);
	}
});