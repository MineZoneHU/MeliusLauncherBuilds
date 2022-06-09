import * as http from 'http';
import * as stream from 'stream';

export interface RequestStreamResponse {
    head: {
        headers: http.IncomingHttpHeaders,
        httpVersion: string,
        httpVersionMajor: number,
        httpVersionMinor: number,
        method?: string,
        statusCode: number,
        statusMessage: string,
    },
    body: stream.Readable
}