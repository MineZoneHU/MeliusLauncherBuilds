import Axios, { AxiosRequestConfig } from 'axios';
import * as ElectronUpdater from 'electron-updater';

export default (options : AxiosRequestConfig) => Axios({
	...options,
	headers: {
		...options?.headers,
		'user-agent': `MeliusLauncher / ${ElectronUpdater.autoUpdater.currentVersion.version}`
	}
});