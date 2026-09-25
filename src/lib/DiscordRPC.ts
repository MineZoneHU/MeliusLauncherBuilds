import * as net from 'net';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

export interface DiscordActivity {
	details?: string;
	state?: string;
	startTimestamp?: number;
	largeImageKey?: string;
	largeImageText?: string;
	smallImageKey?: string;
	smallImageText?: string;
	buttons?: Array<{ label: string; url: string }>;
}

export class DiscordRPC {
	private static clientId = '859367877622104066';
	private static socket: net.Socket | null = null;
	private static isConnected = false;
	private static isReady = false;
	private static startTime = Math.floor(Date.now() / 1000);
	private static currentActivity: DiscordActivity | null = null;
	private static reconnectTimer: NodeJS.Timeout | null = null;

	public static init(customClientId?: string) {
		if (customClientId) {
			this.clientId = customClientId;
		}
		this.setLauncherActivity();
		this.connect();
	}

	private static getPipePath(): string | null {
		if (os.platform() === 'win32') {
			return '\\\\.\\pipe\\discord-ipc-0';
		} else {
			const envPath = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
			for (let i = 0; i < 10; i++) {
				const pipe = path.join(envPath, `discord-ipc-${i}`);
				if (fs.existsSync(pipe)) return pipe;
			}
		}
		return null;
	}

	private static connect() {
		if (this.socket) {
			try { this.socket.destroy(); } catch (_) {}
			this.socket = null;
		}
		this.isConnected = false;
		this.isReady = false;

		const pipe = this.getPipePath();
		if (!pipe) {
			this.scheduleReconnect();
			return;
		}

		try {
			this.socket = net.connect(pipe, () => {
				this.isConnected = true;
				this.sendHandshake();
			});

			this.socket.on('data', (data: Buffer) => {
				try {
					if (data.length < 8) return;
					const opcode = data.readInt32LE(0);
					const length = data.readInt32LE(4);
					const bodyStr = data.slice(8, 8 + length).toString('utf8');
					const body = JSON.parse(bodyStr);

					if (body.evt === 'READY') {
						this.isReady = true;
						if (this.currentActivity) {
							this.sendActivity(this.currentActivity);
						}
					}
				} catch (_) {}
			});

			this.socket.on('error', () => {
				this.isConnected = false;
				this.isReady = false;
				this.scheduleReconnect();
			});

			this.socket.on('close', () => {
				this.isConnected = false;
				this.isReady = false;
				this.scheduleReconnect();
			});
		} catch (e) {
			this.scheduleReconnect();
		}
	}

	private static scheduleReconnect() {
		if (this.reconnectTimer) return;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, 10000);
	}

	private static send(opcode: number, payload: object) {
		if (!this.socket || !this.isConnected) return;
		try {
			const json = JSON.stringify(payload);
			const jsonBuffer = Buffer.from(json, 'utf8');
			const header = Buffer.alloc(8);
			header.writeInt32LE(opcode, 0);
			header.writeInt32LE(jsonBuffer.length, 4);
			this.socket.write(Buffer.concat([header, jsonBuffer]));
		} catch (_) {}
	}

	private static sendHandshake() {
		this.send(0, {
			v: 1,
			client_id: this.clientId
		});
	}

	public static updateActivity(activity: DiscordActivity) {
		this.currentActivity = activity;
		if (this.isConnected && this.isReady) {
			this.sendActivity(activity);
		}
	}

	private static sendActivity(activity: DiscordActivity) {
		const presence: any = {
			pid: process.pid,
			activity: {
				timestamps: {
					start: activity.startTimestamp || this.startTime
				}
			}
		};

		if (activity.details) presence.activity.details = activity.details;
		if (activity.state) presence.activity.state = activity.state;
		if (activity.largeImageKey) {
			presence.activity.assets = {
				large_image: activity.largeImageKey,
				large_text: activity.largeImageText || 'MineZone'
			};
		}

		this.send(1, {
			cmd: 'SET_ACTIVITY',
			args: presence,
			nonce: Math.random().toString(36).substring(2)
		});
	}

	public static setLauncherActivity() {
		this.updateActivity({
			details: 'Launcher',
			startTimestamp: this.startTime
		});
	}

	public static setInGameActivity(serverName?: string, serverAddress?: string, username?: string) {
		if (serverAddress && serverAddress.toLowerCase().includes('minezone')) {
			this.updateActivity({
				details: 'MineZone Network (play.minezone.hu)',
				state: serverName ? `Szerver: ${serverName}` : 'Játékban',
				startTimestamp: this.startTime
			});
		} else if (serverName) {
			this.updateActivity({
				details: 'Minecraft 1.21.4',
				state: `Szerver: ${serverName}`,
				startTimestamp: this.startTime
			});
		} else {
			this.updateActivity({
				details: 'Minecraft 1.21.4',
				state: 'Egyedül játszik / Főmenü',
				startTimestamp: this.startTime
			});
		}
	}
}
