const os = require('os');
const { ColorTranslator } = require('colortranslator');

/**
* Get the IP addresses for this device on the network.
* @returns string[]
*/
function getLANAddresses(interfaces = os.networkInterfaces()) {
    // Windows lists Hyper-V/WSL ahead of Wi-Fi. Those addresses are not reachable
    // from musicians' phones. Do not guess from 192/172/10: all can be real LANs.
    const virtual = /^(vEthernet|WSL|Loopback|docker|br-|veth|virbr|vmnet|vboxnet|utun|tun\d|tap\d|tailscale|wg\d)|Bluetooth|VirtualBox|VMware/i;
    return Object.entries(interfaces).flatMap(([name, addresses]) => virtual.test(name) ? [] :
        (addresses || []).filter(a => (a.family === "IPv4" || a.family === 4) && !a.internal &&
            !a.address.startsWith('169.254.') && !a.address.startsWith('127.') && a.address !== '0.0.0.0')
            .map(a => ({ name, address: a.address })));
}

function getIPAddresses() { return getLANAddresses().map(a => a.address); }

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
    if (index < 0 || index >= total) {
        throw new Error("Index must be non-negative and less than total.");
    }

    const hue = (360 / total) * index;
    return new ColorTranslator(`hsl(${hue} 50% 40%)`).HEX;
}

module.exports = { getLANAddresses, getIPAddresses, getMainIPAddress, generateColour };
