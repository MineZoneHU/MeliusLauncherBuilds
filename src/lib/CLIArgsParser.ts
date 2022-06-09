const options = {};

export const parse = () => {
	let arg : string, argName : string, argValue : string;
	for(let i = 2; i < process.argv.length; i++) {
		arg = process.argv[i];
		if(!arg.startsWith('--')) continue;
		[ argName, argValue ] = arg.substring(2).split('=', 2);
		options[argName.toLowerCase()] = argValue ?? null;
	}
};

export const hasOption = (option : string) => options[option.toLowerCase()] !== undefined;
export const getOption = (option : string) => options[option.toLowerCase()] ?? null;
