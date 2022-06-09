import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

let devID : string;

export const createLicenseFromDevID = (devID) => {

	let licenseHashBuf = devID;

	for(let i = 255; i >= 0; i--) {
		licenseHashBuf = crypto.createHash('sha512').update(Buffer.concat([
			licenseHashBuf,
			Buffer.from(Array.from({ length: 256 }, (_, j) => (i ^ j)))
		])).digest();
	}

	return Buffer.concat([ licenseHashBuf, devID ]);
    
};

export const validateLicenseFile = () : boolean => {

	const licenseFilePath = path.resolve(process.env.GAME_FOLDER, 'license.bin');

	if(!fs.existsSync(licenseFilePath) || !fs.statSync(licenseFilePath).isFile()) return false;

	const licenseFileContent = fs.readFileSync(licenseFilePath);

	if(licenseFileContent.length < 65 || licenseFileContent.length > 512) return false;

	const createdLicenseFromDevID = createLicenseFromDevID(licenseFileContent.slice(64));

	if(licenseFileContent.compare(createdLicenseFromDevID) !== 0) return false;

	devID = licenseFileContent.slice(64).toString('ascii');

	return true;

};

export const getDevID = () => devID;