import * as childProcess from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as Config from './Config';
import * as Debug from './Debug';

let cachedHWID: string | null = null;

function computePhysicalWindowsHWID(): string | null {
	try {
		const psScript = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'SilentlyContinue'
$uuid = (Get-CimInstance Win32_ComputerSystemProduct).UUID
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId
$diskObj = Get-CimInstance Win32_DiskDrive | Where-Object { $_.MediaType -match 'Fixed' } | Select-Object -First 1
if (-not $diskObj) { $diskObj = Get-CimInstance Win32_DiskDrive | Select-Object -First 1 }
$disk = $diskObj.SerialNumber
$board = (Get-CimInstance Win32_BaseBoard).SerialNumber
Write-Output "$uuid|$cpu|$disk|$board"
`;
		const b64 = Buffer.from(psScript, 'utf16le').toString('base64');
		const out = childProcess.execSync(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${b64}`, {
			encoding: 'utf-8',
			timeout: 5000,
			windowsHide: true
		}).trim();

		const parts = out.split('|').map(s => s.trim()).filter(s => {
			if (!s) return false;
			const low = s.toLowerCase();
			return low !== 'default string' && low !== 'none' && !low.includes('to be filled') && low !== 'system serial number' && low !== 'o.e.m.';
		});

		if (parts.length >= 2) {
			const hash = crypto.createHash('sha256').update(parts.join(';')).digest('hex');
			return `${hash.substr(0, 8)}-${hash.substr(8, 4)}-${hash.substr(12, 4)}-${hash.substr(16, 4)}-${hash.substr(20, 12)}`;
		}
	} catch (err) {
		Debug.log('HWIDManager', `Physical HWID query failed: ${err}`, false);
	}
	return null;
}

function computeLinuxHWID(): string | null {
	try {
		if (fs.existsSync('/etc/machine-id')) {
			const id = fs.readFileSync('/etc/machine-id', 'utf-8').trim();
			if (id) {
				const hash = crypto.createHash('sha256').update(id).digest('hex');
				return `${hash.substr(0, 8)}-${hash.substr(8, 4)}-${hash.substr(12, 4)}-${hash.substr(16, 4)}-${hash.substr(20, 12)}`;
			}
		}
	} catch (_) {}
	return null;
}

function computeDarwinHWID(): string | null {
	try {
		const out = childProcess.execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf-8', timeout: 3000 });
		const match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/i.exec(out);
		if (match && match[1]) {
			const hash = crypto.createHash('sha256').update(match[1].trim()).digest('hex');
			return `${hash.substr(0, 8)}-${hash.substr(8, 4)}-${hash.substr(12, 4)}-${hash.substr(16, 4)}-${hash.substr(20, 12)}`;
		}
	} catch (_) {}
	return null;
}

export function getHWID(): string {
	if (cachedHWID) return cachedHWID;

	let hwid: string | null = null;

	// 1. Primary: Composite physical hardware fingerprint (Motherboard, CPU, Fixed Disk)
	if (process.platform === 'win32') {
		hwid = computePhysicalWindowsHWID();
	} else if (process.platform === 'linux') {
		hwid = computeLinuxHWID();
	} else if (process.platform === 'darwin') {
		hwid = computeDarwinHWID();
	}

	// 2. Secondary Fallback: Windows Registry MachineGuid
	if (!hwid && process.platform === 'win32') {
		try {
			const output = childProcess.execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
				encoding: 'utf-8',
				timeout: 2000,
				windowsHide: true
			});
			const match = /MachineGuid\s+REG_SZ\s+([a-fA-F0-9\-]+)/i.exec(output);
			if (match && match[1]) {
				hwid = match[1].trim();
			}
		} catch (err) {
			Debug.log('HWIDManager', `Registry query failed: ${err}`, false);
		}
	}

	// 3. Fallback to cached config HWID if physical detection temporarily failed
	if (!hwid) {
		try {
			const savedHwid = Config.get('system.hwid_v2') as string;
			if (savedHwid && savedHwid.trim().length > 0) {
				hwid = savedHwid.trim();
			}
		} catch (_) {}
	}

	// 4. Ultimate fallback: Hash of machine network/cpu specs or random UUID
	if (!hwid) {
		try {
			const networkInterfaces = JSON.stringify(os.networkInterfaces());
			const cpuModel = os.cpus()[0]?.model || '';
			const hostname = os.hostname();
			const hash = crypto.createHash('sha256').update(`${hostname}-${cpuModel}-${networkInterfaces}`).digest('hex');
			hwid = `${hash.substr(0, 8)}-${hash.substr(8, 4)}-${hash.substr(12, 4)}-${hash.substr(16, 4)}-${hash.substr(20, 12)}`;
		} catch (_) {
			hwid = crypto.randomBytes(16).toString('hex');
		}
	}

	cachedHWID = hwid;

	try {
		Config.set('system.hwid_v2', hwid);
		Config.set('system.hwid', hwid);
	} catch (_) {}

	Debug.log('HWIDManager', `Resolved rock-solid composite HWID: ${hwid}`, false);

	return hwid;
}

// Prefetch HWID asynchronously in background so it is ready immediately when needed
setTimeout(() => {
	try {
		getHWID();
	} catch (_) {}
}, 100);


