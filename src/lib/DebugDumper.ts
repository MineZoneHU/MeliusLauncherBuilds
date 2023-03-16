import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as child_process from 'child_process';
import Axios from 'axios';
import * as FormData from 'form-data';
import * as AdmZip from 'adm-zip';
import * as Debug from './Debug';
import * as Utils from './Utils';

export const createDump = async () => new Promise<string>(async (resolve, reject) => {

	const tmpdir = os.tmpdir();

	const debugZipPath = path.resolve(tmpdir, `debug${Date.now()}.log`);

	const debugZip = new AdmZip();

	debugZip.addFile('additional-details/', null);

	switch(os.platform()) {
		case 'darwin': {
			const dataTypes = child_process.execSync('system_profiler -listDataTypes').toString().split(/(?:\r\n?|\n\r?)/g).filter((val, i) => i !== 0 && val != '');
			for(const dataType of dataTypes) {
				Debug.log('DebugDumper', `Dumping ${dataType} informations (MacOS)...`);
				const { stdout, stderr } = child_process.spawnSync('system_profiler', [ dataType ]);
				if(stderr.length > 0) continue;
				fs.writeFileSync(`additional-details/${dataType}-dump.txt`, stdout);
			}
			break;
		}
		case 'linux': {
			for(const cmd of [ 'lscpu', 'lsmem', 'lsblk', 'lshw', 'lsipc', 'lspci', 'lsusb' ]) {
				Debug.log('DebugDumper', `Dumping ${cmd} informations (Linux)...`);
				const { stdout, stderr } = child_process.spawnSync(cmd);
				if(stderr.length > 0) continue;
				debugZip.addFile(`additional-details/${cmd}-dump.txt`, stdout);
			}
			break;
		}
		case 'win32': {
			Debug.log('DebugDumper', 'Dumping dxdiag informations (Windows)...');
			const dxdiagDumpPath = path.resolve(tmpdir, `dxdiag-dump-${Date.now()}.txt`);
			const { stdout, stderr } = child_process.spawnSync('dxdiag', [ '/whql:off', '/t', Utils.putInQuotationMarksIfNeeded(dxdiagDumpPath) ]);
			await Utils.waitForFile(dxdiagDumpPath);
			if(stderr.length === 0) debugZip.addFile('additional-details/dxdiag-dump.txt', fs.readFileSync(dxdiagDumpPath));
			fs.unlinkSync(dxdiagDumpPath);
			break;
		}
	}

	Debug.log('DebugDumper', 'Dumping debug.log...');
	const debugLogPath = path.resolve(process.env.GAME_FOLDER, 'debug.log');
	if(fs.existsSync(debugLogPath) && fs.statSync(debugLogPath).isFile()) {
		debugZip.addFile('debug.log', fs.readFileSync(debugLogPath));
	}
	
	Debug.log('DebugDumper', 'Dumping client logs...');
	const logsPath = path.resolve(process.env.GAME_FOLDER, 'logs');
	if(fs.existsSync(logsPath) && fs.statSync(logsPath).isDirectory() && fs.readdirSync(logsPath).length > 0) {
		debugZip.addFile('logs/', null);
		for(const logPath of fs.readdirSync(logsPath)) {
			if(!fs.statSync(path.resolve(logsPath, logPath)).isFile()) continue;
			debugZip.addFile(`logs/${logPath}`, fs.readFileSync(path.resolve(logsPath, logPath)));
		}
	}
	
	Debug.log('DebugDumper', 'Dumping client crash logs...');
	const crashReportsPath = path.resolve(process.env.GAME_FOLDER, 'crash-reports');
	if(fs.existsSync(crashReportsPath) && fs.statSync(crashReportsPath).isDirectory() && fs.readdirSync(crashReportsPath).length > 0) {
		debugZip.addFile('crash-reports/', null);
		for(const crashReportPath of fs.readdirSync(crashReportsPath)) {
			if(!fs.statSync(path.resolve(crashReportsPath, crashReportPath)).isFile()) continue;
			debugZip.addFile(`crash-reports/${crashReportPath}`, fs.readFileSync(path.resolve(crashReportsPath, crashReportPath)));
		}
	}

	Debug.log('DebugDumper', 'Writing debug dump zip...');
	debugZip.writeZip(debugZipPath);

	const formData = new FormData();
	formData.append('file', fs.readFileSync(debugZipPath), 'debug.zip');

	
	Debug.log('DebugDumper', 'Uploading debug dump zip...');
	Axios({
		method: 'POST',
		url: 'https://api.anonfiles.com/upload',
		data: formData,
		responseType: 'json',
		validateStatus: () => true
	}).then(res => {

		fs.unlinkSync(debugZipPath);

		if(res.status !== 200) {

			reject('NON_200_HTTP_STATUS_CODE');
			return;

		}

		if(res?.data?.status !== true) {

			reject('DATA_SUCCESS_FALSE');
			return;

		}

		if(typeof res?.data?.data?.file?.url?.short !== 'string') {

			reject('MISSING_FILE_LINK');
			return;

		}

		resolve(res.data.data.file.url.short);

	}).catch(reject);
	
});