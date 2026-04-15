/**
 * @typedef {Object} OSCConfig
 * @property {number} port
 */

/**
 * @typedef {Object} ServerConfig
 * @property {string} ip
 * @property {number} port
 */

/**
 * @typedef {Object} DeskConfig
 * @property {string} ip
 * @property {number} port
 */

/**
 * @typedef {Object} DeskConfig
 * @property {string} ip
 * @property {number} port
 */

/**
 * Configuration for an external device (e.g., iPad, Tablet)
 * @typedef {Object} ExternalDevice
 * @property {string} name - Friendly name of the device
 * @property {string} ip - IP address of the device
 * @property {number} port - Port number
 * @property {boolean} broadcast - Whether to broadcast OSC messages to the device
 * @property {boolean} loopback - Whether to loopback own OSC messages to the device
 */

/**
 * @typedef {Object} AppGlobalConfig
 * @property {boolean} debug
 * @property {ServerConfig} server
 * @property {OSCConfig} osc
 * @property {DeskConfig} desk
 * @property {ExternalDeviceConfig[]} externalDevices - Description of what the external array contains
 */



/**
 * @typedef {Object} AuxConfig
 * @property {boolean} enabled - Whether the aux is enabled
 * @property {string} colour - Hexadecimal color string (e.g., "#993333")
 * @property {string} icon - Path or identifier for the icon
 */

/**
 * @typedef {Object} ChannelConfig
 * @property {boolean} enabled - Whether the channel is enabled
 * @property {number} displayOrder - The display or processing order
 * @property {string} title - The display name of the channel
 * @property {string} icon - Path or identifier for the icon
 */

/**
 * @typedef {Object} AppWebmixerPreset
 * @property {string} uuid
 * @property {string} name
 * @property {string} sessionName 
 * @property {AuxConfig[]} auxes
 * @property {ChannelConfig[]} channels
 */