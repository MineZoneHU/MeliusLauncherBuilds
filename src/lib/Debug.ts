import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let logFileWriteStream : fs.WriteStream;

export const init = () : void => {

	logFileWriteStream = fs.createWriteStream(path.resolve(process.env.GAME_FOLDER, 'debug.log'), {
		flags: 'a',
		mode: 0o700
	});

};

export const log = (context : string, message : string) => {

	const recordLines = message.split(/(?:\r\n?|\n\r?)/g).map(messageLine => `[${(new Date()).toISOString()}] [${context}] ${messageLine}`);
	
	logFileWriteStream.write(recordLines.join(os.EOL) + os.EOL);
	process.stdout.write(recordLines.join(os.EOL) + os.EOL);
	
};