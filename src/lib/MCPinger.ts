import * as dns from 'dns';
import * as net from 'net';

type ResolvedAddress = {
    host: string,
	packetHost: string,
    port: number,
	priority: number
};

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
		}))).then;
	});
});

const _resolveAddress = (address : string) => new Promise<ResolvedAddress[]>((resolve, reject) => {
	if(net.isIP(address)) {
		resolve([{
			host: address,
			packetHost: address,
			port: 25565,
			priority: 65535
		}]);
		return;
	}
	if(address.includes(':')) {
		const addressParts = address.split(':', 2);
		address = addressParts[0];
		const port = parseInt(addressParts[1]);
		_resolveDomainAddress(address).then(resolvedAddresses => {
			resolve(resolvedAddresses.map(resolvedAddress => ({
				host: resolvedAddress,
				packetHost: address,
				port: port,
				priority: 65535
			})));
		});
	} else {
		Promise.all([
			_resolveSRVAddress(address),
			new Promise<ResolvedAddress[]>((resolve, reject) => {
				_resolveDomainAddress(address).then(resolvedAddresses => {
					resolve(resolvedAddresses.map(resolvedAddress => ({
						host: resolvedAddress,
						packetHost: address,
						port: 25565,
						priority: 65535
					})));
				});
			})
		]).then(resolvedAddresses => {
			resolve(resolvedAddresses.flat().sort((resolvedAddressA, resolvedAddressB) => resolvedAddressA.priority - resolvedAddressB.priority));
		});
	}
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
	protocolVersion?: number
};

const DEFAULT_PING_OPTIONS : PingOptions = {
	timeout: 5 * 1000,
	protocolVersion: 759
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

const _ping = (next : () => ResolvedAddress, options? : PingOptions) => new Promise<PingResponse>((resolve, reject) => {
	const address = next();
	if(address === undefined) {
		reject('There are no addresses left to try');
		return;
	}
	const handshakePacketServerAddress = address.packetHost ?? address.host;
	const handshakePacket = Buffer.from([
		..._createVarInt(0x00),
		..._createVarInt(options?.protocolVersion ?? DEFAULT_PING_OPTIONS.protocolVersion),
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
	client.once('error', () => {
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
	client.on('data', chunk => receivedData = Buffer.concat([ receivedData, chunk ]));
	client.on('close', () => {
		client.destroy();
		let i = 0, o;
		let packetLength = 0;
		o = 0;
		while((receivedData[i] & 0x80) > 0) {
			packetLength |= (receivedData[i] & 0x7F) << (o * 7);
			i++;
			o++;
		}
		packetLength |= (receivedData[i] & 0x7F) << (o * 7);
		i++;
		let packetID = 0;
		o = 0;
		while((receivedData[i] & 0x80) > 0) {
			packetID |= (receivedData[i] & 0x7F) << (o * 7);
			i++;
			o++;
		}
		packetID |= (receivedData[i] & 0x7F) << (o * 7);
		i++;
		let packetResponseLength = 0;
		o = 0;
		while((receivedData[i] & 0x80) > 0) {
			packetResponseLength |= (receivedData[i] & 0x7F) << (o * 7);
			i++;
			o++;
		}
		packetResponseLength |= (receivedData[i] & 0x7F) << (o * 7);
		i++;
		resolve(JSON.parse(receivedData.slice(i, i + packetResponseLength).toString()));
	});
});

export const ping = (address : string, options? : PingOptions) => new Promise<PingResponse>((resolve, reject) => {
	_resolveAddress(address).then(resolvedAddresses => {
		const addressQueue = resolvedAddresses;
		const addressGen = () => addressQueue.shift();
		_ping(addressGen, options).then(resolve).catch(reject);
	});
});