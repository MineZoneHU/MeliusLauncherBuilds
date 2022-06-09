import * as fs from 'fs';
import * as crypto from 'crypto';

export const hash = (input : Buffer, hashingAlgorithm = 'sha1') : string => {
	return crypto.createHash(hashingAlgorithm).update(input).digest().toString('hex');
};

export const checksum = (filePath : string, hashingAlgorithm = 'sha1') : string => {
	return hash(fs.readFileSync(filePath), hashingAlgorithm);
};