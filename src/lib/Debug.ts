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

export const log = (context : string, message : string, saveToFile = true) => {

	const recordLines = message.split(/(?:\r\n?|\n\r?)/g).map(messageLine => `[${(new Date()).toISOString()}] [${context}] ${messageLine}`);
	
	process.stdout.write(recordLines.join(os.EOL) + os.EOL);

	if(saveToFile) logFileWriteStream.write(recordLines.join(os.EOL) + os.EOL);
	
};