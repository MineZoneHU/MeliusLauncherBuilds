import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import * as zlib from 'zlib';
import * as stream from 'stream';
import { RequestOptions } from './RequestOptions';
import { RequestStreamResponse } from './RequestStreamResponse';
import { RequestBufferResponse } from './RequestBufferResponse';

let defaultUserAgent = 'MeliusLauncher / unknown';

export const setLauncherVersion = (version : string) => defaultUserAgent = `MeliusLauncher / ${version}`;

const DEFAULT_MAX_REDIRECT_COUNT = 3;

https.globalAgent.options.cert = fs.readFileSync(path.resolve(__dirname, '../', 'etc/', 'minezone.hu.pem'));
https.globalAgent.options.key = fs.readFileSync(path.resolve(__dirname, '../', 'etc/', 'minezone.hu.key'));

const _request = (urlStr : string, options : (http.RequestOptions | https.RequestOptions) & RequestOptions, redirectCount : number) => new Promise<RequestStreamResponse | RequestBufferResponse>((resolve, reject) => {

	const parsedURL = new url.URL(urlStr);

	if(options === undefined) {
		options = {
			method: 'GET',
			headers: {
				'User-Agent': defaultUserAgent
			}
		};
	}
	else {
		if(options.method === undefined) options.method = 'GET';
		if(options.headers === undefined) options.headers = {
			'User-Agent': defaultUserAgent
		};
		else if(options.headers['User-Agent'] === undefined) options.headers['User-Agent'] = defaultUserAgent;
	}

	if(options.compression === true) {
		if(options.headers === undefined) options.headers = { 'Accept-Encoding': 'br, gzip, deflate' };
		else options.headers['Accept-Encoding'] = 'br, gzip, deflate';
	}

	delete options.compression;

	if(options.followRedirects !== false && options.maxRedirectCount === undefined) {
		options.maxRedirectCount = DEFAULT_MAX_REDIRECT_COUNT;
	}

	delete options.followRedirects;
	delete options.maxRedirectCount;

	switch(parsedURL.protocol) {

		default: 
			reject('Unsupported protocol');
			return;

		case 'http:':
		case 'https:': {

			const req = ({
				'http:': http,
				'https:': https
			})[parsedURL.protocol].request(parsedURL, options, res => {

				if([ 301, 302 ].includes(res.statusCode) && res.headers.location && options.followRedirects !== false) {

					if(redirectCount === options.maxRedirectCount) {
						reject('Too many redirects.');
						return;
					}

					_request(res.headers.location, options, redirectCount + 1).then(resolve).catch(reject);
					return;

				}

				if(options.onDownloadProgress !== undefined) {

					const totalBytes = parseInt(res.headers['content-length']);
					let downloadedBytes = 0;

					if(isNaN(totalBytes)) {

						options.onDownloadProgress({
							downloadedBytes
						});

						res.on('data', dataBuf => {

							downloadedBytes += dataBuf.length;

							options.onDownloadProgress({
								downloadedBytes
							});

						});

					} else {

						options.onDownloadProgress({
							downloadedBytes,
							totalBytes,
							progress: downloadedBytes / totalBytes
						});

						res.on('data', dataBuf => {

							downloadedBytes += dataBuf.length;

							options.onDownloadProgress({
								downloadedBytes,
								totalBytes,
								progress: downloadedBytes / totalBytes
							});

						});

					}
				}

				if(options.stream === true) {
                    
					let bodyStream : stream.Readable;

					switch(res.headers['content-encoding']) {

						case 'br':
							bodyStream = res.pipe(zlib.createBrotliDecompress());
							break;

						case 'gzip':
							bodyStream = res.pipe(zlib.createGunzip());
							break;

						case 'deflate':
							bodyStream = res.pipe(zlib.createDeflate());
							break;

						default:
							bodyStream = res.pipe(new stream.PassThrough());
							break;

					}

					resolve({
						head: {
							headers: res.headers,
							httpVersion: res.httpVersion,
							httpVersionMajor: res.httpVersionMajor,
							httpVersionMinor: res.httpVersionMinor,
							method: res.method,
							statusCode: res.statusCode,
							statusMessage: res.statusMessage
						},
						body: bodyStream
					} as RequestStreamResponse);

				} else {

					let bodyBuf = Buffer.alloc(0);

					switch(res.headers['content-encoding']) {

						case 'br':
							res.pipe(zlib.createBrotliDecompress()).on('data', chunk => {
								bodyBuf = Buffer.concat([ bodyBuf, chunk ]);
							});
							break;

						case 'gzip':
							res.pipe(zlib.createGunzip()).on('data', chunk => {
								bodyBuf = Buffer.concat([ bodyBuf, chunk ]);
							});
							break;

						case 'deflate':
							res.pipe(zlib.createInflate()).on('data', chunk => {
								bodyBuf = Buffer.concat([ bodyBuf, chunk ]);
							});
							break;

						default:
							res.on('data', chunk => {
								bodyBuf = Buffer.concat([ bodyBuf, chunk ]);
							});
							break;

					}
                    
					res.once('close', () => {

						resolve({
							head: {
								headers: res.headers,
								httpVersion: res.httpVersion,
								httpVersionMajor: res.httpVersionMajor,
								httpVersionMinor: res.httpVersionMinor,
								method: res.method,
								statusCode: res.statusCode,
								statusMessage: res.statusMessage
							},
							body: bodyBuf
						} as RequestBufferResponse);
						
					});

				}

				res.once('error', err => {

					res.removeAllListeners();
					res.destroy();

					reject(err);
                    
				});

			});

			req.once('error', err => {

				req.removeAllListeners();
				req.destroy();

				reject(err);

			});

			if(options.data !== undefined) {

				if(options.onUploadProgress !== undefined) {

					options.onUploadProgress({
						uploadedBytes: 0,
						totalBytes: options.data.length,
						progress: 0
					});

					req.socket.on('drain', () => {

						options.onUploadProgress({
							uploadedBytes: req.socket.bytesWritten,
							totalBytes: options.data.length,
							progress: req.socket.bytesWritten / options.data.length
						});

					});

				}

				req.write(options.data);

			}

			req.end();

			return;

		}

	}
});

export const request = (urlStr : string, options? : (http.RequestOptions | https.RequestOptions) & RequestOptions) => _request(urlStr, options, 0);