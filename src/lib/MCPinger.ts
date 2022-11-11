import * as dns from 'dns';
import * as net from 'net';

type ResolvedAddress = {
    host: string,
	packetHost: string,
    port: number,
	priority: number
};

export enum ProtocolVersions {
	LATEST = 760,
	'1_19_1' = 760,
	'1_19' = 759,
	'1_18_2' = 758,
	'1_18_1' = 757,
	'1_18' = 757,
	'1_17_1' = 756,
	'1_17' = 755,
	'1_16_5' = 754,
	'1_16_4' = 754,
	'1_16_3' = 753,
	'1_16_2' = 751,
	'1_16_1' = 736,
	'1_16' = 735,
	'1_15_2' = 578,
	'1_15_1' = 575,
	'1_15' = 573,
	'1_14_4' = 498,
	'1_14_3' = 490,
	'1_14_2' = 485,
	'1_14_1' = 480,
	'1_14' = 477,
	'1_13_2' = 404,
	'1_13_1' = 401,
	'1_13' = 393,
	'1_12_2' = 340,
	'1_12_1' = 338,
	'1_12' = 335,
	'1_11_2' = 316,
	'1_11_1' = 316,
	'1_11' = 315,
	'1_10_2' = 210,
	'1_10_1' = 210,
	'1_10' = 210,
	'1_9_4' = 110,
	'1_9_3' = 110,
	'1_9_2' = 109,
	'1_9_1' = 108,
	'1_9' = 107,
	'1_8_9' = 47,
	'1_8_8' = 47,
	'1_8_7' = 47,
	'1_8_6' = 47,
	'1_8_5' = 47,
	'1_8_4' = 47,
	'1_8_3' = 47,
	'1_8_2' = 47,
	'1_8_1' = 47,
	'1_8' = 47,
	'1_7_10' = 5,
	'1_7_9' = 5,
	'1_7_8' = 5,
	'1_7_7' = 5,
	'1_7_6' = 5,
	'1_7_5' = 4,
	'1_7_4' = 4,
	'1_7_2' = 4
}

const _resolveDomainAddress = (address : string) => new Promise<string[]>((resolve, reject) => {
	Promise.all([
		new Promise<string[]>((resolve, reject) => {
			dns.resolve4(address, (err, aRecords) => {
				if(err) {
					resolve([]);
					return;
				}
				resolve(aRecords);
			});
		}),
		new Promise<string[]>((resolve, reject) => {
			dns.resolve6(address, (err, aaaaRecords) => {
				if(err) {
					resolve([]);
					return;
				}
				resolve(aaaaRecords);
			});
		}),
		new Promise<string[]>((resolve, reject) => {
			dns.resolveCname(address, (err, cnameRecords) => {
				if(err) {
					resolve([]);
					return;
				}
				Promise.all(cnameRecords.map(_resolveDomainAddress)).then(resolvedAddresses => {
					resolve(resolvedAddresses.flat());
				});
			});
		})
	]).then(resolvedAddresses => {
		resolve(resolvedAddresses.flat());
	});
});

const _resolveSRVAddress = (address : string) => new Promise<ResolvedAddress[]>((resolve, reject) => {
	dns.resolveSrv(`_minecraft._tcp.${address}`, (err, srvRecords) => {
		if(err) {
			resolve([]);
			return;
		}
		Promise.all(srvRecords.map(srvRecord => new Promise<ResolvedAddress[]>((resolve, reject) => {
			if(net.isIP(srvRecord.name)) {
				resolve([{
					host: srvRecord.name,
					packetHost: srvRecord.name,
					port: srvRecord.port,
					priority: srvRecord.priority
				}]);
				return;
			}
			_resolveDomainAddress(srvRecord.name).then(resolvedAddresses => {
				resolve(resolvedAddresses.map(resolvedAddress => ({
					host: resolvedAddress,
					packetHost: srvRecord.name,
					port: srvRecord.port,
					priority: srvRecord.priority
				})));
			});
		}))).then(resolvedAddresses => {
			resolve(resolvedAddresses.flat());
		});
	});
});

export const _ipv6ToBuffer = (address : string) : Buffer => {
	const addressParts = address.split(':');
	const addressBuf = Buffer.alloc(16);
	let parsedAddressPart;
	if(addressParts.length < 8) {
		let i = 0;
		while(addressParts[i].length > 0) {
			parsedAddressPart = parseInt(addressParts[i], 16);
			addressBuf[i * 2] = parsedAddressPart >>> 8;
			addressBuf[i * 2 + 1] = parsedAddressPart & 0xFF;
			i++;
		}
		i = addressParts.length - 1;
		let j = 7;
		while(addressParts[i].length > 0) {
			parsedAddressPart = parseInt(addressParts[i], 16);
			addressBuf[j * 2] = parsedAddressPart >>> 8;
			addressBuf[j * 2 + 1] = parsedAddressPart & 0xFF;
			i--;
			j--;
		}
	} else {
		for(let i = 0; i < 8; i++) {
			parsedAddressPart = parseInt(addressParts[i], 16);
			addressBuf[i * 2] = parsedAddressPart >>> 8;
			addressBuf[i * 2 + 1] = parsedAddressPart & 0xFF;
		}
	}
	return addressBuf;
};

const _compareIPs = (addressA : string, addressB : string) : number => {
	if(net.isIPv4(addressA)) {
		if(net.isIPv4(addressB)) {
			const addressAParts = addressA.split('.').map(octet => parseInt(octet));
			const addressBParts = addressB.split('.').map(octet => parseInt(octet));
			for(let i = 0; i < 4; i++) {
				if(addressAParts[i] !== addressBParts[i]) {
					return addressAParts[i] - addressBParts[i];
				}
			}
			return 0;
		} else return -1;
	}
	if(net.isIPv4(addressB)) {
		return 1;
	}
	const addressABuf = _ipv6ToBuffer(addressA);
	const addressBBuf = _ipv6ToBuffer(addressB);
	return Buffer.compare(addressABuf, addressBBuf);
};

const _resolveAddress = (address : string) => new Promise<ResolvedAddress[]>((resolve, reject) => {
	if(net.isIP(address)) {
		resolve([{
			host: address,
			packetHost: address,
			port: 25565,
			priority: 65536
		}]);
		return;
	}
	if(address.includes(':')) {
		const addressParts = address.split(':', 2);
		address = addressParts[0];
		const port = parseInt(addressParts[1]);
		if(net.isIP(address)) {
			resolve([{
				host: address,
				packetHost: address,
				port: port,
				priority: 65536
			}]);
			return;
		}
		_resolveDomainAddress(address).then(resolvedAddresses => {
			resolve(resolvedAddresses.map(resolvedAddress => ({
				host: resolvedAddress,
				packetHost: address,
				port: port,
				priority: 65536
			})).sort((resolvedAddressA, resolvedAddressB) => {
				if(resolvedAddressA.priority === resolvedAddressB.priority) {
					if(resolvedAddressA.host === resolvedAddressB.host) {
						return resolvedAddressA.port - resolvedAddressB.port;
					}
					return _compareIPs(resolvedAddressA.host, resolvedAddressB.host);
				}
				return resolvedAddressA.priority - resolvedAddressB.priority;
			}).reduce((resolvedAddresses, resolvedAddress, i) => {
				if(i === 0 || resolvedAddress.host !== resolvedAddresses[resolvedAddresses.length - 1].host || resolvedAddress.port !== resolvedAddresses[resolvedAddresses.length - 1].port) {
					resolvedAddresses.push(resolvedAddress);
				}
				return resolvedAddresses;
			}, [] as ResolvedAddress[]));
		});
		return;
	}
	Promise.all([
		_resolveSRVAddress(address),
		new Promise<ResolvedAddress[]>((resolve, reject) => {
			_resolveDomainAddress(address).then(resolvedAddresses => {
				resolve(resolvedAddresses.map(resolvedAddress => ({
					host: resolvedAddress,
					packetHost: address,
					port: 25565,
					priority: 65536
				})));
			});
		})
	]).then(resolvedAddresses => {
		resolve(resolvedAddresses.flat().sort((resolvedAddressA, resolvedAddressB) => {
			if(resolvedAddressA.priority === resolvedAddressB.priority) {
				if(resolvedAddressA.host === resolvedAddressB.host) {
					return resolvedAddressA.port - resolvedAddressB.port;
				}
				return _compareIPs(resolvedAddressA.host, resolvedAddressB.host);
			}
			return resolvedAddressA.priority - resolvedAddressB.priority;
		}).reduce((resolvedAddresses, resolvedAddress, i) => {
			if(i === 0 || resolvedAddress.host !== resolvedAddresses[resolvedAddresses.length - 1].host || resolvedAddress.port !== resolvedAddresses[resolvedAddresses.length - 1].port) {
				resolvedAddresses.push(resolvedAddress);
			}
			return resolvedAddresses;
		}, [] as ResolvedAddress[]));
	});
});

type Chat = {
	bold?: boolean,
	italic?: boolean,
	underlined?: boolean,
	strikethrough?: boolean,
	obfuscated?: boolean,
	font?: string,
	color?: string,
	text?: string,
	insertion?: string
	clickEvent?: {
		action: 'open_url' | 'run_command' | 'twitch_user_info' | 'suggest_command' | 'change_page' | 'copy_to_clipboard',
		value: string
	},
	hoverEvent?: {
		action: 'show_text' | 'show_item' | 'show_entity' | 'show_achievement',
		value: string
	},
	extra?: Chat[]
};

type PingResponse = {
	_address: ResolvedAddress,
	_hops: number,
	version: {
		name: string,
		protocol: number
	},
	players: {
		max: number,
		online: number,
		sample?: ({
			name: string,
			id: string
		})[]
	},
	description: Chat,
	favicon?: string,
	previewsChat: boolean
};

type PingOptions = {
	timeout?: number,
	protocolVersion?: keyof typeof ProtocolVersions | number
};

const DEFAULT_PING_OPTIONS : PingOptions = {
	timeout: 5 * 1000
};

const _createVarInt = (n : number) : number[] => {
	const varInt = [];
	do {
		varInt.push(n & 0x7F | 0x80);
		n >>>= 7;
	} while(n > 0);
	varInt[varInt.length - 1] &= 0x7F;
	return varInt;
};

const _ping = (next : () => ResolvedAddress, options? : PingOptions, hops = 0) => new Promise<PingResponse>((resolve, reject) => {
	const address = next();
	if(address === undefined) {
		reject('no addresses left to try');
		return;
	}
	let protocolVersion = ProtocolVersions.LATEST;
	if(options?.protocolVersion !== undefined) {
		switch(typeof options.protocolVersion) {
			case 'string': {
				if(ProtocolVersions[options.protocolVersion] === undefined) {
					reject(`unknown protocol version ${options.protocolVersion}`);
					return;
				}
				protocolVersion = ProtocolVersions[options.protocolVersion];
				break;
			}
			case 'number': {
				protocolVersion = options.protocolVersion;
				break;
			}
		}
	}
	const handshakePacketServerAddress = address.packetHost ?? address.host;
	const handshakePacket = Buffer.from([
		..._createVarInt(0x00),
		..._createVarInt(protocolVersion),
		..._createVarInt(handshakePacketServerAddress.length),
		...handshakePacketServerAddress.split('').map(char => char.charCodeAt(0)),
		address.port >>> 8,
		address.port & 0xFF,
		..._createVarInt(0x01)
	]);
	const statusRequestPacket = Buffer.from([
		..._createVarInt(0x00)
	]);
	const pingRequestPacket = Buffer.from([
		..._createVarInt(0x01)
	]);
	const client = net.createConnection({
		host: address.host,
		port: address.port,
		timeout: options?.timeout ?? DEFAULT_PING_OPTIONS.timeout
	});
	client.once('timeout', () => {
		client.removeAllListeners();
		client.destroy();
		_ping(next, options).then(resolve).catch(reject);
	});
	client.once('error', err => {
		client.removeAllListeners();
		client.destroy();
		_ping(next, options).then(resolve).catch(reject);
	});
	client.once('ready', () => {
		client.write(Buffer.from(_createVarInt(handshakePacket.length)));
		client.write(handshakePacket);
		client.write(Buffer.from(_createVarInt(statusRequestPacket.length)));
		client.write(statusRequestPacket);
		client.write(Buffer.from(_createVarInt(pingRequestPacket.length)));
		client.write(pingRequestPacket);
	});
	let receivedData = Buffer.alloc(0);
	client.on('data', chunk => {
		receivedData = Buffer.concat([ receivedData, chunk ]);
	});
	client.on('close', () => {
		let i = 0;
		while((receivedData[i] & 0x80) > 0 && i < receivedData.length) i++;
		i++;
		while((receivedData[i] & 0x80) > 0 && i < receivedData.length) i++;
		i++;
		let packetResponseLength = 0, o = 0;
		while((receivedData[i] & 0x80) > 0) {
			packetResponseLength |= (receivedData[i] & 0x7F) << (o * 7);
			i++;
			o++;
		}
		packetResponseLength |= (receivedData[i] & 0x7F) << (o * 7);
		i++;
		try {
			resolve({
				_address: address,
				_hops: hops,
				...JSON.parse(receivedData.subarray(i, i + packetResponseLength).toString('utf-8'))
			});
		} catch(err) {
			_ping(next, options, hops + 1).then(resolve).catch(reject);
		}
	});
});

export const ping = (address : string, options? : PingOptions) => new Promise<PingResponse>((resolve, reject) => {
	_resolveAddress(address).then(resolvedAddresses => {
		if(address.includes('pbl')) console.log(resolvedAddresses);
		const addressQueue = resolvedAddresses;
		const addressGen = () => addressQueue.shift();
		_ping(addressGen, options).then(resolve).catch(reject);
	});
});