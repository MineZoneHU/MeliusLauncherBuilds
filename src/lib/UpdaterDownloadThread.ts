import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as worker_threads from 'worker_threads';
import axios from 'axios';

if(worker_threads.isMainThread) {

	process.exit(1);

}

const launcherVersion = worker_threads.workerData.launcherVersion;
const clientCdnURL = worker_threads.workerData.clientCdnURL;
const gameFolder = worker_threads.workerData.gameFolder;
const queue = worker_threads.workerData.queue as string[];

const USER_AGENT = `MeliusLauncher / ${launcherVersion}`;

const downloadNext = () => {

	const next = queue.shift();

	if(next === undefined) {

		process.exit(0);

	}

	const nextPath = path.resolve(gameFolder, `./${next}`);

	let currDownloadedSize = 0;

	axios({
		url: `${clientCdnURL}/${os.platform()}/${os.arch()}/${next}`,
		method: 'GET',
		headers: {
			'User-Agent': USER_AGENT
		},
		responseType: 'stream'
	}).then(res => {

		if(res.status !== 200) {

			worker_threads.parentPort.postMessage({
				id: 'error',
				message: `Redownloading ${next} (got statusCode ${res.status})`
			});

			queue.unshift(next);

			setImmediate(downloadNext);

			return;

		}

		res.data.on('data', chunk => {

			currDownloadedSize += chunk.length;
			
			worker_threads.parentPort.postMessage({
				id: 'downloadProgress',
				bytes: chunk.length
			});

		});

		fs.mkdirSync(path.dirname(nextPath), {
			recursive: true,
			mode: 0o700
		});

		const bodyStream = res.data;
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

			queue.unshift(next);

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

			queue.unshift(next);

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

		queue.unshift(next);

		setImmediate(downloadNext);

	});

};

downloadNext();