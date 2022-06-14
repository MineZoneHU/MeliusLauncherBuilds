import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as stream from 'stream';
import * as worker_threads from 'worker_threads';
import * as Request from './Request';

if(worker_threads.isMainThread) {

	process.exit(1);

}

const launcherVersion = worker_threads.workerData.launcherVersion;
const clientCdnURL = worker_threads.workerData.clientCdnURL;
const gameFolder = worker_threads.workerData.gameFolder;
const queueKeys = worker_threads.workerData.queueKeys as string[];

const downloadNext = () => {

	const next = queueKeys.shift();

	if(next === undefined) {

		process.exit(0);

	}

	const nextPath = path.resolve(gameFolder, `./${next}`);

	let currDownloadedSize = 0;

	Request.request(`${clientCdnURL}/${os.platform()}/${os.arch()}/${next}`, {
		method: 'GET',
		headers: {
			'User-Agent': `MeliusLauncher / ${launcherVersion}`
		},
		onDownloadProgress: downloadProgressInfo => {

			worker_threads.parentPort.postMessage({
				id: 'downloadProgress',
				bytes: downloadProgressInfo.downloadedBytes - currDownloadedSize
			});

			currDownloadedSize = downloadProgressInfo.downloadedBytes;

		},
		stream: true
	}).then(res => {

		if(res.head.statusCode !== 200) {

			(res.body as stream.Readable).destroy();

			worker_threads.parentPort.postMessage({
				id: 'error',
				message: `Redownloading ${next} (got statusCode ${res.head.statusCode})`
			});

			worker_threads.parentPort.postMessage({
				id: 'downloadProgress',
				bytes: -currDownloadedSize
			});

			queueKeys.unshift(next);

			setImmediate(downloadNext);

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

		bodyStream.once('error', err => {

			bodyStream.destroy();
			writeStream.close();

			worker_threads.parentPort.postMessage({
				id: 'error',
				message: `An error occured while saving ${next}: ${err}`
			});

			worker_threads.parentPort.postMessage({
				id: 'downloadProgress',
				bytes: -currDownloadedSize
			});

			queueKeys.unshift(next);

			setImmediate(downloadNext);

		});

		writeStream.once('error', err => {

			bodyStream.destroy();
			writeStream.close();

			worker_threads.parentPort.postMessage({
				id: 'error',
				message: `An error occured while saving ${next}: ${err}`
			});

			worker_threads.parentPort.postMessage({
				id: 'downloadProgress',
				bytes: -currDownloadedSize
			});

			queueKeys.unshift(next);

			setImmediate(downloadNext);

		});

		bodyStream.on('data', dataChunk => {

			writeStream.write(dataChunk);

		});

		bodyStream.once('close', () => {

			writeStream.close();

			writeStream.once('close', () => {

				worker_threads.parentPort.postMessage({
					id: 'downloadedCountIncrement'
				});

				setImmediate(downloadNext);

			});

		});

	}).catch(err => {

		worker_threads.parentPort.postMessage({
			id: 'error',
			message: `An error occured while downloading ${next}: ${err}`
		});

		worker_threads.parentPort.postMessage({
			id: 'downloadProgress',
			bytes: -currDownloadedSize
		});

		queueKeys.unshift(next);

		setImmediate(downloadNext);

	});

};

downloadNext();