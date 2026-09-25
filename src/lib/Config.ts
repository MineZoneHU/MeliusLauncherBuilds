import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as Debug from './Debug';
import * as Encrypter from './Encrypter';
import * as CLIArgsParser from './CLIArgsParser';

const DEFAULT_CONFIG = {

	'performance.purgeThreads': os.cpus().length * 4,
	'performance.smallDownloadThreads': os.cpus().length * 3,
	'performance.largeDownloadThreads': os.cpus().length,
	'performance.checksumThreads': os.cpus().length,

	'settings.clientJVMMemory': Math.min(2048, Math.round(os.totalmem() / Math.pow(2, 31)) * Math.pow(2, 10))
	
};

let configFile;
let config;

export const loadConfig = () => new Promise<void>((resolve, reject) => {

	configFile = path.resolve(process.env.GAME_FOLDER, 'config.bin');

	if(!fs.existsSync(configFile)) {

		config = {};

		saveConfig().then(resolve).catch(reject);

		return;

	}

	Encrypter.decrypt(fs.readFileSync(configFile)).then(configBuf => {

		config = JSON.parse(configBuf.toString('utf8'));

		resolve();

	}).catch(() => {

		Debug.log('Config', 'The configuration file couldn\'t be decrypted (missing / invalid encryption key?)');

		fs.unlinkSync(configFile);
		
		config = {};

		saveConfig().then(resolve).catch(reject);

	});

	return;

});

const saveConfig = () => new Promise<void>((resolve, reject) => {

	Encrypter.encrypt(Buffer.from(JSON.stringify(config))).then(configBuf => {

		fs.writeFileSync(configFile, configBuf);

	});

	resolve();

});

export const get = (key : string, includeDefault = true) : unknown => {

	return config[key] ?? (includeDefault ? (DEFAULT_CONFIG[key] ?? null) : null);

};

export const set = (key : string, val : unknown) => {

	config[key] = val;

	saveConfig();
    
};

export const has = (key : string, includeDefault = true) : boolean => {

	return config[key] !== undefined || (includeDefault && DEFAULT_CONFIG[key] !== undefined);

};

export const remove = (key : string) : void => {

	delete config[key];

	saveConfig();

};