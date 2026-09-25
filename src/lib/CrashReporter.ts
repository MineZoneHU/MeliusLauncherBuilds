import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as Electron from 'electron';
import Axios from './AxiosProxy';
import * as Debug from './Debug';
import * as Config from './Config';
import * as Authenticator from './Authenticator';
import * as HWIDManager from './HWIDManager';

const PRIMARY_TELEMETRY_URL = 'https://zoneapi.minezone.hu/api/telemetry/crash';
const FALLBACK_TELEMETRY_URL = 'http://100.114.102.10/api/telemetry/crash';

/**
 * Generál egy rövid, jól olvasható, 6 karakteres hibakódot (pl. MZ-7E2A)
 * Kizárjuk a könnyen összetéveszthető karaktereket (0/O, 1/I)
 */
export function generateErrorCode(): string {
	const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
	let randomPart = '';
	const bytes = crypto.randomBytes(4);
	for (let i = 0; i < 4; i++) {
		randomPart += chars[bytes[i] % chars.length];
	}
	return `MZ-${randomPart}`;
}

export interface CrashReportOptions {
	code: string;
	exitCode: number | null;
	runningTimeSec: number;
	stderrBuffer?: string;
	javaExec?: string;
	errorEvent?: Error | string;
}

/**
 * Összegyűjti és elküldi a részletes naplókat a ZoneAPI szerverre.
 * Aszinkron fut, timeouttal védve, soha nem akasztja meg a felhasználói felületet.
 */
export async function sendTelemetry(options: CrashReportOptions): Promise<void> {
	try {
		// Olvassuk be a debug.log utolsó 150 sorát, ha létezik
		let debugSnippet = '';
		try {
			const debugLogPath = path.resolve(process.env.GAME_FOLDER || '', 'debug.log');
			if (fs.existsSync(debugLogPath)) {
				const content = fs.readFileSync(debugLogPath, 'utf-8');
				const lines = content.split(/\r?\n/);
				debugSnippet = lines.slice(-150).join('\n');
			}
		} catch (_) {}

		const stderrText = options.stderrBuffer || (options.errorEvent ? String(options.errorEvent) : '');

		const payload = {
			code: options.code,
			username: Authenticator.getUsername() || (Config.get('authentication.username') as string) || 'Ismeretlen',
			hwid: HWIDManager.getHWID(),
			exitCode: options.exitCode,
			runningTimeSec: Math.round(options.runningTimeSec * 10) / 10,
			os: {
				platform: os.platform(),
				release: os.release(),
				arch: os.arch(),
				totalRamMb: Math.round(os.totalmem() / 1024 / 1024),
				freeRamMb: Math.round(os.freemem() / 1024 / 1024),
				allocatedRamMb: Config.get('settings.clientJVMMemory') || 2048,
				cpu: os.cpus()[0]?.model || 'Ismeretlen CPU'
			},
			java: {
				path: options.javaExec || 'jre-21',
				version: 'Java 21'
			},
			launcherVersion: '2.0.18',
			stderr: stderrText.slice(-16384),
			debugLogSnippet: debugSnippet.slice(-32768)
		};

		Debug.log('CrashReporter', `Sending crash telemetry (${options.code})...`);

		try {
			await Axios({
				method: 'POST',
				url: PRIMARY_TELEMETRY_URL,
				headers: { 'content-type': 'application/json' },
				data: JSON.stringify(payload),
				timeout: 4000,
				validateStatus: () => true
			});
			Debug.log('CrashReporter', 'Crash telemetry sent to primary host');
		} catch (primErr) {
			try {
				await Axios({
					method: 'POST',
					url: FALLBACK_TELEMETRY_URL,
					headers: { 'content-type': 'application/json' },
					data: JSON.stringify(payload),
					timeout: 4000,
					validateStatus: () => true
				});
				Debug.log('CrashReporter', 'Crash telemetry sent to fallback host');
			} catch (fallbackErr) {
				Debug.log('CrashReporter', `Telemetry send non-fatal error: ${fallbackErr}`);
			}
		}
	} catch (e) {
		Debug.log('CrashReporter', `Telemetry failed silently: ${e}`);
	}
}

/**
 * Megjeleníti a letisztult, rövid felhasználói hibaablakot a támogatási hibakóddal.
 * A hibakódot automatikusan a vágólapra másolja.
 */
export function showUserFriendlyCrashDialog(errorCode: string): void {
	try {
		Electron.clipboard.writeText(errorCode);
	} catch (_) {}

	const result = Electron.dialog.showMessageBoxSync({
		type: 'error',
		title: 'MineZone - Indítási hiba',
		message: 'A Minecraft elindítása sajnos sikertelen volt.',
		detail:
			`Hibakódod: ${errorCode}\n\n` +
			`A hibakódot automatikusan a vágólapra másoltuk!\n\n` +
			`Kérlek másold be ezt a kódot a MineZone ügyfélszolgálatnak (Discord hibajegyben), és a fejlesztők azonnal segítenek a hiba elhárításában!`,
		buttons: ['Értem (Kód másolva)', 'Kód másolása újra'],
		defaultId: 0,
		noLink: true
	});

	if (result === 1) {
		try {
			Electron.clipboard.writeText(errorCode);
		} catch (_) {}
	}
}
