import * as path from 'path';
import * as Electron from 'electron';
import * as Launcher from './Launcher';
import * as Authenticator from './Authenticator';
import * as Debug from './Debug';

let tray: Electron.Tray | null = null;
let hasShownBalloon = false;

export const isTrayActive = (): boolean => {
	return tray !== null;
};

export const showLauncherWindow = () => {
	let win = Launcher.getLauncherWindow();
	if (!win || win.isDestroyed()) {
		const allWins = Electron.BrowserWindow.getAllWindows();
		for (const w of allWins) {
			if (!w.isDestroyed()) {
				win = w;
				break;
			}
		}
	}

	if (win && !win.isDestroyed()) {
		if (win.isMinimized()) win.restore();
		win.show();
		win.setAlwaysOnTop(true);
		win.focus();
		win.setAlwaysOnTop(false);
		Debug.log('Tray', 'Restored and focused launcher window');
	} else {
		Debug.log('Tray', '[Warning] No active window found to show');
	}
};

export const hideLauncherWindow = () => {
	const win = Launcher.getLauncherWindow();
	if (win && !win.isDestroyed()) {
		win.hide();
		if (!hasShownBalloon && tray && Electron.Notification.isSupported()) {
			hasShownBalloon = true;
			try {
				if (process.platform === 'win32') {
					Electron.app.setAppUserModelId('MineZone');
				}
				new Electron.Notification({
					title: 'MineZone',
					body: 'A MineZone a háttérben fut a tálcán. Kattints az ikonra a megnyitáshoz!',
					icon: path.resolve(__dirname, '../', 'static/', 'img/', 'icon.ico')
				}).show();
			} catch (_) {}
		}
	}
};

export const toggleLauncherWindow = () => {
	const win = Launcher.getLauncherWindow();
	if (win && !win.isDestroyed()) {
		if (win.isVisible() && !win.isMinimized()) {
			hideLauncherWindow();
			return;
		}
	}
	showLauncherWindow();
};

export const openSettingsScreen = () => {
	showLauncherWindow();
	const win = Launcher.getLauncherWindow();
	if (win && !win.isDestroyed()) {
		win.webContents.send('switch-screen-tray', 'settings');
	}
};

export const updateTrayMenu = () => {
	if (!tray) return;

	let username: string | null = null;
	try {
		username = Authenticator.getUsername();
	} catch (_) {}

	let gameActive = false;
	try {
		gameActive = Launcher.isGameRunning();
	} catch (_) {}

	const menuTemplate: Electron.MenuItemConstructorOptions[] = [
		{
			label: username ? `MineZone (${username})` : 'MineZone Launcher',
			enabled: false
		},
		{ type: 'separator' },
		{
			label: 'MineZone megnyitása',
			click: () => showLauncherWindow()
		},
		{
			label: gameActive ? 'Játék folyamatban...' : 'Játék indítása',
			enabled: !gameActive,
			click: () => {
				Launcher.triggerGameLaunch();
			}
		},
		{ type: 'separator' },
		{
			label: 'Szerverek',
			submenu: [
				{
					label: 'Survival (play.minezone.hu)',
					click: () => {
						showLauncherWindow();
					}
				},
				{
					label: 'Skyblock',
					click: () => {
						showLauncherWindow();
					}
				},
				{
					label: 'Oneblock',
					click: () => {
						showLauncherWindow();
					}
				}
			]
		},
		{ type: 'separator' },
		{
			label: 'Hivatkozások',
			submenu: [
				{
					label: 'Weboldal',
					click: () => Electron.shell.openExternal('https://minezone.hu')
				},
				{
					label: 'Bolt',
					click: () => Electron.shell.openExternal('https://bolt.minezone.hu')
				},
				{
					label: 'Discord',
					click: () => Electron.shell.openExternal('https://discord.gg/minezone')
				}
			]
		},
		{ type: 'separator' },
		{
			label: 'Beállítások',
			click: () => openSettingsScreen()
		},
		{
			label: 'Kijelentkezés',
			click: () => {
				showLauncherWindow();
				Launcher.triggerLogout();
			}
		},
		{ type: 'separator' },
		{
			label: 'Kilépés',
			click: () => {
				Debug.log('Tray', 'Exiting application from tray menu');
				if (tray) {
					tray.destroy();
					tray = null;
				}
				Electron.app.exit(0);
				process.exit(0);
			}
		}
	];

	const contextMenu = Electron.Menu.buildFromTemplate(menuTemplate);
	tray.setContextMenu(contextMenu);
};

export const initTray = () => {
	if (tray) return;

	try {
		const iconPath = path.resolve(__dirname, '../', 'static/', 'img/', 'icon.ico');
		tray = new Electron.Tray(iconPath);
		tray.setToolTip('MineZone Launcher');

		updateTrayMenu();

		tray.on('click', () => {
			toggleLauncherWindow();
		});

		tray.on('double-click', () => {
			showLauncherWindow();
		});

		Debug.log('Tray', 'System tray initialized successfully');
	} catch (err) {
		Debug.log('Tray', `[Error] Failed to initialize system tray: ${err}`);
	}
};

export const destroyTray = () => {
	if (tray) {
		tray.destroy();
		tray = null;
	}
};
