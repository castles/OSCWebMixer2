const os = require('os');
const { ColorTranslator } = require('colortranslator');

/**
* Get the IP addresses for this device on the network.
* @returns string[]
*/
function getIPAddresses() {
    const interfaces = os.networkInterfaces();
    return Object.values(interfaces)
        .flat()
        .filter(a => a.family === "IPv4" && !a.internal)
        .map(a => a.address);
}

/**
 * Get the IP address of this device's main network interface.
 * @returns string
 */
function getMainIPAddress() { return getIPAddresses()[0]; }

/**
 * Generate a hex colour for an aux
 * @param {int} number
 * @returns
 */
function generateColour(total = 16, index) {
    if (index < 0 || index < total === 0) {
        throw new Error("Index must be non-negative and less than total.");
    }

    const hue = (360 / total) * index;
    return new ColorTranslator(`hsl(${hue} 50% 40%)`).HEX;
}

/**
 * Add or update key: value to an object at a position in an array
 * @param {object} objectArray - the object to add to
 * @param {int} position - the position of the object in an array
 * @param {string} key - the key to set
 * @param {int|float|string} value - the value of the key to set
 */
function addToObject(objectArray, position, key, value) {
    if (objectArray[position] != undefined) { objectArray[position][key] = value; return; }
    objectArray[position] = { [key]: value };
}

module.exports = { getIPAddresses, getMainIPAddress, generateColour, addToObject };