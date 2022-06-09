import UploadProgressInfo from './UploadProgressInfo';
import DownloadProgressInfo from './DownloadProgressInfo';

export interface RequestOptions {
    onUploadProgress?: (progressInfo : UploadProgressInfo) => void,
    onDownloadProgress?: (progressInfo : DownloadProgressInfo) => void,
    data?: string | Buffer,
    compression?: boolean,
    followRedirects?: boolean,
    maxRedirectCount?: number,
    stream?: boolean
}