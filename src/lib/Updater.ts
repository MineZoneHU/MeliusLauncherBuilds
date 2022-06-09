import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as stream from 'stream';
import * as Electron from 'electron';
import * as ElectronUpdater from 'electron-updater';
import * as Debug from './Debug';
import * as Request from './Request';
import * as Hasher from './Hasher';
import * as Config from './Config';
import { GameFilesIndex } from './GameFilesIndex';
import { ComparedGameFilesIndexes } from './ComparedGameFilesIndexes';

const CLIENT_CDN_URL = 'https://melius-client-cdn.minezone.hu';

let updaterWindow : Electron.BrowserWindow;

let latestGameFilesIndex : GameFilesIndex;

ElectronUpdater.autoUpdater.setFeedURL({
	provider: 'github',
	owner: 'MineZoneHU',
	repo: 'MeliusLauncherBuilds'
});
ElectronUpdater.autoUpdater.autoDownload = false;

const byteUnits = [{
	suffix: 'B',
	divisor: 1
}, {
	suffix: 'KB',
	divisor: 1_000
}, {
	suffix: 'MB',
	divisor: 1_000_000
}, {
	suffix: 'GB',
	divisor: 1_000_000_000
}, {
	suffix: 'TB',
	divisor: 1_000_000_000_000
}, {
	suffix: 'PB',
	divisor: 1_000_000_000_000_000
}];

const bytesToHuman = (bytes : number, decimalPrecision = 0) => {

	let unit = byteUnits[0];

	for(let i = 0; i < byteUnits.length; i++) {
		if(byteUnits[i].divisor < bytes) continue;
		if(i > 0) unit = byteUnits[i - 1];
		break;
	}

	return `${(bytes / unit.divisor).toFixed(decimalPrecision)} ${unit.suffix}`;

};

const isSubpath = (parentPath : string, subPath : string) : boolean => {
	const relativePath = path.relative(parentPath, subPath);
	return relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
};

const isGameFile = (path : string) => isSubpath(process.env.GAME_FOLDER, path);

export const collectFiles = (dirPath : string) : string[] => {

	if(!fs.existsSync(dirPath)) return [];

	const collectedFiles = [];

	const files = fs.readdirSync(dirPath).map(file => path.resolve(dirPath, file));
	for(const file of files) {
		if(fs.statSync(file).isDirectory()) collectedFiles.push(...collectFiles(file));
		else collectedFiles.push(file);
	}
    
	return collectedFiles;
};

const collectGameFiles = () => new Promise<string[]>((resolve, reject) => {

	const ignoredGameFiles = new Set([
		path.resolve(process.env.GAME_FOLDER, 'config.bin'),
		path.resolve(process.env.GAME_FOLDER, 'debug.log'),
		path.resolve(process.env.GAME_FOLDER, 'encryption_key.bin'),
		path.resolve(process.env.GAME_FOLDER, 'license.bin'),
		path.resolve(process.env.GAME_FOLDER, 'options.txt'),
		path.resolve(process.env.GAME_FOLDER, 'optionsof.txt'),
		path.resolve(process.env.GAME_FOLDER, 'optionsshaders.txt'),
		path.resolve(process.env.GAME_FOLDER, 'servers.dat'),
		path.resolve(process.env.GAME_FOLDER, 'servers.dat_old'),
		path.resolve(process.env.GAME_FOLDER, 'usercache.json'),
		...collectFiles(path.resolve(process.env.GAME_FOLDER, '.fabric')),
		...collectFiles(path.resolve(process.env.GAME_FOLDER, '.optifine')),
		...collectFiles(path.resolve(process.env.GAME_FOLDER, 'config')),
		...collectFiles(path.resolve(process.env.GAME_FOLDER, 'crash-reports')),
		...collectFiles(path.resolve(process.env.GAME_FOLDER, 'CustomSkinLoader')),
		...collectFiles(path.resolve(process.env.GAME_FOLDER, 'logs')),
		...collectFiles(path.resolve(process.env.GAME_FOLDER, 'resourcepacks')),
		...collectFiles(path.resolve(process.env.GAME_FOLDER, 'resources')),
		...collectFiles(path.resolve(process.env.GAME_FOLDER, 'saves')),
		...collectFiles(path.resolve(process.env.GAME_FOLDER, 'server-resource-packs')),
		...collectFiles(path.resolve(process.env.GAME_FOLDER, 'shaderpacks'))
	]);

	ignoredGameFiles.delete(path.resolve(process.env.GAME_FOLDER, 'CustomSkinLoader', 'CustomSkinLoader.json'));

	resolve(collectFiles(process.env.GAME_FOLDER).filter(filter => !ignoredGameFiles.has(filter)));

});

const createGameFilesIndex = (gameFiles : string[]) => new Promise<GameFilesIndex>((resolve, reject) => {
    
	const gameFilesIndex : GameFilesIndex = {};

	const checksumQueue = gameFiles.filter(isGameFile);

	if(checksumQueue.length === 0) {

		resolve(gameFilesIndex);
		return;

	}

	let checksumQueueLength = checksumQueue.length;

	let runningTasks = Math.min(gameFiles.length, Config.get('performance.checksumThreads') as number);

	const calcChecksumTask = () => {

		if(checksumQueueLength === 0) {

			runningTasks--;

			if(runningTasks === 0) {

				resolve(gameFilesIndex);

			}

			return;

		}

		const next = checksumQueue.shift();

		checksumQueueLength--;

		if(fs.existsSync(next)) {

			const nextStat = fs.statSync(next);

			if(nextStat.isFile()) {

				gameFilesIndex[next.substring(process.env.GAME_FOLDER.length).split(path.sep).join('/')] = {
					checksum: Hasher.checksum(next),
					size: nextStat.size
				};

			}

		}

		setImmediate(calcChecksumTask);

	};

	for(let i = 0; i < runningTasks; i++) calcChecksumTask();

});

const fetchLatestGameFilesIndex = () => new Promise<GameFilesIndex>(async (resolve, reject) => {

	let fetchedSuccessfully = false;

	do {

		await Request.request(`${CLIENT_CDN_URL}/${os.platform()}/${os.arch()}/index.json`).then(res => {
			fetchedSuccessfully = true;
			resolve(JSON.parse(res.body.toString('utf8')));
		}).catch(err => {
			Debug.log('Updater', `[Error] An error occured while fetching the latest game files index: ${err}`);
		});

	} while(!fetchedSuccessfully);

});

export const compareGameFilesIndexes = (gameFilesIndexA : GameFilesIndex, gameFilesIndexB : GameFilesIndex) => new Promise<ComparedGameFilesIndexes>((resolve, reject) => {
    
	const gameFilesIndexAKeys = Object.keys(gameFilesIndexA);
	const gameFilesIndexBKeys = Object.keys(gameFilesIndexB);

	let commonKeys = gameFilesIndexAKeys.filter(key => gameFilesIndexBKeys.includes(key));

	const uniqueGameFilesIndexAKeys = gameFilesIndexAKeys.filter(key => !commonKeys.includes(key));
	const uniqueGameFilesIndexBKeys = gameFilesIndexBKeys.filter(key => !commonKeys.includes(key));

	const mismatchingKeys = commonKeys.filter(key => gameFilesIndexA[key].checksum !== gameFilesIndexB[key].checksum || gameFilesIndexA[key].size !== gameFilesIndexB[key].size);
    
	commonKeys = commonKeys.filter(key => !mismatchingKeys.includes(key));

	const extraGameFilesIndex = uniqueGameFilesIndexAKeys.reduce((gameFilesIndex, key) => {
		gameFilesIndex[key] = gameFilesIndexA[key];
		return gameFilesIndex;
	}, {} as GameFilesIndex);

	const missingGameFilesIndex = uniqueGameFilesIndexBKeys.reduce((gameFilesIndex, key) => {
		gameFilesIndex[key] = gameFilesIndexB[key];
		return gameFilesIndex;
	}, {} as GameFilesIndex);

	const mismatchingGameFilesIndex = mismatchingKeys.reduce((gameFilesIndex, key) => {
		gameFilesIndex[key] = gameFilesIndexB[key];
		return gameFilesIndex;
	}, {} as GameFilesIndex);

	const matchingGameFilesIndex = commonKeys.reduce((gameFilesIndex, key) => {
		gameFilesIndex[key] = gameFilesIndexA[key];
		return gameFilesIndex;
	}, {} as GameFilesIndex);

	resolve({
		extra: extraGameFilesIndex,
		missing: missingGameFilesIndex,
		mismatching: mismatchingGameFilesIndex,
		matching: matchingGameFilesIndex
	});

});

const purgeExtraAndMismatchingGameFiles = (comparedGameFilesIndexes : ComparedGameFilesIndexes) => new Promise<void>((resolve, reject) => {

	updaterWindow.webContents.send('status-label-update', 'Játékfájlok tisztítása...');
	updaterWindow.webContents.send('status-progress-update', 0);
	updaterWindow.setProgressBar(0);
    
	const purgeQueue = [
		...Object.keys(comparedGameFilesIndexes.extra).map(key => path.resolve(process.env.GAME_FOLDER, '.' + key)),
		...Object.keys(comparedGameFilesIndexes.mismatching).map(key => path.resolve(process.env.GAME_FOLDER, '.' + key))
	].filter(isGameFile);

	let purgeQueueLength = purgeQueue.length;

	if(purgeQueueLength === 0) {

		resolve();
		return;

	}

	let runningTasks = Math.min(purgeQueue.length, Config.get('performance.purgeThreads') as number);

	const purgeTask = () => {

		if(purgeQueueLength === 0) {
			runningTasks--;
			if(runningTasks === 0) resolve();
			return;
		}

		const next = purgeQueue.shift();

		purgeQueueLength--;

		fs.rmSync(next, {
			force: true,
			maxRetries: 15
		});

		setImmediate(purgeTask);

	};

	for(let i = 0; i < runningTasks; i++) setImmediate(purgeTask);

});

const downloadMissingAndMismatchingGameFiles = (comparedGameFilesIndexes : ComparedGameFilesIndexes) => new Promise<void>((resolve, reject) => {
    
	if(!fs.existsSync(path.resolve(process.env.GAME_FOLDER, 'options.txt'))) {

		fs.writeFileSync(
			path.resolve(process.env.GAME_FOLDER, 'options.txt'),
			fs.readFileSync(path.resolve(__dirname, '../', 'etc/', 'options.txt'))
		);

	}

	if(!fs.existsSync(path.resolve(process.env.GAME_FOLDER, 'optionsof.txt'))) {

		fs.writeFileSync(
			path.resolve(process.env.GAME_FOLDER, 'optionsof.txt'),
			fs.readFileSync(path.resolve(__dirname, '../', 'etc/', 'optionsof.txt'))
		);

	}

	let downloadQueueKeys : string[] = [];
	const downloadQueueData : GameFilesIndex = {};

	let totalCount = 0;
	let totalSize = 0;

	for(const gameFile of Object.keys(comparedGameFilesIndexes.missing)) {

		totalCount++;
		totalSize += comparedGameFilesIndexes.missing[gameFile].size;

		downloadQueueKeys.push(gameFile);
		downloadQueueData[gameFile] = comparedGameFilesIndexes.missing[gameFile];

	}

	for(const gameFile of Object.keys(comparedGameFilesIndexes.mismatching)) {

		totalCount++;
		totalSize += comparedGameFilesIndexes.mismatching[gameFile].size;

		downloadQueueKeys.push(gameFile);
		downloadQueueData[gameFile] = comparedGameFilesIndexes.mismatching[gameFile];

	}

	if(totalCount === 0) {

		resolve();
		return;

	}

	const humanTotalSize = bytesToHuman(totalSize, 2);

	let downloadedCount = 0;
	let downloadedSize = 0;
    
	const progressReportTask = setInterval(() => {

		Debug.log('Updater', `Downloading missing game files (${downloadedCount} of ${totalCount} / ${bytesToHuman(downloadedSize, 2)} of ${humanTotalSize} / ${(downloadedSize / totalSize * 100).toFixed(2)}%)...`);
    
	}, 5000);

	let speedMeterLastReset = Date.now();
	const speedMeterDatas = [ 0 ];
	const speedMeterDataMaxCount = 10;
	const speedMeterDataTimespan = 1000;
	let speedMeterSpeed = 0;

	const speedMeterResetTask = setInterval(() => {

		speedMeterLastReset = Date.now();
		speedMeterDatas.push(0);

		if(speedMeterDatas.length > speedMeterDataMaxCount) speedMeterDatas.splice(0, speedMeterDatas.length - speedMeterDataMaxCount);

		speedMeterSpeed = speedMeterDatas.reduce((sum, val) => sum + val, 0) / ((speedMeterDatas.length - 1) * speedMeterDataTimespan + (Date.now() - speedMeterLastReset)) * 1000;

	}, speedMeterDataTimespan);

	downloadQueueKeys = downloadQueueKeys.sort((a, b) => downloadQueueData[a].size - downloadQueueData[b].size);

	let workingTaskCount = 0;
	let isDownloading = true;

	const updateFrontendProgress = () => {

		if(!isDownloading) return;

		updaterWindow.webContents.send('status-label-update', `Játékfájlok letöltése...</br>(${bytesToHuman(downloadedSize, 2)} / ${humanTotalSize} <i class="fa-solid fa-minus mx-1"></i> ${bytesToHuman(speedMeterSpeed, 2)}/s)`);
		updaterWindow.webContents.send('status-progress-update', 100 * downloadedSize / totalSize);
		updaterWindow.setProgressBar(downloadedSize / totalSize);

	};

	const downloadTask = (isLargeTask : boolean) => {

		if(downloadQueueKeys.length === 0) {

			workingTaskCount--;

			if(workingTaskCount === 0) {

				isDownloading = false;
	
				clearInterval(progressReportTask);
				clearInterval(speedMeterResetTask);
		
				resolve();

			}

			return;
 
		}

		let next;

		if(isLargeTask) next = downloadQueueKeys.pop();
		else next = downloadQueueKeys.shift();

		const nextPath = path.resolve(process.env.GAME_FOLDER, `./${next}`);

		if(!isGameFile(nextPath)) {

			Debug.log('Updater', `[Warn] Skipping non-game file ${next}`);

			setImmediate(downloadTask, isLargeTask);

			return;

		}

		let currDownloadedSize = 0;
		
		Request.request(`${CLIENT_CDN_URL}/${os.platform()}/${os.arch()}/${next}`, {
			method: 'GET',
			onDownloadProgress: downloadProgressInfo => {

				downloadedSize += downloadProgressInfo.downloadedBytes - currDownloadedSize;
				speedMeterDatas[speedMeterDatas.length - 1] += downloadProgressInfo.downloadedBytes - currDownloadedSize;

				currDownloadedSize = downloadProgressInfo.downloadedBytes;

				updateFrontendProgress();

			},
			stream: true
		}).then(res => {

			if(res.head.statusCode !== 200) {

				(res.body as stream.Readable).destroy();

				Debug.log('Updater', `[Error] Redownloading ${next} (got statusCode ${res.head.statusCode})`);

				downloadedSize -= currDownloadedSize;

				if(isLargeTask) downloadQueueKeys.push(next);
				else downloadQueueKeys.unshift(next);

				setImmediate(downloadTask, isLargeTask);

				return;

			}

			fs.mkdirSync(path.dirname(nextPath), {
				recursive: true,
				mode: 0o700
			});

			const bodyStream = res.body as stream.Readable;
			const writeStream = fs.createWriteStream(nextPath, {
				mode: 0o700
			});

			bodyStream.on('error', err => {

				bodyStream.destroy();
				writeStream.close();

				Debug.log('Updater', `[Error] An error occured while saving ${next}: ${err}`);

				downloadedSize -= currDownloadedSize;

				updateFrontendProgress();
	
				if(isLargeTask) downloadQueueKeys.push(next);
				else downloadQueueKeys.unshift(next);
	
				setImmediate(downloadTask, isLargeTask);

			});

			writeStream.on('error', err => {

				bodyStream.destroy();
				writeStream.close();

				Debug.log('Updater', `[Error] An error occured while saving ${next}: ${err}`);

				downloadedSize -= currDownloadedSize;

				updateFrontendProgress();
	
				if(isLargeTask) downloadQueueKeys.push(next);
				else downloadQueueKeys.unshift(next);
	
				setImmediate(downloadTask, isLargeTask);

			});

			bodyStream.on('data', dataChunk => {

				writeStream.write(dataChunk);

			});

			bodyStream.on('close', () => {

				writeStream.close();

				downloadedCount++;
	
				setImmediate(downloadTask, isLargeTask);

			});

		}).catch(err => {

			Debug.log('Updater', `[Error] An error occured while downloading ${next}: ${err}`);

			downloadedSize -= currDownloadedSize;

			updateFrontendProgress();

			if(isLargeTask) downloadQueueKeys.push(next);
			else downloadQueueKeys.unshift(next);

			setImmediate(downloadTask, isLargeTask);

		});

	};

	const largeDownloadThreadCount = Config.get('performance.largeDownloadThreads') as number;
	const smallDownloadThreadCount = Config.get('performance.smallDownloadThreads') as number;

	for(let i = 0; i < Math.min(totalCount, largeDownloadThreadCount); i++) {
		
		workingTaskCount++;
		setImmediate(downloadTask, true);

	}

	for(let i = 0; i < Math.min(totalCount - largeDownloadThreadCount, smallDownloadThreadCount); i++) {
		
		workingTaskCount++;
		setImmediate(downloadTask, false);

	}

});

export const verifyGameFiles = () => new Promise<boolean>(async (resolve, reject) => {

	const gameFiles = await collectGameFiles();

	const gameFilesIndex = await createGameFilesIndex(gameFiles);

	const comparedGameFilesIndexes = await compareGameFilesIndexes(gameFilesIndex, latestGameFilesIndex);

	Debug.log('Updater', 'Game file integrity verification results:');
	Debug.log('Updater', ` - extra (${Object.keys(comparedGameFilesIndexes.extra).length}): ${Object.keys(comparedGameFilesIndexes.extra).join(', ')}`);
	Debug.log('Updater', ` - mismatching (${Object.keys(comparedGameFilesIndexes.mismatching).length}): ${Object.keys(comparedGameFilesIndexes.mismatching).join(', ')}`);
	Debug.log('Updater', ` - missing (${Object.keys(comparedGameFilesIndexes.missing).length}): ${Object.keys(comparedGameFilesIndexes.missing).join(', ')}`);

	resolve(
		Object.keys(comparedGameFilesIndexes.extra).length === 0
	&&  Object.keys(comparedGameFilesIndexes.mismatching).length === 0
	&&  Object.keys(comparedGameFilesIndexes.missing).length === 0
	);

});

export const update = () => new Promise<void>(async (resolve, reject) => {

	updaterWindow = new Electron.BrowserWindow({
		title: 'MineZone',
		titleBarStyle: 'hidden',
		transparent: true,
		frame: false,
		darkTheme: true,
		width: 1280,
		height: 720,
		resizable: false,
		maximizable: false,
		show: false,
		webPreferences: {
			preload: path.resolve(__dirname, '../', 'static/', 'js/', 'preload.js'),
			contextIsolation: true,
			devTools: false
		}
	});

	updaterWindow.once('ready-to-show', () => {

		updaterWindow.show();
		updaterWindow.focus();
        
	});

	updaterWindow.once('show', async () => {

		Debug.log('Updater', 'Searching for launcher updates...');

		updaterWindow.webContents.send('status-label-update', 'Launcher-frissítések keresése...');
		updaterWindow.webContents.send('status-progress-update', 0);
		updaterWindow.setProgressBar(0);

		ElectronUpdater.autoUpdater.once('error', reject);

		ElectronUpdater.autoUpdater.once('update-available', (updateInfo : ElectronUpdater.UpdateInfo) => {

			Debug.log('Updater', `A launcher update is available the current is v${ElectronUpdater.autoUpdater.currentVersion.version} and the latest available version is v${updateInfo.version}`);

			if(!['darwin', 'win32'].includes(os.platform())) {

				Electron.dialog.showErrorBox('Frissítés', 'A Launcher elavult, kérlek, frissítsd!');
				Electron.app.exit(1);
				process.exit(1);

			}

			updaterWindow.webContents.send('status-label-update', 'Launcher frissítése...');
			updaterWindow.webContents.send('status-progress-update', 0);
			updaterWindow.setProgressBar(0);

			Debug.log('Updater', 'Downloading the launcher update...');

			ElectronUpdater.autoUpdater.downloadUpdate();

			let lastProgressReport = 0;
    
			ElectronUpdater.autoUpdater.on('download-progress', (progressInfo : ElectronUpdater.ProgressInfo) => {
    
				if(Date.now() > lastProgressReport + 3000) {

					lastProgressReport = Date.now();

					Debug.log('Updater', `Downloading the launcher update (${bytesToHuman(progressInfo.transferred)} of ${bytesToHuman(progressInfo.total)} / ${(progressInfo.transferred / progressInfo.total * 100).toFixed(2)}%)...`);
				
				}
    
				updaterWindow.webContents.send('status-label-update', `Launcher frissítése...<br/>(${bytesToHuman(progressInfo.transferred, 2)} / ${bytesToHuman(progressInfo.total, 2)} <i class="fa-solid fa-minus mx-1"></i> ${bytesToHuman(progressInfo.bytesPerSecond, 2)}/s)`);
				updaterWindow.webContents.send('status-progress-update', progressInfo.transferred / progressInfo.total * 100);
				updaterWindow.setProgressBar(progressInfo.transferred / progressInfo.total);

			});
    
			ElectronUpdater.autoUpdater.on('update-downloaded', (updateInfo : ElectronUpdater.UpdateInfo) => {
    
				Debug.log('Updater', 'Downloaded the launcher update');
    
				updaterWindow.webContents.send('status-label-update', 'Launcher frissítése...');
				updaterWindow.webContents.send('status-progress-update', 100);
				updaterWindow.setProgressBar(1);

				ElectronUpdater.autoUpdater.quitAndInstall(true, true);
    
			});

		});

		ElectronUpdater.autoUpdater.once('update-not-available', async (updateInfo : ElectronUpdater.UpdateInfo) => {

			Debug.log('Updater', `There are no launcher updates available, current version: ${ElectronUpdater.autoUpdater.currentVersion.version}`);
        
			updaterWindow.webContents.send('status-label-update', 'Játékfrissítések keresése...');
			updaterWindow.webContents.send('status-progress-update', 0);
			updaterWindow.setProgressBar(0);
            
			Debug.log('Updater', 'Collecting game files...');
			const gameFiles = (await collectGameFiles().catch(reject)) as string[];
			Debug.log('Updater', 'Collected game files');

			Debug.log('Updater', 'Creating game files index...');
			const gameFilesIndex = (await createGameFilesIndex(gameFiles as string[]).catch(reject)) as GameFilesIndex;
			Debug.log('Updater', 'Created game files index');

			Debug.log('Updater', 'Fetching the latest game files index...');
			latestGameFilesIndex = (await fetchLatestGameFilesIndex().catch(reject)) as GameFilesIndex;
			Debug.log('Updater', 'Fetched the latest game files index');

			Debug.log('Updater', 'Comparing the current game files index with the latest game files index...');
			const comparedGameFileIndexes = (await compareGameFilesIndexes(gameFilesIndex, latestGameFilesIndex).catch(reject)) as ComparedGameFilesIndexes;
			Debug.log('Updater', 'Compared the current game files index with the latest game files index:');
			Debug.log('Updater', `Found ${Object.keys(comparedGameFileIndexes.extra).length} extra, ${Object.keys(comparedGameFileIndexes.missing).length} missing, ${Object.keys(comparedGameFileIndexes.mismatching).length} mismatching and ${Object.keys(comparedGameFileIndexes.matching).length} matching files`);

			updaterWindow.webContents.send('status-label-update', 'Játék frissítése...');
			updaterWindow.webContents.send('status-progress-update', 0);

			Debug.log('Updater', 'Purging extra and mismatching game files...');
			await purgeExtraAndMismatchingGameFiles(comparedGameFileIndexes).catch(reject);
			Debug.log('Updater', 'Purged extra and mismatching game files');

			Debug.log('Updater', 'Downloading missing and mismatching game files...');
			await downloadMissingAndMismatchingGameFiles(comparedGameFileIndexes).catch(reject);
			Debug.log('Updater', 'Downloaded missing and mismatching game files');

			updaterWindow.webContents.send('status-label-update', 'Játék frissítése...');
			updaterWindow.webContents.send('status-progress-update', 100);
            
			updaterWindow.removeAllListeners('close');
			updaterWindow.close();

			resolve();

		});

		await ElectronUpdater.autoUpdater.checkForUpdates().catch(reject);
        
	});

	updaterWindow.once('close', () => Electron.app.exit());

	await updaterWindow.loadFile(path.resolve(__dirname, '../', 'static/', 'updater.html')).catch(reject);

});