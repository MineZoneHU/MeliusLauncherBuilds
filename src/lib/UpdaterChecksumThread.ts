import * as fs from 'fs';
import * as path from 'path';
import * as worker_threads from 'worker_threads';
import * as Hasher from './Hasher';

if(worker_threads.isMainThread) {

	process.exit(1);

}

const gameFolder = worker_threads.workerData.gameFolder;
const queue = worker_threads.workerData.queue as string[];

const checksumNext = () => {

	const next = queue.shift();

	if(next === undefined) {

		process.exit(0);

	}

	const nextPath = path.isAbsolute(next) ? next : (gameFolder ? path.resolve(gameFolder, next) : path.resolve(next));

	if(!fs.existsSync(nextPath)) {

		worker_threads.parentPort.postMessage({
			id: 'error',
			message: `Skipping non-existing path ${next}`
		});

		setImmediate(checksumNext);

		return;

	}

	const nextStat = fs.statSync(nextPath);

	if(!nextStat.isFile()) {

		worker_threads.parentPort.postMessage({
			id: 'error',
			message: `Skipping non-file path ${next}`
		});

		setImmediate(checksumNext);

		return;

	}

	worker_threads.parentPort.postMessage({
		id: 'checksumData',
		key: next,
		data: {
			size: nextStat.size,
			checksum: Hasher.checksum(nextPath)
		}
	});

	setImmediate(checksumNext);

};

checksumNext();