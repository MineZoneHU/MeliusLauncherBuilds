import * as os from 'os';
import * as child_process from 'child_process';

export const getGPUs = () : string[] => {
	switch(os.platform()) {
		default:
			return [];
		case 'win32':
			try {
				// Try WMIC if available (legacy Windows 10 / earlier Win 11)
				const wmicOutput = child_process.execSync('wmic path win32_VideoController get name', {
					timeout: 2500,
					stdio: ['ignore', 'pipe', 'ignore'],
					windowsHide: true
				}).toString().split(/(?:\r\n?|\n\r?)/g).map(line => line.trim()).filter((val, i) => i !== 0 && val !== '');
				if (wmicOutput.length > 0) return wmicOutput;
			} catch (_) {}

			try {
				// Fallback to PowerShell Get-CimInstance on Windows 11 (where WMIC is removed)
				const psOutput = child_process.execSync('powershell.exe -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_VideoController).Name"', {
					timeout: 4000,
					stdio: ['ignore', 'pipe', 'ignore'],
					windowsHide: true
				}).toString().split(/(?:\r\n?|\n\r?)/g).map(line => line.trim()).filter(val => val !== '');
				if (psOutput.length > 0) return psOutput;
			} catch (_) {}

			return ['Alapértelmezett videokártya'];
	}
};