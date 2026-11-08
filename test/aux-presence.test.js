"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { sendAuxPresence, broadcastAuxPresence } = require('../lib/aux-presence');

function client(id, aux, username, extra = {}) {
  const messages = [];
  return { readyState: 1, clientInfo: { id, aux, username, address: 'private address', log: ['private history'] }, messages,
    send: raw => messages.push(JSON.parse(raw)), ...extra };
}
test('presence is AUX scoped, excludes self/observers/closed sockets and sends only IDs and nicknames', () => {
  const a = client(1, 2, 'Joe'), b = client(2, 2, 'Drummer'), other = client(3, 1, 'Singer');
  const observer = client(4, 2, 'Admin', { isObserver: true }), closed = client(5, 2, 'Left', { readyState: 3 });
  const sockets = [a, b, other, observer, closed];
  broadcastAuxPresence(sockets, 2);
  assert.deepEqual(a.messages, [{ presence: { aux: 2, peers: [{ id: '2', nickname: 'Drummer' }] } }]);
  assert.deepEqual(b.messages[0].presence.peers, [{ id: '1', nickname: 'Joe' }]);
  assert.equal(observer.messages.length, 0); assert.equal(other.messages.length, 0); assert.equal(closed.messages.length, 0);
  b.clientInfo.username = null;
  broadcastAuxPresence(sockets, 2);
  assert.equal(a.messages.at(-1).presence.peers[0].nickname, null);
  b.clientInfo.aux = 1;
  broadcastAuxPresence(sockets, 2); broadcastAuxPresence(sockets, 1);
  assert.deepEqual(a.messages.at(-1).presence.peers, []);
  assert.deepEqual(other.messages.at(-1).presence.peers, [{ id: '2', nickname: null }]);
  sendAuxPresence(a, []);
  assert.deepEqual(a.messages.at(-1).presence.peers, []);
});
