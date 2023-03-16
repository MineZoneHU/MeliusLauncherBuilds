import * as os from 'os';
import * as child_process from 'child_process';

export const getGPUs = () : string[] => {
	switch(os.platform()) {
		default:
			throw new Error(`Unsupported platform: ${os.platform()}`);
		case 'win32':
			return child_process.execSync('wmic path win32_VideoController get name').toString().split(/(?:\r\n?|\n\r?)/g).map(line => line.trim()).filter((val, i) => i !== 0 && val !== '');
	}
};