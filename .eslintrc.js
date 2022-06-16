// eslint-disable-next-line no-undef
module.exports = {
	env: {
		browser: true,
		es2021: true
	},
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended'
	],
	parser: '@typescript-eslint/parser',
	parserOptions: {
		ecmaVersion: 'latest',
		sourceType: 'module'
	},
	plugins: [
		'@typescript-eslint'
	],
	rules: {
		'comma-dangle': [
			'error',
			'never'
		],
		indent: [
			'error',
			'tab',
			{
				SwitchCase: 1
			}
		],
		'linebreak-style': [
			'error',
			'windows'
		],
		quotes: [
			'error',
			'single'
		],
		semi: [
			'error',
			'always'
		],
		'no-async-promise-executor': 'off',
		'no-unused-vars': 'off',
		'@typescript-eslint/no-unused-vars': ['off']
	},
	ignorePatterns: [
		'build/**/*',
		'buildtools/**/*',
		'src/static/js/**/*'
	]
};
