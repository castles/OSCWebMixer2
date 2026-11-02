"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../web/admin.js"), "utf8");
const settle = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor() {
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.controls = new Map();
    this.rows = [];
    this.style = { setProperty: (name, value) => { this.attributes[name] = value; } };
    this.classList = { toggle() {}, remove() {} };
    this.lastElementChild = { textContent: "" };
  }
  set innerHTML(value) {
    this.markup = value;
    this.rows = [...value.matchAll(/class="live-channel" data-channel="(\d+)"/g)].map(match => {
      const row = new Element();
      row.dataset.channel = match[1];
      return row;
    });
  }
  querySelectorAll(selector) { return selector === ".live-channel" ? this.rows : []; }
  querySelector(selector) {
    if (!this.controls.has(selector)) this.controls.set(selector, new Element());
    return this.controls.get(selector);
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  replaceChildren() {}
  appendChild() {}
}

function snapshot() {
  return { version: "1.10.2", loaded: true, url: "http://localhost/", connections: 1, aux: [
    { channel: 1, label: "Drums", stereo: true }, { channel: 2, label: "Bass" },
  ], channels: [{ channel: 1, label: "Click" }, { channel: 2, label: "Vox" }], mixLevels: {
    1: [{ channel: 1, label: "Click", level: 0.3, pan: 0 }, { channel: 2, label: "Vox", level: null, pan: null }],
    2: [{ channel: 1, label: "Click", level: 0.2, pan: null }],
  } };
}

async function createAdmin() {
  const elements = new Map();
  const sockets = [];
  const timers = new Map();
  let timerId = 0;
  let fetchStatus = async () => ({ ok: true, json: async () => snapshot() });
  class Socket {
    static CONNECTING = 0;
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(value); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const control = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: control, querySelectorAll: () => [], body: new Element(),
      createElement: () => new Element(), dispatchEvent() {}, addEventListener() {} },
    window: { location: { hash: "#live-mix" }, addEventListener() {} },
    location: { protocol: "http:", host: "localhost" },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    AdminSidebarState: { collapsed: false, set() {} },
    appIcon: () => "", renderAdminPassword() {},
    CustomEvent: class {}, WebSocket: Socket,
    adminFetch: (...args) => fetchStatus(...args),
    setInterval() {},
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const run = code => vm.runInContext(code, context);
  run(source);
  await settle();
  const message = (channel, aux, parameter, value, socket = sockets.at(-1)) => socket.onmessage({
    data: JSON.stringify({ address: `/Input_Channels/${channel}/Aux_Send/${aux}/send_${parameter}`, args: [value] }),
  });
  return { run, sockets, timers, control, message, setFetch: callback => { fetchStatus = callback; } };
}

test("admin observer applies live levels and pan in place before any status poll", async () => {
  const admin = await createAdmin();
  assert.equal(admin.control("appVersion").textContent, "v1.10.2");
  assert.equal(admin.control("appVersion").title, "EarsMixer v1.10.2");
  const socket = admin.sockets[0];
  assert.equal(socket.url, "ws://localhost/?role=observer");
  const row = admin.control("liveMixChannels").rows[0];
  admin.message(1, 1, "level", -6);
  assert.equal(row.querySelector(".level-readout").textContent, "48%");
  assert.equal(row.querySelector(".volume").attributes["--value"], "48%");
  assert.equal(row.querySelector(".fader-track").attributes["aria-valuenow"], "48");
  admin.message(1, 1, "level", -150);
  assert.equal(row.querySelector(".level-readout").textContent, "0%");
  admin.message(1, 1, "level", 10);
  assert.equal(row.querySelector(".level-readout").textContent, "100%");
  admin.message(1, 1, "pan", 0.75);
  assert.equal(row.querySelector(".pan-readout").textContent, "R 50");
  assert.equal(row.querySelector(".pan-display").attributes["--value"], "75%");
  assert.equal(admin.control("liveMixChannels").rows[0], row, "streamed changes must not rebuild channel strips");
  assert.equal(socket.sent.length, 0, "observing must never send desk controls");
});

test("admin stream filters invalid values and other AUXes, and reveals newly loaded channels", async () => {
  const admin = await createAdmin();
  const row = admin.control("liveMixChannels").rows[0];
  admin.message(1, 2, "level", 10);
  assert.equal(row.querySelector(".level-readout").textContent, undefined);
  assert.equal(admin.run("mixLevels[2][0].level"), 1, "other AUXes update their cache only");
  for (const data of ["broken JSON", "null", '{"args":[0]}', '{"address":"/Input_Channels/1/Aux_Send/1/send_level","args":["10"]}']) {
    admin.sockets[0].onmessage({ data });
  }
  assert.equal(admin.run("mixLevels[1][0].level"), 0.3);
  admin.message(999, 1, "level", 10);
  assert.equal(admin.run("mixLevels[1].length"), 2);
  admin.message(2, 1, "level", 0);
  assert.match(admin.control("liveMixChannels").markup, /Vox/);
  assert.match(admin.control("liveMixChannels").markup, /63%/);
});

test("an in-flight status snapshot cannot roll back a newer streamed level or pan", async () => {
  const admin = await createAdmin();
  let respond;
  admin.setFetch(() => new Promise(resolve => { respond = resolve; }));
  const loading = admin.run("loadStatus()");
  admin.message(1, 1, "level", 10);
  admin.message(1, 1, "pan", 0);
  respond({ ok: true, json: async () => snapshot() });
  await loading;
  assert.equal(admin.run("mixLevels[1][0].level"), 1);
  assert.equal(admin.run("mixLevels[1][0].pan"), -1);
  assert.match(admin.control("liveMixChannels").markup, /100%/);
});

test("observer reconnects, reconciles missed values, and stops when leaving live mix", async () => {
  const admin = await createAdmin();
  const oldSocket = admin.sockets[0];
  oldSocket.close();
  const retry = [...admin.timers.values()].find(timer => timer.delay === 1000);
  assert(retry);
  retry.callback();
  const newSocket = admin.sockets[1];
  assert(newSocket);
  admin.message(1, 1, "level", 10, oldSocket);
  assert.equal(admin.run("mixLevels[1][0].level"), 0.3, "ignore messages from superseded sockets");
  let fetches = 0;
  admin.setFetch(async () => { fetches++; return { ok: true, json: async () => snapshot() }; });
  newSocket.onopen();
  await settle();
  assert.equal(fetches, 1);
  admin.run('showPage("overview")');
  assert.equal(newSocket.readyState, 3);
  assert.equal(admin.run("liveMixSocket"), null);
  assert.equal(admin.run("liveMixReconnectTimer"), null);
});

test("overview URL edits survive polling and a successful save updates the link and QR immediately", async () => {
  const admin = await createAdmin();
  const input = admin.control("customMixerUrl");
  input.value = "ears.glow.uk";
  input.listeners.get("input")();
  await admin.run("loadStatus()");
  assert.equal(input.value, "ears.glow.uk", "polling must not overwrite an unfinished edit");
  admin.setFetch(async (route, options) => {
    assert.equal(route, "/api/admin/mixer-url");
    assert.equal(options.method, "PUT");
    assert.deepEqual(JSON.parse(options.body), { url: "ears.glow.uk" });
    return { ok: true, json: async () => ({ customMixerUrl: "http://ears.glow.uk", url: "http://ears.glow.uk/", qr: "custom-qr" }) };
  });
  await admin.control("mixerUrlForm").listeners.get("submit")({ preventDefault() {} });
  assert.equal(input.value, "http://ears.glow.uk");
  assert.equal(admin.control("mixerUrl").href, "http://ears.glow.uk/");
  assert.equal(admin.control("qrCode").src, "custom-qr");
  assert.equal(admin.run("currentUrl"), "http://ears.glow.uk/", "Copy uses the saved URL too");
  assert.equal(admin.control("saveMixerUrl").disabled, false);
});

test("an old status response cannot undo a custom URL save, and validation failures preserve edits", async () => {
  const admin = await createAdmin();
  let respond;
  admin.setFetch((route) => route.includes("/status") ? new Promise(resolve => { respond = resolve; })
    : Promise.resolve({ ok: true, json: async () => ({ customMixerUrl: "http://ears.glow.uk", url: "http://ears.glow.uk/", qr: "custom-qr" }) }));
  const loading = admin.run("loadStatus()");
  await admin.control("mixerUrlForm").listeners.get("submit")({ preventDefault() {} });
  respond({ ok: true, json: async () => snapshot() });
  await loading;
  assert.equal(admin.control("mixerUrl").href, "http://ears.glow.uk/");
  assert.equal(admin.control("qrCode").src, "custom-qr");
  admin.control("customMixerUrl").value = "invalid URL";
  admin.control("customMixerUrl").listeners.get("input")();
  admin.setFetch(async () => ({ ok: false, json: async () => ({ error: "Enter a valid URL." }) }));
  await admin.control("mixerUrlForm").listeners.get("submit")({ preventDefault() {} });
  assert.equal(admin.control("customMixerUrl").value, "invalid URL");
  assert.equal(admin.control("mixerUrlMessage").textContent, "Enter a valid URL.");
  assert.equal(admin.control("mixerUrl").href, "http://ears.glow.uk/");
  assert.equal(admin.control("customMixerUrl").disabled, false);
});
