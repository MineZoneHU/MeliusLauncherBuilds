import * as http from 'http';

export interface RequestBufferResponse {
    head: {
        headers: http.IncomingHttpHeaders,
        httpVersion: string,
        httpVersionMajor: number,
        httpVersionMinor: number,
        method?: string,
        statusCode: number,
        statusMessage: string,
    },
    body: Buffer
}