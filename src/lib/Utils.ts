import * as path from 'path';

const BYTE_UNITS = [{
	suffix: 'B',
	divisor: 1
}, {
	suffix: 'KB',
	divisor: 1_000
}, {
	suffix: 'MB',
	divisor: 1_000_000
}, {
	suffix: 'GB',
	divisor: 1_000_000_000
}, {
	suffix: 'TB',
	divisor: 1_000_000_000_000
}, {
	suffix: 'PB',
	divisor: 1_000_000_000_000_000
}];

export const areArraysEqual = (arrayA : unknown[], arrayB : unknown[]) : boolean => {

	if(!Array.isArray(arrayA) || !Array.isArray(arrayB) || arrayA.length !== arrayB.length) return false;

	for(let i = 0; i < arrayA.length; i++) {

		if(typeof arrayA[i] !== typeof arrayB[i]) return false;

		if(typeof arrayA[i] === 'object') {

			if(Array.isArray(arrayA[i])) {

				if(!Array.isArray(arrayB[i]) || !areArraysEqual(arrayA[i], arrayB[i])) return false;

			} else {

				if(Array.isArray(arrayB[i]) || !areObjectsEqual(arrayA[i], arrayB[i])) return false;
				
			}

		}
		else if(arrayA[i] !== arrayB[i]) return false;

	}

	return true;

};

export const areObjectsEqual = (objectA : object, objectB : object, checkKeyOrder = false) : boolean => {

	if(typeof objectA !== 'object' || Array.isArray(objectA) || typeof objectB !== 'object' || Array.isArray(objectB)) return false;

	const objectAKeys = Object.keys(objectA), objectBKeys = Object.keys(objectB);

	if(objectAKeys.length !== objectBKeys.length) return false;

	if(checkKeyOrder) {

		for(let i = 0; i < objectAKeys.length; i++) if(objectAKeys[i] !== objectBKeys[i]) return false;

	} else {

		objectAKeys.sort((a, b) => {

			if(a.length < b.length) return -1;
			else if(a.length > b.length) return 1;

			for(let i = 0, j, k; i < a.length; i++) {

				j = a.charCodeAt(i);
				k = b.charCodeAt(i);

				if(j < k) return -1;
				else if(j > k) return 1;

			}

			return 0;

		});

		objectBKeys.sort((a, b) => {

			if(a.length < b.length) return -1;
			else if(a.length > b.length) return 1;

			for(let i = 0, j, k; i < a.length; i++) {

				j = a.charCodeAt(i);
				k = b.charCodeAt(i);

				if(j < k) return -1;
				else if(j > k) return 1;

			}

			return 0;

		});

		for(let i = 0; i < objectAKeys.length; i++) if(objectAKeys[i] !== objectBKeys[i]) return false;

	}

	for(const key of objectAKeys) {

		if(typeof objectA[key] !== typeof objectB[key]) return false;

		if(typeof objectA[key] === 'object') {

			if(Array.isArray(objectA[key])) {

				if(!Array.isArray(objectB[key]) || !areArraysEqual(objectA[key], objectB[key])) return false;

			} else {

				if(Array.isArray(objectB[key]) || !areObjectsEqual(objectA[key], objectB[key])) return false;

			}

		}
		else if(objectA[key] !== objectB[key]) return false;

	}

	return true;
};

export const divideArray = <T>(arr : T[], n : number, fill = false) : T[][] => {

	if(arr.length <= n) {

		const groups = arr.map(e => [ e ]);

		if(fill) groups.push(...Array.from({ length: n - arr.length }, () => []));

		return groups;

	}

	const groupSize = arr.length / n;

	const groups = [];

	for(let i = 0; i < n; i++) {

		groups.push(arr.slice(Math.round(i * groupSize), Math.round((i + 1) * groupSize)));

	}

	return groups;

};

export const bytesToHuman = (bytes : number, decimalPrecision = 0) => {

	let unit = BYTE_UNITS[0];

	for(let i = 0; i < BYTE_UNITS.length; i++) {
		if(BYTE_UNITS[i].divisor < bytes) continue;
		if(i > 0) unit = BYTE_UNITS[i - 1];
		break;
	}

	return `${(bytes / unit.divisor).toFixed(decimalPrecision)} ${unit.suffix}`;

};

const isSubpath = (parentPath : string, subPath : string) : boolean => {
	const relativePath = path.relative(parentPath, subPath);
	return relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
};