import Axios, { AxiosRequestConfig } from 'axios';

let version = 'unknown';

export const setVersion = (version2 : string) => version = version2;

export default (options : AxiosRequestConfig) => Axios({
	...options,
	headers: {
		...options?.headers,
		'user-agent': `MeliusLauncher / ${version}`
	}
});