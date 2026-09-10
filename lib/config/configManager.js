const fs = require("fs");
const logger = require("../logging/logger.js")
const crypto = require("crypto")

const CONFIG_DIRECTORY_PATH = "./config"
const GLOBAL_CONFIG_PATH = `${CONFIG_DIRECTORY_PATH}/global.json`
const CURRENT_STATE_PATH = `${CONFIG_DIRECTORY_PATH}/state.json`
const USER_PRESET_PATH = `${CONFIG_DIRECTORY_PATH}/presets.json`

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
    const data = JSON.stringify(state, null, 2);
    let err = fs.writeFileSync(CURRENT_STATE_PATH, data, 'utf8');

	if (err) throw err;
}


/**
 * @returns {AppWebmixerPreset[]}
 */
function getPresets() {
    if (fs.existsSync(USER_PRESET_PATH)) {
        try {
            return JSON.parse(fs.readFileSync(USER_PRESET_PATH, "utf-8"));
        } catch (e) {
            logger.error("Failed to parse presets file, returning empty array.");
            return [];
        }
    }
    return [];
}

/**
 * @param {string} uuid 
 * @returns {AppWebmixerPreset | undefined}
 */
function getPresetById(uuid) {
    return getPresets().find(p => p.uuid === uuid);
}

/**
 * @param {string} name 
 * @returns {AppWebmixerPreset | undefined}
 */
function getPresetByName(name) {
    return getPresets().find(p => p.name === name);
}

/**
 * 
 * @param {AppWebmixerPreset} preset
 * @param {string} presetName
 * @returns {AppWebmixerPreset}
 */
function saveCurrentStateAsPreset(currentState, presetName) {
	let presets = getPresets();

	if (presets.find(p => p.name === presetName) !== undefined) {
        const error = new Error(`A preset named '${presetName}' already exists.`);
        error.code = 'PRESET_EXISTS';
        throw error;
    }

	const newPreset = {
		...structuredClone(currentState),
		uuid: crypto.randomUUID(),
		name: presetName,
		lastChanged: new Date().toISOString()
	};

	presets.push(newPreset);
	savePresetsToFile(presets);
	return newPreset;
}


function savePresetsToFile(presets) {
	try {
        const data = JSON.stringify(presets, null, 2);
        fs.writeFileSync(USER_PRESET_PATH, data, 'utf8');
    } catch (err) {
        logger.error(`Failed to write to ${USER_PRESET_PATH}: ${err.message}`);
        throw err;
    }
}

/**
 * Deletes a preset by its UUID
 * @param {string} uuid 
 */
function deletePreset(uuid) {
    let presets = getPresets();
    const index = presets.findIndex(p => p.uuid === uuid);

    if (index === -1) {
        const error = new Error(`Preset with UUID "${uuid}" not found.`);
        error.code = 'PRESET_NOT_FOUND';
        throw error;
    }

    presets.splice(index, 1);
    savePresetsToFile(presets);
    
    return true; 
}


module.exports = {
	ensureConfigDirectoryExists,
	getGlobalConfigOrDefault,
	getCurrentStateOrDefault,
	saveGlobalConfig,
	saveCurrentState,
	getPresets,
	getPresetById,
	getPresetByName,
	saveCurrentStateAsPreset,
	deletePreset
}