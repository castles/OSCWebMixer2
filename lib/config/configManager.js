const fs = require("fs");
const logger = require("../logging/logger.js")

const CONFIG_DIRECTORY_PATH = "./config"
const GLOBAL_CONFIG_PATH = `${CONFIG_DIRECTORY_PATH}/global.json`
const CURRENT_STATE_PATH = `${CONFIG_DIRECTORY_PATH}/state.json`

/**
 * Checks if the config directory exists and creates it if not
 * @returns {boolean} Whether the config directory existed prior to executing this function.
 */
function ensureConfigDirectoryExists() {
    if (!fs.existsSync(CONFIG_DIRECTORY_PATH)) {
		logger.warn(`Configuration directory "${CONFIG_DIRECTORY_PATH}" not found. Creating empty directory.`)
        fs.mkdirSync(CONFIG_DIRECTORY_PATH)
		return false
    }
	return true
}

/**
 * Load global config from disk. If it doesn't exist then use default values.
 * @param {string} filename 
 * @returns {AppGlobalConfig} Global config object
 */
function getGlobalConfigOrDefault() {
    if (!fs.existsSync(GLOBAL_CONFIG_PATH)) {
        logger.warn(`Global configuration file "${GLOBAL_CONFIG_PATH}" does not exist. Using default values.`)
		return {
			debug: false,
			server: {
				port: 80
			},
			osc: {
				port: 8000
			},
			desk: {
				ip: "",
				port: 9000
			},
			externalDevices: []
		};
    }

	return JSON.parse(
            fs.readFileSync(GLOBAL_CONFIG_PATH, "utf-8")
	)
}

/**
 * 
 * @param {AppGlobalConfig} config 
 */
function saveGlobalConfig(config) {
	logger.info("Saving global config.")
	const data = JSON.stringify(config, null, 2);
    let err = fs.writeFileSync(GLOBAL_CONFIG_PATH, data, 'utf8');
	
	if (err) throw err;
}


/**
 * Get application save state
 * @returns {AppWebmixerPreset}
 */
function getCurrentStateOrDefault() {
	if (!fs.existsSync(CURRENT_STATE_PATH)) {
		logger.warn(`Current state configuration file "${CURRENT_STATE_PATH}" does not exist. Starting from a blank state.`)
		return {
            uuid: "",
            name: "Default",
            sessionName: "",
            auxes: [],
            channels: []
        };
	}

	return JSON.parse(
		fs.readFileSync(CURRENT_STATE_PATH, "utf-8")
	)
}

/**
 * Saves the current runtime state to state.json
 * @param {AppWebmixerPreset} state 
 */
function saveCurrentState(state) {
	logger.info("Saving current Webmixer state.")
    const data = JSON.stringify(state, null, 2);
    let err = fs.writeFileSync(CURRENT_STATE_PATH, data, 'utf8');

	if (err) throw err;
}


module.exports = {
	ensureConfigDirectoryExists,
	getGlobalConfigOrDefault,
	getCurrentStateOrDefault,
	saveGlobalConfig,
	saveCurrentState,
}