import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const ENCRYPTION_ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY_SIZE = 32;
const ENCRYPTION_IV_SIZE = 16;
const ENCRYPTION_ITERATION = 8;
const ENCRYPTION_JUNK_BYTE_COUNT = 256;
let encryptionKeyFile : string;
let encryptionKey : Buffer;

export const init = () => new Promise<void>((resolve, reject) => {

	encryptionKeyFile = path.resolve(process.env.GAME_FOLDER, 'encryption_key.bin');

	if(!fs.existsSync(encryptionKeyFile)) {

		encryptionKey = crypto.randomBytes(ENCRYPTION_KEY_SIZE);
		fs.writeFileSync(encryptionKeyFile, encryptionKey);

	} else {
		
		encryptionKey = fs.readFileSync(encryptionKeyFile);

	}
	
	resolve();

});

const _encrypt = (buf : Buffer) => new Promise<Buffer>((resolve, reject) => {
	const iv = crypto.randomBytes(ENCRYPTION_IV_SIZE);
	const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, encryptionKey, iv);
	cipher.once('error', reject);
	resolve(Buffer.concat([ crypto.randomBytes(ENCRYPTION_JUNK_BYTE_COUNT), iv, crypto.randomBytes(ENCRYPTION_JUNK_BYTE_COUNT), cipher.update(buf), cipher.final(), crypto.randomBytes(ENCRYPTION_JUNK_BYTE_COUNT) ]));
});

const _decrypt = (buf : Buffer) => new Promise<Buffer>((resolve, reject) => {
	const iv = buf.slice(ENCRYPTION_JUNK_BYTE_COUNT, ENCRYPTION_JUNK_BYTE_COUNT + ENCRYPTION_IV_SIZE);
	const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, encryptionKey, iv);
	decipher.once('error', reject);
	resolve(Buffer.concat([ decipher.update(buf.slice(ENCRYPTION_JUNK_BYTE_COUNT + ENCRYPTION_IV_SIZE + ENCRYPTION_JUNK_BYTE_COUNT, buf.byteLength - ENCRYPTION_JUNK_BYTE_COUNT)), decipher.final() ]));
});

export const encrypt = (buf : Buffer, iter : number = ENCRYPTION_ITERATION) => new Promise<Buffer>(async (resolve, reject) => {
	for(let i = 0; i < iter; i++) buf = await (_encrypt(buf).catch(reject)) as Buffer;
	resolve(buf);
});

export const decrypt = (buf : Buffer, iter : number = ENCRYPTION_ITERATION) => new Promise<Buffer>(async (resolve, reject) => {
	for(let i = 0; i < iter; i++) buf = await (_decrypt(buf).catch(reject)) as Buffer;
	resolve(buf);
});