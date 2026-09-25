import Axios, { AxiosRequestConfig } from 'axios';

let version = 'unknown';

export const setVersion = (version2 : string) => version = version2;

export default (options : AxiosRequestConfig) => Axios({
	...options,
	headers: {
		...options?.headers,
		'user-agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 MeliusLauncher/${version}`
	}
});