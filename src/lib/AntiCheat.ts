import * as childProcess from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as Electron from 'electron';
import Axios from './AxiosProxy';
import * as Debug from './Debug';
import * as HWIDManager from './HWIDManager';
import * as Authenticator from './Authenticator';

const PRIMARY_TELEMETRY_HOST = 'https://zoneapi.minezone.hu';
const FALLBACK_TELEMETRY_HOST = 'http://100.114.102.10';
const TOKEN_SECRET = 'MineZoneAntiCheatSecretKey2026';

async function sendTelemetryPost(endpoint: string, data: any, timeout: number = 5000) {
	try {
		return await Axios({
			url: `${PRIMARY_TELEMETRY_HOST}${endpoint}`,
			method: 'POST',
			data,
			timeout
		});
	} catch (primaryErr) {
		return await Axios({
			url: `${FALLBACK_TELEMETRY_HOST}${endpoint}`,
			method: 'POST',
			data,
			timeout
		});
	}
}

async function sendTelemetryGet(endpointWithQuery: string, timeout: number = 4000) {
	try {
		return await Axios({
			url: `${PRIMARY_TELEMETRY_HOST}${endpointWithQuery}`,
			method: 'GET',
			timeout
		});
	} catch (primaryErr) {
		return await Axios({
			url: `${FALLBACK_TELEMETRY_HOST}${endpointWithQuery}`,
			method: 'GET',
			timeout
		});
	}
}

// Whitelist of officially approved mods (normalized base names in lowercase)
const APPROVED_MOD_KEYWORDS = [
	'immediatelyfast',
	'entityculling',
	'fabric-api',
	'ferritecore',
	'lithium',
	'meliuscore',
	'sodium',
	'cloth-config',
	'modmenu',
	'iris',
	'indium'
];

// Blacklisted mod keywords (immediate block and report)
const BLACKLISTED_MOD_PATTERNS = [
	/meteor/i,
	/wurst/i,
	/liquidbounce/i,
	/aristois/i,
	/bleachhack/i,
	/baritone/i,
	/coffee/i,
	/xray/i,
	/x-ray/i,
	/injected/i,
	/javaagent/i,
	/doomsday/i,
	/itami/i,
	/kura/i,
	/vape/i,
	/drip/i,
	/rusherhack/i,
	/futureclient/i,
	/impact/i,
	/matix/i,
	/sigma/i,
	/huzuni/i,
	/nodus/i,
	/kami/i,
	/lambda/i,
	/seppuku/i,
	/pyro/i,
	/phobos/i,
	/thunderhack/i,
	/boze/i,
	/autoclick/i,
	/clicker/i
];

// Blacklisted Windows processes (memory editors, debuggers, external clickers)
const BLACKLISTED_PROCESS_NAMES = [
	'cheatengine-x86_64.exe',
	'cheatengine-i386.exe',
	'cheatengine.exe',
	'processhacker.exe',
	'x64dbg.exe',
	'x32dbg.exe',
	'dnspy.exe',
	'artmoney.exe',
	'speedgear.exe',
	'vape.exe',
	'drip.exe',
	'slink.exe',
	'doomsday.exe',
	'mango.exe',
	'raven.exe',
	'itami.exe',
	'opautoclicker.exe',
	'speedclicker.exe',
	'gs_autoclicker.exe',
	'autoclicker.exe',
	'fastclicker.exe',
	'kura.exe'
];

// Forensic detection patterns (UserAssist, AppCompatFlags Store, AppSwitched, ShowJumpView)
const FORENSIC_PATTERNS: { name: string; pattern: RegExp }[] = [
	{ name: 'Doomsday', pattern: /doomsday/i },
	{ name: 'Vape', pattern: /vape/i },
	{ name: 'Drip', pattern: /drip(?:lite|\.gg)?/i },
	{ name: 'AutoClicker / Macro', pattern: /(?:auto.*click|clicker|speedclick|fastclick|rapidclick|tinytask|autohotkey|ahk)/i },
	{ name: 'Itami', pattern: /itami/i },
	{ name: 'Kura', pattern: /kura/i },
	{ name: 'Slinky', pattern: /slinky/i },
	{ name: 'Entropy', pattern: /entropy/i },
	{ name: 'Spearmint', pattern: /spearmint/i },
	{ name: 'Horion', pattern: /horion/i },
	{ name: 'Meteor Client', pattern: /meteor/i },
	{ name: 'RusherHack', pattern: /rusherhack/i },
	{ name: 'LiquidBounce', pattern: /liquidbounce/i },
	{ name: 'ThunderHack', pattern: /thunderhack/i },
	{ name: 'Boze', pattern: /boze/i },
	{ name: 'Wurst', pattern: /wurst/i },
	{ name: 'Aristois', pattern: /aristois/i },
	{ name: 'BleachHack', pattern: /bleachhack/i },
	{ name: 'CheatEngine / Debugger', pattern: /(?:cheatengine|processhacker|x64dbg|x32dbg|dnspy|ghidra|ida64|ida32)/i }
];

// Known cheat server domains for DNS cache forensics
const CHEAT_DOMAINS = [
	'vape.gg',
	'drip.gg',
	'entropy.club',
	'spearmint.gg',
	'kura.gg',
	'manthe.click',
	'cheatengine.org',
	'doomsdayclient.com',
	'doomsday.xyz',
	'slinky.gg',
	'meteordevelopment.com',
	'rusherhack.org',
	'liquidbounce.net',
	'boze.dev',
	'aristois.net',
	'wurstclient.net'
];

export interface AntiCheatResult {
	passed: boolean;
	violationType?: 'ILLEGAL_MOD' | 'BLACKLISTED_PROCESS' | 'INJECTED_DLL' | 'JVM_TAMPERING' | 'HASH_MISMATCH' | 'EXECUTION_FORENSICS' | 'DNS_CACHE_CHEAT' | 'AUTOCLICKER_DETECTED' | 'SCREENSHOT_CAPTURED';
	details?: string;
	action?: 'BLOCKED' | 'WARNED' | 'TERMINATED' | 'CAPTURED';
}

let screenshotTimer: NodeJS.Timeout | null = null;
let processTimer: NodeJS.Timeout | null = null;
let memoryTimer: NodeJS.Timeout | null = null;
let forensicsScanned = false;
let dnsScanned = false;
let recentClicks: number[] = [];
let lastAutoclickerAlert = 0;

/**
 * Rot13 decoder for UserAssist registry values
 */
function rot13(str: string): string {
	return str.replace(/[a-zA-Z]/g, c => {
		const code = c.charCodeAt(0);
		const base = code >= 97 ? 97 : 65;
		return String.fromCharCode(((code - base + 13) % 26) + base);
	});
}

/**
 * Generates an HMAC-SHA256 signed Anti-Cheat Launcher Token for session verification
 */
export function generateLauncherToken(username: string, hwid: string): string {
	const timestamp = Math.floor(Date.now() / 1000);
	const payload = `${username}|${hwid}|${timestamp}`;
	const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
	return `${payload}|${signature}`;
}

/**
 * Scans the .minezone/mods directory for unauthorized or blacklisted jar files.
 */
export function scanModsDirectory(): AntiCheatResult {
	try {
		const gameFolder = process.env.GAME_FOLDER || path.resolve(process.env.APPDATA || os.homedir(), '.minezone');
		const modsDir = path.resolve(gameFolder, 'mods');
		if (!fs.existsSync(modsDir)) {
			return { passed: true };
		}

		const files = fs.readdirSync(modsDir);
		const offendingFiles: string[] = [];

		for (const file of files) {
			if (!file.toLowerCase().endsWith('.jar')) continue;

			// 1. Check against blacklist regex
			for (const pattern of BLACKLISTED_MOD_PATTERNS) {
				if (pattern.test(file)) {
					offendingFiles.push(file);
					break;
				}
			}

			// 2. Check against approved keywords if not already caught
			if (!offendingFiles.includes(file)) {
				const lowerFile = file.toLowerCase();
				const isApproved = APPROVED_MOD_KEYWORDS.some(kw => lowerFile.includes(kw));
				if (!isApproved) {
					offendingFiles.push(file);
				}
			}
		}

		if (offendingFiles.length > 0) {
			const details = `Illetéktelen / nem engedélyezett mod fájl(ok) észlelve: ${offendingFiles.join(', ')}`;
			Debug.log('AntiCheat', `[VIOLATION] ${details}`, false);

			sendTelemetry('ILLEGAL_MOD', details, 'BLOCKED');

			return {
				passed: false,
				violationType: 'ILLEGAL_MOD',
				details,
				action: 'BLOCKED'
			};
		}
	} catch (err) {
		Debug.log('AntiCheat', `[Warning] Error scanning mods directory: ${err}`, false);
	}

	return { passed: true };
}

/**
 * Scans running Windows processes for blacklisted cheats/tools.
 */
// Blacklisted process patterns (regex matching for variations like AutoClicker-3.0.exe, 7Clicker, etc.)
const BLACKLISTED_PROCESS_PATTERNS = [
	/autoclick/i,
	/clicker/i,
	/speedclick/i,
	/fastclick/i,
	/rapidclick/i,
	/macro.*click/i,
	/ghostclick/i,
	/tinytask/i,
	/tinymacro/i,
	/autohotkey/i,
	/ahk2exe/i,
	/cheatengine/i,
	/cheat-engine/i,
	/cheat_engine/i,
	/processhacker/i,
	/x64dbg/i,
	/x32dbg/i,
	/dnspy/i,
	/artmoney/i,
	/speedgear/i,
	/ghidra/i,
	/ida64/i,
	/ida32/i,
	/ollydbg/i,
	/vape/i,
	/drip/i,
	/slink/i,
	/doomsday/i,
	/itami/i,
	/kura/i,
	/meteor/i,
	/rusherhack/i,
	/liquidbounce/i,
	/thunderhack/i,
	/boze/i,
	/bleachhack/i,
	/aristois/i,
	/wurst/i,
	/futureclient/i,
	/killaura/i,
	/aimassist/i,
	/triggerbot/i
];

/**
 * Scans running Windows processes for blacklisted cheats/tools.
 * Immediately terminates the cheat process if found!
 */
export function scanRunningProcesses(): AntiCheatResult {
	if (process.platform !== 'win32') return { passed: true };

	try {
		const output = childProcess.execSync('tasklist /FO CSV /NH', {
			encoding: 'utf-8',
			timeout: 3000,
			windowsHide: true
		});

		const lines = output.split('\n');
		for (const line of lines) {
			const match = /^"([^"]+)","(\d+)"/i.exec(line.trim());
			if (match && match[1]) {
				const procName = match[1].toLowerCase();
				const pid = match[2];

				// Ignore safe / unrelated programs
				if (procName.includes('cookie')) continue;

				const isBlacklisted =
					BLACKLISTED_PROCESS_NAMES.includes(procName) ||
					BLACKLISTED_PROCESS_PATTERNS.some(p => p.test(procName));

				if (isBlacklisted) {
					// 1. Instantly kill the cheat/autoclicker process!
					try {
						childProcess.execSync(`taskkill /F /PID ${pid}`, { windowsHide: true });
						Debug.log('AntiCheat', `[AntiCheat Kill] Terminated cheat process: ${procName} (PID: ${pid})`, false);
					} catch (_) {}

					const details = `Tiltott csalóprogram észlelve: ${procName} (PID: ${pid})`;
					Debug.log('AntiCheat', `[VIOLATION] ${details}`, false);

					sendTelemetry('BLACKLISTED_PROCESS', details, 'TERMINATED');

					return {
						passed: false,
						violationType: 'BLACKLISTED_PROCESS',
						details,
						action: 'TERMINATED'
					};
				}
			}
		}
	} catch (err) {
		Debug.log('AntiCheat', `[Warning] Process scan failed: ${err}`, false);
	}

	return { passed: true };
}

/**
 * Asynchronous process scanner for background continuous monitoring (never freezes the game or UI!)
 */
export function scanRunningProcessesAsync(callback: (res: AntiCheatResult) => void) {
	if (process.platform !== 'win32') return callback({ passed: true });

	childProcess.exec('tasklist /FO CSV /NH', { timeout: 5000, windowsHide: true }, (err, stdout) => {
		if (err || !stdout) return callback({ passed: true });

		const lines = stdout.split('\n');
		for (const line of lines) {
			const match = /^"([^"]+)","(\d+)"/i.exec(line.trim());
			if (match && match[1]) {
				const procName = match[1].toLowerCase();
				const pid = match[2];

				// Ignore safe / unrelated programs
				if (procName.includes('cookie')) continue;

				const isBlacklisted =
					BLACKLISTED_PROCESS_NAMES.includes(procName) ||
					BLACKLISTED_PROCESS_PATTERNS.some(p => p.test(procName));

				if (isBlacklisted) {
					try {
						childProcess.exec(`taskkill /F /PID ${pid}`, { windowsHide: true }, () => {});
						Debug.log('AntiCheat', `[AntiCheat Kill] Terminated cheat process: ${procName} (PID: ${pid})`, false);
					} catch (_) {}

					const details = `Tiltott csalóprogram észlelve: ${procName} (PID: ${pid})`;
					Debug.log('AntiCheat', `[VIOLATION] ${details}`, false);

					sendTelemetry('BLACKLISTED_PROCESS', details, 'TERMINATED');

					return callback({
						passed: false,
						violationType: 'BLACKLISTED_PROCESS',
						details,
						action: 'TERMINATED'
					});
				}
			}
		}

		return callback({ passed: true });
	});
}

/**
 * Scans loaded DLL modules in javaw.exe for injected ghost clients (Vape, Drip, etc.).
 */
export function scanLoadedModules(): AntiCheatResult {
	if (process.platform !== 'win32') return { passed: true };

	try {
		const psCmd = `$ProgressPreference = 'SilentlyContinue'; Get-Process -Name javaw -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Modules | Select-Object -ExpandProperty FileName`;
		const b64 = Buffer.from(psCmd, 'utf16le').toString('base64');
		const output = childProcess.execSync(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${b64}`, {
			encoding: 'utf-8',
			timeout: 4000,
			windowsHide: true
		});

		const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
		const suspiciousModules: string[] = [];

		for (const dllPath of lines) {
			const lower = dllPath.toLowerCase();

			// Ignore standard Windows system and driver paths
			if (lower.startsWith('c:\\windows\\system32') ||
				lower.startsWith('c:\\windows\\syswow64') ||
				lower.startsWith('c:\\windows\\winsxs')) {
				continue;
			}

			// Whitelist legitimate JVM / Minecraft native libraries that extract to Temp
			const isLegitJavaTemp =
				lower.includes('\\jna-') ||
				/jna\d+\.dll/i.test(lower) ||
				lower.includes('jna.dll') ||
				lower.includes('oshi') ||
				lower.includes('jansi') ||
				lower.includes('lwjgl') ||
				lower.includes('openal') ||
				lower.includes('glfw') ||
				lower.includes('.minecraft') ||
				lower.includes('\\runtime\\') ||
				lower.includes('\\java-runtime') ||
				lower.includes('\\jre') ||
				lower.includes('\\jdk') ||
				lower.endsWith('\\jli.dll') ||
				lower.endsWith('\\jvm.dll') ||
				lower.endsWith('\\java.dll') ||
				lower.endsWith('\\awt.dll');

			if (isLegitJavaTemp) {
				continue;
			}

			// Whitelist MineZone directory files
			if (lower.includes('.minezone') || lower.includes('minezone')) {
				continue;
			}

			// Whitelist driver store and GPU vendors
			if (lower.includes('\\driverstore\\') || lower.includes('\\nvidia') || lower.includes('\\amd') || lower.includes('\\intel')) {
				continue;
			}

			// Check for known cheat substrings
			const cheatMatch = /vape|drip|inject|kura|minemen|doomsday|slink|itami|entropy|spearmint|cheat|hack|hook/i.test(lower);

			// Check for untrusted directory injection (temp, roaming, downloads, desktop)
			const untrustedLocation =
				lower.includes('\\temp\\') ||
				lower.includes('\\tmp\\') ||
				lower.includes('\\downloads\\') ||
				lower.includes('\\desktop\\') ||
				(lower.includes('\\appdata\\roaming\\') && !lower.includes('.minezone') && !lower.includes('.minecraft'));

			if (cheatMatch || untrustedLocation) {
				suspiciousModules.push(dllPath);
			}
		}

		if (suspiciousModules.length > 0) {
			const details = `Gyanús / illetéktelen injektált DLL modul(ok) a Minecraft folyamatban: ${suspiciousModules.join('; ')}`;
			Debug.log('AntiCheat', `[VIOLATION] ${details}`, false);

			sendTelemetry('INJECTED_DLL', details, 'TERMINATED');

			return {
				passed: false,
				violationType: 'INJECTED_DLL',
				details,
				action: 'TERMINATED'
			};
		}
	} catch (err) {
		Debug.log('AntiCheat', `Module scan warning: ${err}`, false);
	}

	return { passed: true };
}

/**
 * Resolves or prepares the compiled native MemoryStringScanner binary.
 */
function getMemScanExecutable(): string | null {
	if (process.platform !== 'win32') return null;

	try {
		const appData = process.env.APPDATA || (Electron.app ? Electron.app.getPath('userData') : '');
		const targetDir = path.join(appData, 'MineZone', 'bin');
		const targetExe = path.join(targetDir, 'MineZoneMemScan.exe');

		if (fs.existsSync(targetExe)) {
			return targetExe;
		}

		if (!fs.existsSync(targetDir)) {
			fs.mkdirSync(targetDir, { recursive: true });
		}

		const candidates = [
			path.join(__dirname, '../etc/bin/MineZoneMemScan.exe'),
			path.join(process.cwd(), 'src', 'etc', 'bin', 'MineZoneMemScan.exe'),
			path.join(process.cwd(), 'build', 'etc', 'bin', 'MineZoneMemScan.exe')
		];

		for (const src of candidates) {
			if (fs.existsSync(src)) {
				fs.copyFileSync(src, targetExe);
				return targetExe;
			}
		}
	} catch (err) {
		Debug.log('AntiCheat', `Failed to prepare MineZoneMemScan.exe: ${err}`, false);
	}

	return null;
}

const MEMORY_CHEAT_SIGNATURES = [
	// Known Ghost & Injected Client signatures
	'doomsdayclient',
	'64fv7p4h2no7q',
	'addon3.json',
	'addon4.json',
	'mod_d.class',
	'doomsday.xyz',
	'doomsdayclient.com',
	'vape.gg',
	'vape v4',
	'vape lite',
	'pub.vape',
	'manthe.click',
	'drip.gg',
	'driplite',
	'drip_lite',
	'kura.gg',
	'slinky.gg',
	'entropy.club',
	'spearmint.gg',
	'itami.exe',
	'itami client',

	// Modern Fabric & Utility Cheats (1.20 - 1.21.4)
	'meteor-client',
	'meteordevelopment',
	'rusherhack',
	'liquidbounce-next',
	'liquidbounce.net',
	'thunderhack',
	'boze.dev',
	'bleachhack',
	'aristois.net',
	'wurstclient.net',
	'futureclient'
];

/**
 * Deep Memory String & Injected Module Scanner:
 * Scans committed memory regions and loaded DLLs of javaw.exe for injected ghost client signatures (Doomsday, Vape, Drip, Kura).
 * Detects cheats in both ASCII/UTF-8 and UTF-16LE Unicode even if DLL names and files are hidden or randomized!
 */
function handleScannerOutput(output: string): AntiCheatResult {
	if (!output || output === 'CLEAN' || output === 'NO_JAVAW') {
		return { passed: true };
	}

	if (output.startsWith('MASQUERADED_PROCESS:')) {
		const details = output.substring(20);
		Debug.log('AntiCheat', `[VIOLATION] ${details}`, false);
		const pidMatch = details.match(/PID\s+(\d+)/i);
		if (pidMatch && pidMatch[1]) {
			try { childProcess.execSync(`taskkill /F /PID ${pidMatch[1]}`, { windowsHide: true }); } catch (_) {}
		}
		sendTelemetry('BLACKLISTED_PROCESS', details, 'TERMINATED');
		return { passed: false, violationType: 'BLACKLISTED_PROCESS', details, action: 'TERMINATED' };
	}

	if (output.startsWith('CHEAT_PIPE:')) {
		const details = output.substring(11);
		Debug.log('AntiCheat', `[VIOLATION] ${details}`, false);
		sendTelemetry('JVM_TAMPERING', details, 'TERMINATED');
		return { passed: false, violationType: 'JVM_TAMPERING', details, action: 'TERMINATED' };
	}

	if (output.startsWith('CHEAT_DRIVER:')) {
		const details = output.substring(13);
		Debug.log('AntiCheat', `[VIOLATION] ${details}`, false);
		sendTelemetry('BLACKLISTED_PROCESS', details, 'TERMINATED');
		return { passed: false, violationType: 'BLACKLISTED_PROCESS', details, action: 'TERMINATED' };
	}

	if (output.startsWith('WEB_GUI_IN_JVM:') || output.startsWith('LOCALHOST_CHEAT_PORT:')) {
		const details = output.startsWith('WEB_GUI_IN_JVM:') ? output.substring(15) : output.substring(21);
		Debug.log('AntiCheat', `[VIOLATION] ${details}`, false);
		const pidMatch = details.match(/PID\s+(\d+)/i);
		if (pidMatch && pidMatch[1]) {
			try { childProcess.execSync(`taskkill /F /PID ${pidMatch[1]}`, { windowsHide: true }); } catch (_) {}
		}
		sendTelemetry('JVM_TAMPERING', details, 'TERMINATED');
		return { passed: false, violationType: 'JVM_TAMPERING', details, action: 'TERMINATED' };
	}

	if (output.startsWith('CHEAT_WINDOW_TITLE:')) {
		const details = output.substring(19);
		Debug.log('AntiCheat', `[VIOLATION] ${details}`, false);
		const pidMatch = details.match(/PID\s+(\d+)/i);
		if (pidMatch && pidMatch[1]) {
			try { childProcess.execSync(`taskkill /F /PID ${pidMatch[1]}`, { windowsHide: true }); } catch (_) {}
		}
		sendTelemetry('BLACKLISTED_PROCESS', details, 'TERMINATED');
		return { passed: false, violationType: 'BLACKLISTED_PROCESS', details, action: 'TERMINATED' };
	}

	if (output.startsWith('INJECTED_DLL:')) {
		const dllInfo = output.substring(13);
		const details = `Illetéktelen injektált DLL modul észlelve: ${dllInfo}`;
		Debug.log('AntiCheat', `[VIOLATION] ${details}`, false);
		sendTelemetry('INJECTED_DLL', details, 'TERMINATED');
		return { passed: false, violationType: 'INJECTED_DLL', details, action: 'TERMINATED' };
	}

	if (output.startsWith('MATCH:')) {
		const foundStrings = output.substring(6);
		const details = `Tiltott memóriastringek (Ghost Client / Doomsday) észlelve: ${foundStrings}`;
		Debug.log('AntiCheat', `[VIOLATION] ${details}`, false);

		const pidMatch = foundStrings.match(/PID\s+(\d+)/i);
		if (pidMatch && pidMatch[1]) {
			const cheatPid = pidMatch[1];
			try {
				childProcess.execSync(`taskkill /F /PID ${cheatPid}`, { windowsHide: true });
				Debug.log('AntiCheat', `[AntiCheat Kill] Terminated cheat/loader process (PID: ${cheatPid})`, false);
			} catch (_) {}
		}

		sendTelemetry('JVM_TAMPERING', details, 'TERMINATED');
		return { passed: false, violationType: 'JVM_TAMPERING', details, action: 'TERMINATED' };
	}

	return { passed: true };
}

export function scanProcessMemory(): AntiCheatResult {
	if (process.platform !== 'win32') return { passed: true };

	try {
		const nativeExe = getMemScanExecutable();
		if (!nativeExe) return { passed: true };

		const output = childProcess.execFileSync(nativeExe, [], {
			encoding: 'utf-8',
			timeout: 10000,
			windowsHide: true
		}).trim();

		return handleScannerOutput(output);
	} catch (err) {
		Debug.log('AntiCheat', `Memory scan warning: ${err}`, false);
	}

	return { passed: true };
}

/**
 * Asynchronous memory scanner for background monitoring (never blocks the UI or game threads!)
 */
export function scanProcessMemoryAsync(callback: (res: AntiCheatResult) => void) {
	if (process.platform !== 'win32') return callback({ passed: true });

	const nativeExe = getMemScanExecutable();
	if (!nativeExe) return callback({ passed: true });

	childProcess.exec(`"${nativeExe}"`, { timeout: 15000, windowsHide: true }, (err, stdout) => {
		if (err || !stdout) return callback({ passed: true });
		return callback(handleScannerOutput(stdout.trim()));
	});
}

/**
 * Scans Windows forensics (UserAssist, AppCompatFlags Store, AppSwitched, ShowJumpView)
 * for executed or self-destructed cheat software.
 * Note: Reports warning to telemetry, does not block launching.
 */
export function scanExecutionHistory(): AntiCheatResult {
	if (process.platform !== 'win32' || forensicsScanned) return { passed: true };
	forensicsScanned = true;

	try {
		const foundItems = new Set<string>();

		// 1. UserAssist (ROT13 encoded)
		try {
			const uaOut = childProcess.execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\UserAssist" /s', {
				encoding: 'utf-8',
				timeout: 3000,
				windowsHide: true
			});
			for (const line of uaOut.split('\n')) {
				const match = line.trim().match(/^([A-Za-z0-9+/=_{}-]+)\s+REG_BINARY/);
				if (match && match[1]) {
					const decoded = rot13(match[1]);
					for (const item of FORENSIC_PATTERNS) {
						if (item.pattern.test(decoded)) {
							const fileName = decoded.split('\\').pop() || decoded;
							foundItems.add(`${item.name} (${fileName})`);
						}
					}
				}
			}
		} catch (_) {}

		// 2. Compatibility Assistant Store & FeatureUsage (AppSwitched, ShowJumpView)
		const directKeys = [
			'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Compatibility Assistant\\Store',
			'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FeatureUsage\\AppSwitched',
			'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FeatureUsage\\ShowJumpView'
		];

		for (const key of directKeys) {
			try {
				const out = childProcess.execSync(`reg query "${key}"`, {
					encoding: 'utf-8',
					timeout: 2000,
					windowsHide: true
				});
				for (const line of out.split('\n')) {
					const trimmed = line.trim();
					for (const item of FORENSIC_PATTERNS) {
						if (item.pattern.test(trimmed)) {
							const entry = trimmed.split(/\s+REG_/)[0];
							const fileName = entry.split('\\').pop() || entry;
							foundItems.add(`${item.name} (${fileName})`);
						}
					}
				}
			} catch (_) {}
		}

		if (foundItems.size > 0) {
			const detectedList = Array.from(foundItems).join(', ');
			const details = `Korábban futtatott (esetleg letörölt) csalószoftver nyomai a rendszer előzményeiben: ${detectedList}`;
			Debug.log('AntiCheat', `[FORENSICS WARN] ${details}`, false);

			sendTelemetry('EXECUTION_FORENSICS', details, 'WARNED');

			return {
				passed: true, // Warning only, do not block
				violationType: 'EXECUTION_FORENSICS',
				details,
				action: 'WARNED'
			};
		}
	} catch (err) {
		Debug.log('AntiCheat', `Execution history scan warning: ${err}`, false);
	}

	return { passed: true };
}

/**
 * Scans DNS client cache for recent queries to known cheat distribution / auth domains.
 * Note: Reports warning to telemetry, does not block launching.
 */
export function scanDnsCache(): AntiCheatResult {
	if (process.platform !== 'win32' || dnsScanned) return { passed: true };
	dnsScanned = true;

	try {
		const psCmd = `$ProgressPreference = 'SilentlyContinue'; Get-DnsClientCache -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Entry`;
		const b64 = Buffer.from(psCmd, 'utf16le').toString('base64');
		const output = childProcess.execSync(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${b64}`, {
			encoding: 'utf-8',
			timeout: 3000,
			windowsHide: true
		});

		const lower = output.toLowerCase();
		const detectedDomains: string[] = [];

		for (const domain of CHEAT_DOMAINS) {
			if (lower.includes(domain)) {
				detectedDomains.push(domain);
			}
		}

		if (detectedDomains.length > 0) {
			const details = `Csaló szerver DNS feloldási nyom a memóriában: ${detectedDomains.join(', ')}`;
			Debug.log('AntiCheat', `[DNS WARN] ${details}`, false);

			sendTelemetry('DNS_CACHE_CHEAT', details, 'WARNED');

			return {
				passed: true, // Warning only
				violationType: 'DNS_CACHE_CHEAT',
				details,
				action: 'WARNED'
			};
		}
	} catch (err) {
		Debug.log('AntiCheat', `DNS scan warning: ${err}`, false);
	}

	return { passed: true };
}

/**
 * Records click events and detects unnatural rigid frequency / variance (AutoClicker).
 * Per user request: DOES NOT KICK OR TERMINATE THE CLIENT! Reports warning only.
 */
export function recordClick(timestamp: number = Date.now()) {
	recentClicks.push(timestamp);
	const cutoff = timestamp - 2000;
	recentClicks = recentClicks.filter(t => t >= cutoff);

	if (recentClicks.length >= 16) {
		const durationSec = (recentClicks[recentClicks.length - 1] - recentClicks[0]) / 1000;
		if (durationSec > 0.3) {
			const cps = (recentClicks.length - 1) / durationSec;

			const deltas: number[] = [];
			for (let i = 1; i < recentClicks.length; i++) {
				deltas.push(recentClicks[i] - recentClicks[i - 1]);
			}

			const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
			const variance = deltas.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / deltas.length;
			const stdDev = Math.sqrt(variance);

			// Unnatural machine clicks: high CPS with near-zero standard deviation
			if (cps >= 16 && stdDev <= 4.0) {
				const now = Date.now();
				if (now - lastAutoclickerAlert > 60000) {
					lastAutoclickerAlert = now;
					const details = `Gyanúsan egyenletes kattintási frekvencia (AutoClicker mintázat): CPS=${cps.toFixed(1)}, szórás=${stdDev.toFixed(2)}ms`;
					Debug.log('AntiCheat', `[AUTOCLICKER DETECTED] ${details}`, false);

					// Crucial per user requirement: action is 'WARNED', client is NOT terminated!
					sendTelemetry('AUTOCLICKER_DETECTED', details, 'WARNED');
				}
			}
		}
	}
}

/**
 * Checks for remote screenshot requests from admin dashboard and captures the screen via native Win32 BitBlt.
 */
export async function checkAndCaptureScreenshot() {
	if (process.platform !== 'win32') return;

	try {
		let username = 'Ismeretlen';
		try {
			username = Authenticator.getUsername();
		} catch (_) {}
		const hwid = HWIDManager.getHWID();

		const res: any = await sendTelemetryGet(
			`/api/telemetry/screenshot-pending?hwid=${encodeURIComponent(hwid)}&username=${encodeURIComponent(username)}`,
			4000
		);

		if (res?.data?.pending && res?.data?.requestId) {
			const requestId = res.data.requestId;
			Debug.log('AntiCheat', `[Remote Screenshot] Request received from staff (ID: ${requestId}), capturing screen via native GDI...`, true);

			const psCode = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Text;
using System.Threading;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Diagnostics;

public class SafeGameCapture {
    [DllImport("user32.dll")] public static extern IntPtr OpenDesktop(string d, uint f, bool i, uint a);
    [DllImport("user32.dll")] public static extern bool SetThreadDesktop(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
    [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetWindowDC(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr hObject, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hObjectSource, int nXSrc, int nYSrc, int dwRop);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);

    public const int SRCCOPY = 0x00CC0020;

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    public static string Capture() {
        string outcome = "ERROR";
        IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
        if (hDesk == IntPtr.Zero) return "ERROR:OPEN_DESKTOP_FAILED";

        Thread t = new Thread(() => {
            if (!SetThreadDesktop(hDesk)) {
                outcome = "ERROR:SET_THREAD_DESKTOP_FAILED";
                return;
            }

            IntPtr fg = GetForegroundWindow();
            if (fg == IntPtr.Zero) {
                outcome = "NOT_FOCUSED:NO_WINDOW";
                return;
            }

            uint pid = 0;
            GetWindowThreadProcessId(fg, out pid);
            string proc = "unknown";
            try {
                if (pid > 0) proc = Process.GetProcessById((int)pid).ProcessName.ToLower();
            } catch {}

            // Must be Minecraft (javaw or java)
            if (!proc.Contains("java") && !proc.Contains("minecraft")) {
                outcome = "NOT_FOCUSED:" + proc;
                return;
            }

            // Capture ONLY the client area (pure game rendering canvas, zero title bar, zero borders)
            RECT cr;
            if (!GetClientRect(fg, out cr)) {
                outcome = "ERROR:GET_CLIENT_RECT_FAILED";
                return;
            }

            POINT pt = new POINT();
            pt.X = 0;
            pt.Y = 0;
            ClientToScreen(fg, ref pt);

            int screenW = GetSystemMetrics(0);
            int screenH = GetSystemMetrics(1);

            int x = Math.Max(0, pt.X);
            int y = Math.Max(0, pt.Y);
            int w = cr.Right - cr.Left;
            int h = cr.Bottom - cr.Top;

            if (x + w > screenW) w = screenW - x;
            if (y + h > screenH) h = screenH - y;

            if (w <= 100 || h <= 100) {
                outcome = "ERROR:WINDOW_TOO_SMALL";
                return;
            }

            IntPtr hDesktop = GetDesktopWindow();
            IntPtr hdcSource = GetWindowDC(hDesktop);

            using (Bitmap bmp = new Bitmap(w, h)) {
                using (Graphics g = Graphics.FromImage(bmp)) {
                    IntPtr hdcDest = g.GetHdc();
                    BitBlt(hdcDest, 0, 0, w, h, hdcSource, x, y, SRCCOPY);
                    g.ReleaseHdc(hdcDest);
                }
                ReleaseDC(hDesktop, hdcSource);

                using (System.IO.MemoryStream ms = new System.IO.MemoryStream()) {
                    bmp.Save(ms, ImageFormat.Jpeg);
                    outcome = "SUCCESS:" + Convert.ToBase64String(ms.ToArray());
                }
            }
        });
        t.Start();
        t.Join();
        return outcome;
    }
}
"@ -ReferencedAssemblies System.Drawing

[SafeGameCapture]::Capture()
`;

			const captureResult = childProcess.execSync('powershell.exe -NoProfile -NonInteractive -Command -', {
				input: psCode,
				encoding: 'utf-8',
				timeout: 8000,
				windowsHide: true,
				maxBuffer: 25 * 1024 * 1024
			}).trim();

			if (captureResult.startsWith('NOT_FOCUSED:')) {
				const focusedApp = captureResult.substring(12);
				Debug.log('AntiCheat', `[Remote Screenshot] Minecraft not focused (Active: ${focusedApp}). Capture skipped for privacy.`, true);

				await sendTelemetryPost('/api/telemetry/upload-screenshot', {
					requestId,
					username,
					hwid,
					notFocused: true,
					focusedApp
				}, 10000);
				return;
			}

			if (captureResult.startsWith('SUCCESS:')) {
				const imageBase64 = captureResult.substring(8);
				await sendTelemetryPost('/api/telemetry/upload-screenshot', {
					requestId,
					username,
					hwid,
					imageBase64
				}, 15000);

				Debug.log('AntiCheat', `[Remote Screenshot] Successfully uploaded game-only capture (${imageBase64.length} chars)`, true);
			} else {
				Debug.log('AntiCheat', `[Remote Screenshot] Capture failed or unexpected result: ${captureResult}`, true);
			}
		}
	} catch (err) {
		Debug.log('AntiCheat', `Screenshot check warning: ${err}`, true);
	}
}

let isContinuousMonitoringActive = false;

export function startContinuousMonitoring(onViolation?: (res: AntiCheatResult) => void) {
	if (isContinuousMonitoringActive) return;
	isContinuousMonitoringActive = true;

	// 0. Azonnali kezdeti ellenőrzés (ne kelljen várni 60-90 mp-et az első lefutásig)
	scanRunningProcessesAsync((procResult) => {
		if (!procResult.passed && onViolation) onViolation(procResult);
	});
	scanProcessMemoryAsync((memResult) => {
		if (!memResult.passed && onViolation) onViolation(memResult);
	});

	// 1. Remote screenshot check (45 mp)
	screenshotTimer = setInterval(() => {
		checkAndCaptureScreenshot().catch(() => {});
	}, 45 * 1000);

	// 2. Gyors folyamat- és csalóprogram-ellenőrzés (15 másodpercenként)
	processTimer = setInterval(() => {
		scanRunningProcessesAsync((procResult) => {
			if (!procResult.passed && onViolation) {
				onViolation(procResult);
			}
		});
	}, 15 * 1000);

	// 3. Memória, Web GUI, Injektált DLL és Maszkolt folyamatok ellenőrzése (35 másodpercenként)
	memoryTimer = setInterval(() => {
		scanProcessMemoryAsync((res) => {
			if (!res.passed && onViolation) {
				onViolation(res);
			}
		});
	}, 35 * 1000);
}

export function stopContinuousMonitoring() {
	isContinuousMonitoringActive = false;
	if (screenshotTimer !== null) {
		clearInterval(screenshotTimer);
		screenshotTimer = null;
	}
	if (processTimer !== null) {
		clearInterval(processTimer);
		processTimer = null;
	}
	if (memoryTimer !== null) {
		clearInterval(memoryTimer);
		memoryTimer = null;
	}
}

/**
 * Sends anti-cheat violation telemetry to ZoneAPI.
 */
export async function sendTelemetry(
	violationType: 'ILLEGAL_MOD' | 'BLACKLISTED_PROCESS' | 'INJECTED_DLL' | 'JVM_TAMPERING' | 'HASH_MISMATCH' | 'EXECUTION_FORENSICS' | 'DNS_CACHE_CHEAT' | 'AUTOCLICKER_DETECTED' | 'SCREENSHOT_CAPTURED',
	details: string,
	action: 'BLOCKED' | 'WARNED' | 'TERMINATED' | 'CAPTURED'
) {
	try {
		let username = 'Ismeretlen';
		try {
			username = Authenticator.getUsername();
		} catch (_) {}

		const hwid = HWIDManager.getHWID();

		await sendTelemetryPost('/api/telemetry/anticheat', {
			username,
			hwid,
			violationType,
			details,
			action
		}, 5000);

		Debug.log('AntiCheat', `Sent telemetry: ${violationType} [${action}] (${details})`, false);
	} catch (err) {
		Debug.log('AntiCheat', `Failed to send telemetry: ${err}`, false);
	}
}

/**
 * Full pre-launch check before starting Minecraft:
 * 1. Mods folder integrity
 * 2. Running processes
 * 3. Windows execution history forensics
 * 4. DNS cache forensics
 */
export function performPreLaunchCheck(): AntiCheatResult {
	// 1. Mod directory integrity
	const modCheck = scanModsDirectory();
	if (!modCheck.passed) return modCheck;

	// 2. Running processes & clickers
	const procCheck = scanRunningProcesses();
	if (!procCheck.passed) return procCheck;

	// 3. Masquerading, kernel drivers, named pipes, and cheat processes
	const sysCheck = scanProcessMemory();
	if (!sysCheck.passed) return sysCheck;

	// 4. Forensics (warning only)
	scanExecutionHistory();

	// 5. DNS Cache (warning only)
	scanDnsCache();

	return { passed: true };
}
