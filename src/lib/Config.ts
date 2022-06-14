import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as Debug from './Debug';
import * as Encrypter from './Encrypter';
import * as CLIArgsParser from './CLIArgsParser';

const DEFAULT_CONFIG = {

	'developerMode': CLIArgsParser.hasOption('developer-mode'),

	'performance.purgeThreads': 32,
	'performance.smallDownloadThreads': 32,
	'performance.largeDownloadThreads': 8,
	'performance.checksumThreads': 8,

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

export const get = (key : string, includeDefault  = true) : unknown => {

	return config[key] ?? (includeDefault ? (DEFAULT_CONFIG[key] ?? null) : null);

};

export const set = (key : string, val : unknown) => {

	config[key] = val;

	saveConfig();
    
};

export const has = (key : string, includeDefault  = true) : boolean => {

	if(config[key]) return true;
	else if(includeDefault) return DEFAULT_CONFIG[key] !== undefined;

	return false;

};

export const remove = (key : string) : void => {

	delete config[key];

};