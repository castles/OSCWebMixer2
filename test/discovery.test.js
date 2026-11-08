'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { advertiseMixer } = require('../lib/discovery');
const { getLANAddresses } = require('../lib/utils/utils');
const tick = () => new Promise(resolve => setImmediate(resolve));
const address = (value, extra = {}) => ({ family: 'IPv4', address: value, internal: false, ...extra });

test('LAN links exclude Hyper-V, WSL, VPN and link-local but allow real 172/10 networks', () => {
  assert.deepEqual(getLANAddresses({
    'vEthernet (Default Switch)': [address('172.20.224.1')],
    'vEthernet (WSL)': [address('172.21.80.1')],
    'Wi-Fi': [address('192.168.8.108')],
    Ethernet: [address('172.20.1.3'), address('10.0.0.4')],
    lo: [address('127.0.0.1', { internal: true })],
    'Wi-Fi 4': [address('169.254.1.1')],
    docker0: [address('172.17.0.1')],
    utun0: [address('10.1.1.1')],
  }), [{ name: 'Wi-Fi', address: '192.168.8.108' }, { name: 'Ethernet', address: '172.20.1.3' }, { name: 'Ethernet', address: '10.0.0.4' }]);
});

test('advertises the actual HTTP port and only LAN addresses; shutdown is idempotent', async () => {
  const created = [], shutdown = [];
  const stop = advertiseMixer({ port: 8082, version: '1.4.0', hostname: 'Studio-PC',
    addresses: () => [{ name: 'Wi-Fi', address: '192.168.8.108' }], logger: { info() {}, warn() {} },
    responderFactory: options => {
      assert.deepEqual(options, { interface: ['Wi-Fi'], excludeIpv6: true });
      return { createService: value => { created.push(value); return { advertise: async () => {} }; }, shutdown: async () => { shutdown.push(true); } };
    } });
  await tick();
  assert.equal(created[0].type, 'earsmixer');
  assert.equal(created[0].port, 8082);
  assert.deepEqual(created[0].restrictedAddresses, ['192.168.8.108']);
  assert.deepEqual(created[0].txt, { product: 'EarsMixer', protocol: '1', version: '1.4.0', path: '/' });
  await stop(); await stop();
  assert.equal(shutdown.length, 1);
});

test('loopback-only HTTP listeners never advertise a reachable LAN service', async () => {
  let called = false;
  const stop = advertiseMixer({ port: 8082, version: 'test', bindAddress: '127.0.0.1',
    addresses: () => [{ name: 'Wi-Fi', address: '192.168.8.108' }],
    responderFactory: () => { called = true; throw Error('must not advertise'); } });
  await tick(); await stop(); assert.equal(called, false);
});

test('network changes replace advertisements and errors do not stop HTTP', async () => {
  let current = [], created = 0, stopped = 0;
  const stop = advertiseMixer({ port: 80, version: 'test', refreshMs: 10, addresses: () => current,
    logger: { info() {}, warn() {} }, responderFactory: () => ({
      createService: () => { created++; return { advertise: async () => {} }; }, shutdown: async () => { stopped++; },
    }) });
  const wait = () => new Promise(resolve => setTimeout(resolve, 40));
  await wait(); assert.equal(created, 0);
  current = [{ name: 'Wi-Fi', address: '192.168.8.108' }];
  await wait(); assert.equal(created, 1);
  current = [{ name: 'Wi-Fi', address: '192.168.8.109' }];
  await wait(); assert.equal(created, 2); assert.equal(stopped, 1);
  await stop(); assert.equal(stopped, 2);
  const failed = advertiseMixer({ port: 80, version: 'test', addresses: () => current,
    logger: { info() {}, warn() {} }, responderFactory: () => { throw Error('UDP blocked'); } });
  await tick(); await failed();
});
