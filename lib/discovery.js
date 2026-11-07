"use strict";

const os = require('node:os');
const { getResponder } = require('@homebridge/ciao');
const { getLANAddresses } = require('./utils/utils');

// DNS-SD is only a locator. Clients still verify /api/connection and authenticate
// normally. Never advertise account information, tokens or saved layouts.
function advertiseMixer({ port, version, bindAddress = '0.0.0.0', logger = console,
    hostname = os.hostname(), addresses = getLANAddresses, responderFactory = getResponder,
    refreshMs = 15000 }) {
    let responder, stopped = false, fingerprint = '', refreshing = false;
    const name = `EarsMixer - ${hostname.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 35)} (${port})`;

    async function refresh() {
        if (stopped || refreshing) return;
        refreshing = true;
        try {
            const selected = addresses().filter(a => bindAddress === '0.0.0.0' || bindAddress === '::' || a.address === bindAddress);
            const next = JSON.stringify(selected);
            if (next === fingerprint) return;
            fingerprint = next;
            const previous = responder;
            responder = undefined;
            if (previous) await previous.shutdown();
            if (stopped || !selected.length) return;
            responder = responderFactory({ interface: [...new Set(selected.map(a => a.name))], excludeIpv6: true });
            const service = responder.createService({ name, type: 'earsmixer', port,
                disabledIpv6: true, restrictedAddresses: selected.map(a => a.address),
                txt: { product: 'EarsMixer', protocol: '1', version, path: '/' } });
            // Advertising may wait for the network. Do not delay HTTP startup.
            service.advertise().then(() => {
                if (!stopped) logger.info(`Local discovery: ${name} on port ${port}.`);
            }).catch(error => { if (!stopped) logger.warn(`Local discovery unavailable: ${error.message}. Manual connections still work.`); });
        } catch (error) {
            fingerprint = ''; // retry after interfaces or permissions change
            logger.warn(`Local discovery unavailable: ${error.message}. Manual connections still work.`);
        } finally { refreshing = false; }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), refreshMs);
    timer.unref();
    return async function stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        const previous = responder;
        responder = undefined;
        if (previous) await previous.shutdown().catch(error => logger.warn(`Discovery shutdown: ${error.message}`));
    };
}

module.exports = { advertiseMixer };
