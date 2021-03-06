const path = require('path');
const fs = require('fs');
const _ = require('lodash');

let config;
const fileCache = {};

const env = function () {
	return process.env.NODE_ENV || 'development';
};

/**
 * These are all available through cfg
 * @see cfg
 * @namespace config
 */

function isObject(obj) {
	return Object.prototype.toString.call(obj) === '[object Object]';
}

// merge configs, takes care of getters while merging
function merge(obj, src) {
	if (!src) return obj;

	Object.keys(src).forEach((key) => {
		const objVal = Object.getOwnPropertyDescriptor(obj, key);
		const srcVal = Object.getOwnPropertyDescriptor(src, key);

		if (
			objVal &&
			!objVal.get &&
			!srcVal.get &&
			isObject(srcVal.value) &&
			isObject(objVal.value)
		) {
			merge(obj[key], src[key]);
			return;
		}

		Object.defineProperty(obj, key, srcVal);
	});

	return obj;
}

/**
 * Reads a config value
 * @param {string} key key to read, can be nested like `a.b.c`
 * @param {*} defaultValue value to return if key is not found
 * @return {any}
 */
function cfg(key, defaultValue) {
	// eslint-disable-next-line no-use-before-define
	readDefaultConfigFiles();
	return _.get(config, key, defaultValue);
}

/**
 * Will read env vars of the format CFG__JSON_KEY__PATH=$VAL
 * It will set the key 'jsonKey.path' with $VAL
 * _ to specify where to capitalize for camelCase
 * __ to seperate the key path
 * @private
 */
function readEnvVariables() {
	const vals = Object.keys(process.env).filter(val => val.indexOf('CFG__') === 0);
	vals.forEach((val) => {
		const key = val.slice(5).split('__').map(el => _.camelCase(el)).join('.');
		let envVal = process.env[val];
		if (envVal && envVal.startsWith('@JSON:')) {
			try {
				envVal = JSON.parse(envVal.substring(6));
			}
			catch (e) {
				console.error(`Error while parsing JSON value of env variable ${val}`);
			}
		}
		cfg.set(key, envVal);
	});
}

function readDefaultConfigFiles() {
	if (config) return;
	config = {};

	const cwd = process.cwd();
	const privatePath = path.join(cwd, 'private');
	cfg.file(path.join(cwd, 'config.js'), {ignoreNotFound: true});
	cfg.file(path.join(cwd, `config.${env()}.js`), {ignoreNotFound: true});
	if (cfg.isCI()) cfg.file(path.join(cwd, 'config.CI.js'), {ignoreNotFound: true});
	cfg.file(path.join(privatePath, 'config.js'), {ignoreNotFound: true});
	cfg.file(path.join(privatePath, `config.${env()}.js`), {ignoreNotFound: true});
	if (cfg.isCI()) cfg.file(path.join(privatePath, 'config.CI.js'), {ignoreNotFound: true});

	if (config.$privateConfigFile) {
		cfg.file(config.$privateConfigFile, {ignoreNotFound: true});
	}

	readEnvVariables();
}
/**
 * @memberof config
 * @param {string} key
 * @param {any} defaultValue
 * @return {any}
 */
cfg.get = function (key, defaultValue) {
	return cfg(key, defaultValue);
};

/**
 * @memberof config
 * @return {object}
 */
cfg._getConfig = function () {
	return config;
};

/** set values in global config
 * you can also give key as an object to assign all key values from it
 * @memberof config
 * @param {string | object} key
 * @param {any} [value]
 * @return {null | any}
 */
cfg.set = function (key, value) {
	readDefaultConfigFiles();

	// if key is Object then merge it with existing config
	if (value === undefined && key instanceof Object) {
		Object.assign(config, key);
		Object.assign(config, key[`$env_${env()}`]);
		if (cfg.isCI()) Object.assign(config, key.$env_CI);
		return null;
	}

	const prev = _.get(config, key);
	_.set(config, key, value);
	return prev;
};

/**
 * set values in global config with an object to assign all key values from it
 * if a key already exists then it is merged with new value
 * if obj is not an Object then nothing happens
 * @memberof config
 * @param {object} obj
 * @return {void}
 */
cfg.merge = function (obj) {
	readDefaultConfigFiles();

	if (obj instanceof Object) {
		merge(config, obj);
		merge(config, obj[`$env_${env()}`]);
		if (cfg.isCI()) merge(config, obj.$env_CI);
	}
};

/**
 * set values in global config with an object to assign all key values from it
 * if a key already exists then it is assigned with new value
 * if obj is not an Object then nothing happens
 * @memberof config
 * @param {object} obj
 * @return {void}
 */
cfg.assign = function (obj) {
	readDefaultConfigFiles();

	if (obj instanceof Object) {
		Object.assign(config, obj);
		Object.assign(config, obj[`$env_${env()}`]);
		if (cfg.isCI()) Object.assign(config, obj.$env_CI);
	}
};

/**
 * @memberof config
 * @param {string} key
 * @return {void}
 */
cfg.delete = function (key) {
	readDefaultConfigFiles();
	delete config[key];
};

/**
 * read config from a file, and merge with existing config
 * @memberof config
 * @param {string} file path of the file to read (only absolute paths)
 * @param {object} options options obj
 * @param {boolean} options.ignoreErrors ignore all errors
 * @param {boolean} options.ignoreNotFound ignore if file not found
 * @param {boolean} options.overwrite Overwrite config not merge
 */
cfg.file = function (file, options = {}) {
	if (!path.isAbsolute(file)) {
		throw new Error('Only absolute paths are allowed');
	}

	try {
		// eslint-disable-next-line global-require, import/no-dynamic-require
		const data = require(file);
		if (options.overwrite === true && typeof data === 'object') {
			config = data;
		}
		else {
			cfg.merge(data);
		}
	}
	catch (e) {
		if (e.code === 'MODULE_NOT_FOUND' && options.ignoreNotFound) {
			// Ignore Not Found Errors
			return;
		}
		if (options.ignoreErrors) {
			// Ignore All Errors
			return;
		}

		throw e;
	}
};

/**
 * read the file specified by the key, and then cache it
 * @memberof config
 * @param {string} key
 * @return {any} value
 */
cfg.read = function (key) {
	if (key in fileCache) {
		return fileCache[key];
	}

	const filePath = cfg(key);
	if (!filePath) {
		fileCache[key] = undefined;
	}
	else {
		try {
			fileCache[key] = fs.readFileSync(filePath);
		}
		catch (e) {
			console.error(`[cfg] can't read file ${key}: ${filePath}`, e);
		}
	}

	return fileCache[key];
};

/**
 * @memberof config
 * @return {boolean}
 */
cfg.isProduction = function () {
	return env() === 'production';
};

/**
 * @memberof config
 * @return {boolean}
 */
cfg.isStaging = function () {
	return env() === 'staging';
};

/**
 * Returns true if env is production or staging
 * @memberof config
 * @return {boolean}
 */
cfg.isProductionLike = function () {
	return (env() === 'production') || (env() === 'staging');
};

/**
 * @memberof config
 * @return {boolean}
 */
cfg.isTest = function () {
	return env() === 'test';
};

/**
 * @memberof config
 * @return {boolean}
 */
cfg.isDev = function () {
	return (env() !== 'production') && (env() !== 'staging');
};

/**
 * @memberof config
 * @return {boolean}
 */
cfg.isCI = function () {
	return !!process.env.CI;
};

/**
 * @memberof config
 * @returns {string}
 */
cfg.env = env;
/**
 * @memberof config
 * @return {string}
 */
cfg.getEnv = env;

cfg.isProd = cfg.isProduction;
cfg.isProdLike = cfg.isProductionLike;
cfg.isDevelopment = cfg.isDev;

module.exports = cfg;
