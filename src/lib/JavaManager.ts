import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import * as childProcess from 'child_process';
import * as Debug from './Debug';
import AdmZip = require('adm-zip');

// High-speed direct origin mirror, official CDN, and Adoptium fallback
const JRE_DIRECT_URL = 'http://87.229.84.104/jre/jre-21-windows-x64.zip';
const JRE_CDN_URL = 'https://cdn.minezone.hu/jre/jre-21-windows-x64.zip';
const JRE_FALLBACK_URL = 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse';

let cachedSystemJava21: string | null = null;
let systemJavaChecked = false;

/**
 * Checks if a given Java binary exists and reports version 21.
 */
export const checkJavaVersion = (javaBinPath: string): number | null => {
	try {
		if (!javaBinPath || !fs.existsSync(javaBinPath)) return null;

		// javaw.exe on Windows doesn't pipe output to stdio without an attached console,
		// so if testing javaw.exe, test java.exe in the same directory if available
		let testBin = javaBinPath;
		if (os.platform() === 'win32' && path.basename(javaBinPath).toLowerCase() === 'javaw.exe') {
			const siblingJava = path.resolve(path.dirname(javaBinPath), 'java.exe');
			if (fs.existsSync(siblingJava)) {
				testBin = siblingJava;
			}
		}

		const res = childProcess.spawnSync(testBin, ['-version'], {
			encoding: 'utf-8',
			timeout: 2500,
			windowsHide: true
		});

		const output = ((res.stderr || '') + (res.stdout || '')).trim();
		const match = output.match(/version\s+["']?(\d+)/i) || output.match(/build\s+(\d+)/i) || output.match(/openjdk\s+(\d+)/i);
		if (match) {
			const major = parseInt(match[1], 10);
			return isNaN(major) ? null : major;
		}
	} catch (_) {}
	return null;
};

/**
 * Scans the host system for an existing, installed Java 21 runtime.
 */
export const findSystemJava21 = (): string | null => {
	if (systemJavaChecked) {
		return cachedSystemJava21;
	}
	systemJavaChecked = true;

	const candidates: string[] = [];
	const isWin = os.platform() === 'win32';
	const binName = isWin ? 'javaw.exe' : 'java';

	// 1. JAVA_HOME environment variable
	if (process.env.JAVA_HOME) {
		const envBin = path.resolve(process.env.JAVA_HOME, 'bin', binName);
		if (fs.existsSync(envBin)) candidates.push(envBin);
	}

	// 2. PATH search via where.exe (Windows) or which (Unix)
	try {
		const cmd = isWin ? 'where.exe javaw 2>nul || where.exe java 2>nul' : 'which java 2>/dev/null';
		const out = childProcess.execSync(cmd, { encoding: 'utf-8', timeout: 2000, windowsHide: true });
		for (const line of out.split(/\r?\n/)) {
			const p = line.trim();
			if (p && !candidates.includes(p)) {
				candidates.push(p);
			}
		}
	} catch (_) {}

	// 3. Common Java 21 install paths on Windows
	if (isWin) {
		const rootDirs = [
			process.env['ProgramFiles'],
			process.env['ProgramFiles(x86)'],
			process.env['LOCALAPPDATA'],
			'C:\\Program Files',
			'C:\\Program Files (x86)'
		].filter(Boolean) as string[];

		const commonSubDirs = [
			'Common Files\\Oracle\\Java\\javapath',
			'Eclipse Adoptium',
			'Java',
			'BellSoft',
			'Zulu',
			'Microsoft',
			'Amazon Corretto'
		];

		for (const root of rootDirs) {
			for (const sub of commonSubDirs) {
				const fullDir = path.resolve(root, sub);
				if (!fs.existsSync(fullDir)) continue;

				// Check direct bin
				const directBin = path.resolve(fullDir, binName);
				if (fs.existsSync(directBin) && !candidates.includes(directBin)) {
					candidates.push(directBin);
				}

				// Check 1-level subdirectories (e.g. Eclipse Adoptium/jdk-21.0.x-hotspot/bin/javaw.exe)
				try {
					const entries = fs.readdirSync(fullDir);
					for (const entry of entries) {
						const subBin = path.resolve(fullDir, entry, 'bin', binName);
						if (fs.existsSync(subBin) && !candidates.includes(subBin)) {
							candidates.push(subBin);
						}
					}
				} catch (_) {}
			}
		}
	}

	// Verify each candidate with version check
	for (const cand of candidates) {
		if (checkJavaVersion(cand) === 21) {
			Debug.log('JavaManager', `Detected existing system Java 21: ${cand}`);
			cachedSystemJava21 = cand;
			return cand;
		}
	}

	return null;
};

export const getJavaExecutable = (): string => {
	// 1. Prefer bundled JRE in game folder if installed and ready
	const jreBin = path.resolve(process.env.GAME_FOLDER, 'jre', 'bin', os.platform() === 'win32' ? 'javaw.exe' : 'java');
	if (fs.existsSync(jreBin)) {
		return jreBin;
	}

	// 2. Prefer existing system Java 21 installation
	const sysJava = findSystemJava21();
	if (sysJava) {
		return sysJava;
	}

	return os.platform() === 'win32' ? 'javaw.exe' : 'java';
};

export const isJavaReady = (): boolean => {
	// Ready if bundled JRE exists
	const jreBin = path.resolve(process.env.GAME_FOLDER, 'jre', 'bin', os.platform() === 'win32' ? 'javaw.exe' : 'java');
	if (fs.existsSync(jreBin)) {
		return true;
	}

	// Ready if system Java 21 is detected
	const sysJava = findSystemJava21();
	if (sysJava) {
		return true;
	}

	return false;
};

const downloadFile = (url: string, dest: string, onProgress?: (pct: number) => void): Promise<void> => {
	return new Promise((resolve, reject) => {
		const urlObj = new URL(url);
		const isHttps = urlObj.protocol === 'https:';
		const client = isHttps ? https : http;

		const options = {
			hostname: urlObj.hostname,
			port: urlObj.port || (isHttps ? 443 : 80),
			path: urlObj.pathname + urlObj.search,
			method: 'GET',
			headers: {
				'Host': 'cdn.minezone.hu',
				'User-Agent': 'MineZoneLauncher/2.0'
			}
		};

		const req = client.request(options, res => {
			if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				return downloadFile(res.headers.location, dest, onProgress).then(resolve).catch(reject);
			}
			if (res.statusCode !== 200) {
				return reject(new Error(`HTTP ${res.statusCode} while downloading JRE`));
			}

			const total = parseInt(res.headers['content-length'] || '0', 10);
			let downloaded = 0;
			let lastPct = 0;
			const writer = fs.createWriteStream(dest);

			res.on('data', chunk => {
				downloaded += chunk.length;
				if (total > 0 && onProgress) {
					const pct = Math.min(90, Math.round((downloaded / total) * 90));
					if (pct > lastPct) {
						lastPct = pct;
						onProgress(pct);
					}
				}
			});

			res.pipe(writer);
			writer.on('finish', () => resolve());
			writer.on('error', reject);
			res.on('error', reject);
		});

		req.on('error', reject);
		req.end();
	});
};

export const ensureJava = async (onProgress?: (label: string, percent: number) => void): Promise<string> => {
	// 1. Check bundled JRE
	const jreBin = path.resolve(process.env.GAME_FOLDER, 'jre', 'bin', os.platform() === 'win32' ? 'javaw.exe' : 'java');
	if (fs.existsSync(jreBin)) {
		return jreBin;
	}

	// 2. Check system Java 21
	const sysJava = findSystemJava21();
	if (sysJava) {
		Debug.log('JavaManager', `Using existing system Java 21: ${sysJava}`);
		if (onProgress) onProgress('Java 21 készen áll!', 100);
		return sysJava;
	}

	Debug.log('JavaManager', 'No Java 21 found, downloading portable JRE...');
	if (onProgress) onProgress('Java 21 előkészítése...', 0);

	const targetJreDir = path.resolve(process.env.GAME_FOLDER, 'jre');
	const tempZip = path.resolve(process.env.GAME_FOLDER, 'jre_temp.zip');

	if (!fs.existsSync(targetJreDir)) {
		fs.mkdirSync(targetJreDir, { recursive: true });
	}

	try {
		let downloaded = false;

		// 1st attempt: High-speed direct origin download (~75 MB/s, < 1 sec)
		try {
			Debug.log('JavaManager', `Attempting high-speed direct download: ${JRE_DIRECT_URL}`);
			await downloadFile(JRE_DIRECT_URL, tempZip, pct => {
				if (onProgress) onProgress(`Java 21 letöltése... ${pct}%`, pct);
			});
			downloaded = true;
		} catch (dirErr) {
			Debug.log('JavaManager', `Direct download failed: ${dirErr}. Trying CDN...`);
		}

		// 2nd attempt: Official CDN
		if (!downloaded) {
			try {
				Debug.log('JavaManager', `Downloading from CDN: ${JRE_CDN_URL}`);
				await downloadFile(JRE_CDN_URL, tempZip, pct => {
					if (onProgress) onProgress(`Java 21 letöltése... ${pct}%`, pct);
				});
				downloaded = true;
			} catch (cdnErr) {
				Debug.log('JavaManager', `CDN download failed: ${cdnErr}. Falling back to Adoptium...`);
			}
		}

		// 3rd attempt: Adoptium fallback
		if (!downloaded) {
			await downloadFile(JRE_FALLBACK_URL, tempZip, pct => {
				if (onProgress) onProgress(`Java 21 letöltése... ${pct}%`, pct);
			});
		}

		Debug.log('JavaManager', 'Extracting JRE archive...');
		if (onProgress) onProgress('Java 21 kicsomagolása...', 92);

		const zip = new AdmZip(tempZip);
		const entries = zip.getEntries();

		for (const entry of entries) {
			let entryPath = entry.entryName;
			const slashIdx = entryPath.indexOf('/');
			if (slashIdx !== -1) {
				entryPath = entryPath.substring(slashIdx + 1);
			}
			if (!entryPath) continue;

			const fullTarget = path.resolve(targetJreDir, entryPath);
			if (entry.isDirectory) {
				fs.mkdirSync(fullTarget, { recursive: true });
			} else {
				fs.mkdirSync(path.dirname(fullTarget), { recursive: true });
				fs.writeFileSync(fullTarget, entry.getData());
			}
		}

		if (fs.existsSync(tempZip)) {
			fs.unlinkSync(tempZip);
		}

		Debug.log('JavaManager', 'Java 21 successfully installed in background!');
		if (onProgress) onProgress('Java 21 készen áll!', 100);

		return jreBin;
	} catch (err) {
		Debug.log('JavaManager', `[Error] Failed to install JRE: ${err}`);
		if (fs.existsSync(tempZip)) {
			try { fs.unlinkSync(tempZip); } catch (_) {}
		}
		// Fallback to system java if JRE download fails
		return os.platform() === 'win32' ? 'javaw.exe' : 'java';
	}
};
