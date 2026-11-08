"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const mixerSource = fs.readFileSync(path.join(__dirname, "../web/mixer.js"), "utf8");

// Represent the controls needed to verify native data and cross-script behavior.
// Full rendering still needs a browser check.
class Control {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.style = { setProperty() {} };
    this.classList = { contains: () => false, toggle() {} };
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.textContent = "";
  }
  set innerHTML(markup) {
    if (!markup.includes("channel-header")) return;
    this.controls = new Map([".channel-name", ".volumeInput", ".fader-thumb", ".level-readout", ".drag-handle", 'input[name="fav[]"]'].map(selector => [selector, new Control()]));
  }
  querySelector(selector) { return this.controls?.get(selector) || null; }
  querySelectorAll(selector) {
    const favourite = selector.includes("fav[]");
    const controls = this.children.map(row => row.querySelector(favourite ? 'input[name="fav[]"]' : ".volumeInput"));
    return controls.filter(control => control && (!selector.includes(":checked") || control.checked));
  }
  appendChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    this.children.push(child);
    if (this.tagName === "SELECT" && !this.value) this.value = child.value;
    return child;
  }
  replaceChildren() { this.children = []; this.value = ""; }
  get options() { return this.children; }
  get selectedOptions() { return this.children.filter(option => option.value === this.value); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatchEvent(event) { for (const listener of this.listeners.get(event.type) || []) listener.call(this, event); }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent({ type: "close" }); }
  focus() {}
  getBoundingClientRect() { return { width: 228 }; }
  setPointerCapture(id) { this.pointerId = id; }
  hasPointerCapture(id) { return this.pointerId === id; }
  releasePointerCapture() { this.pointerId = null; }
}

function createMixer(source = mixerSource, storage = new Map()) {
  const controls = new Map();
  const documentEvents = new Control();
  const windowEvents = new Control();
  const timers = new Map();
  let now = 0;
  let nextTimerId = 0;
  class Socket {
    static OPEN = 1;
    static CONNECTING = 0;
    constructor() { this.readyState = Socket.OPEN; this.sent = []; }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const document = {
    body: new Control(),
    fullscreenElement: null,
    getElementById(id) {
      if (!controls.has(id)) controls.set(id, new Control(id === "aux" ? "select" : "div"));
      return controls.get(id);
    },
    createElement: tag => new Control(tag),
    addEventListener: (...args) => documentEvents.addEventListener(...args),
    dispatchEvent: event => documentEvents.dispatchEvent(event),
  };
  const context = vm.createContext({
    document,
    confirm: () => false,
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
      key: index => [...storage.keys()][index] ?? null,
      get length() { return storage.size; },
    },
    WebSocket: Socket,
    Sortable: class { destroy() {} option() {} },
    Event: class { constructor(type) { this.type = type; } },
    location: { protocol: "http:", host: "localhost" },
    window: { addEventListener: (...args) => windowEvents.addEventListener(...args), matchMedia: () => ({ matches: false, addEventListener() {} }) },
    appIcon: () => "",
    sendDeviceNickname() {},
    setTimeout(callback, delay = 0) { const id = ++nextTimerId; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const run = code => vm.runInContext(code, context);
  run(source);
  const message = json => run("onMessage({data:" + JSON.stringify(JSON.stringify(json)) + "})");
  const slider = id => run('channelElements.get("' + id + '").slider');
  const socket = () => run("ws");
  function tick(milliseconds) {
    const target = now + milliseconds;
    while (true) {
      const next = Array.from(timers).filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].due; next[1].callback();
    }
    now = target;
  }
  message({ config: {
    snapshot: "Test cue",
    channels: [{ channel: 65, label: "Guitar", enabled: true, order: 2 }, { channel: 2, label: "Vocal", enabled: true, order: 1 }, { channel: 3, label: "Hidden", enabled: false }],
    aux: [{ channel: 2, label: "Joe", enabled: true, colour: "#123456" }, { channel: 4, label: "Band", enabled: true, colour: "#ff0000" }, { channel: 1, label: "Hidden", enabled: false }],
  } });
  const level = (channel, aux, db) => message({ address: `/Input_Channels/${channel}/Aux_Send/${aux}/send_level`, args: [db] });
  return { controls, run, message, slider, socket, tick, level, writes: () => socket().sent.filter(message => /\/send_level$/.test(message.address || "")) };
}

test("production mixer autosaves a local nickname, shares it live and has no template flow", () => {
  const storage = new Map([["profileId", "old"], ["templateChoice", "old template"], ["channelLayout", "[65,2]"]]);
  const source = fs.readFileSync(path.join(__dirname, "../web/mixer.min.js"), "utf8");
  const identity = fs.readFileSync(path.join(__dirname, "../web/identity.js"), "utf8");
  const mixer = createMixer(source, storage);
  mixer.run(identity);
  assert.equal(mixer.controls.get("nicknameDialog").open, true);
  const nickname = mixer.controls.get("nickname");
  nickname.value = "  Joe   Drums  "; nickname.dispatchEvent({ type: "input" });
  assert.equal(storage.get("deviceUsername"), "Joe Drums");
  assert.equal(mixer.controls.get("nicknameLabel").textContent, "Joe Drums");
  assert.equal(mixer.socket().sent.at(-1).username, "Joe Drums");
  assert.equal(storage.get("channelLayout"), "[65,2]");
  assert.equal(storage.has("profileId"), false); assert.equal(storage.has("templateChoice"), false);
  assert.equal(mixer.writes().length, 0);
  mixer.controls.get("closeNickname").dispatchEvent({ type: "click" });
  const next = createMixer(source, storage); next.run(identity);
  assert.notEqual(next.controls.get("nicknameDialog").open, true);
  assert.equal(next.controls.get("nicknameLabel").textContent, "Joe Drums");
  const html = fs.readFileSync(path.join(__dirname, "../web/index.html"), "utf8");
  assert(!/templates\.js|savedTemplate|loadTemplate|startFresh|profileDialog/.test(html));
});

test("skipping a nickname is remembered; invalid nicknames stay open and do not overwrite stored data", () => {
  const storage = new Map();
  const identity = fs.readFileSync(path.join(__dirname, "../web/identity.js"), "utf8");
  const mixer = createMixer(mixerSource, storage); mixer.run(identity);
  mixer.controls.get("skipNickname").dispatchEvent({ type: "click" });
  const next = createMixer(mixerSource, storage); next.run(identity);
  assert.notEqual(next.controls.get("nicknameDialog").open, true);
  next.controls.get("editNickname").dispatchEvent({ type: "click" });
  next.controls.get("nickname").value = "x".repeat(81);
  next.controls.get("nicknameForm").dispatchEvent({ type: "submit", preventDefault() {} });
  assert.equal(next.controls.get("nicknameDialog").open, true);
  assert.equal(storage.has("deviceUsername"), false);
  assert.equal(next.controls.get("nicknameError").textContent, "Use up to 80 characters.");
  assert.equal(next.writes().length, 0);
});

test("mixer filters enabled controls, sorts configured order and queries actual channel IDs", () => {
  const mixer = createMixer();
  assert.deepEqual(mixer.controls.get("channels").children.map(row => row.dataset.channel), ["2", "65"]);
  assert.deepEqual(mixer.controls.get("aux").options.map(option => option.value), ["2", "4"]);
  assert.deepEqual(mixer.socket().sent[0], { selectedAux: 2 });
  mixer.tick(30);
  assert.deepEqual(mixer.socket().sent.filter(message => message.address).map(message => message.address), [
    "/Input_Channels/2/Aux_Send/2/send_level/?", "/Input_Channels/65/Aux_Send/2/send_level/?",
  ]);
  assert.equal(mixer.controls.get("snapshot").textContent, "Test cue");
});

test("each fader waits for its own finite value and ignores responses for another AUX", () => {
  const mixer = createMixer();
  assert.equal(mixer.slider(2).disabled, true);
  assert.equal(mixer.slider(65).disabled, true);
  mixer.level(2, 2, -20);
  assert.equal(mixer.slider(2).disabled, false);
  assert.equal(mixer.slider(65).disabled, true);
  mixer.level(65, 4, 0);
  mixer.level(65, 2, "0");
  assert.equal(mixer.slider(65).disabled, true);
  mixer.level(65, 2, -150);
  assert.equal(mixer.slider(65).disabled, false);
  assert.equal(mixer.slider(65).value, "0");
});

test("set all to zero dB requires confirmation and loaded channels, scopes writes to the selected AUX and clears pending drags", () => {
  for (const source of [mixerSource, fs.readFileSync(path.join(__dirname, "../web/mixer.min.js"), "utf8")]) {
    const mixer = createMixer(source);
    const button = mixer.controls.get("zeroAllChannels");
    assert.equal(button.disabled, true);
    mixer.run("confirm = () => true");
    button.dispatchEvent({ type: "click" });
    assert.equal(mixer.writes().length, 0);
    mixer.level(2, 2, -20); mixer.level(65, 2, -150);
    assert.equal(button.disabled, false);
    mixer.run("confirm = () => false");
    button.dispatchEvent({ type: "click" });
    assert.equal(mixer.writes().length, 0);
    mixer.slider(2).value = "0.2";
    mixer.slider(2).dispatchEvent({ type: "input" });
    mixer.run("confirm = () => true");
    mixer.controls.get("channels").children[1].hidden = true;
    button.dispatchEvent({ type: "click" });
    mixer.tick(100);
    assert.deepEqual(mixer.writes().map(message => message.address).sort(), ["/Input_Channels/2/Aux_Send/2/send_level", "/Input_Channels/65/Aux_Send/2/send_level"]);
    assert(mixer.writes().every(message => message.args[0] === 0));
    assert.equal(mixer.controls.get("channels").children[0].querySelector(".level-readout").textContent, "63% / 0 dB");
    mixer.socket().close();
    assert.equal(button.disabled, true);
    button.dispatchEvent({ type: "click" });
    assert.equal(mixer.writes().length, 2);
  }
});

test("native fader curve preserves dB values and the off endpoint", () => {
  const mixer = createMixer();
  for (const db of [-80, -40, -20, 0, 10]) assert.ok(Math.abs(mixer.run(`sliderToDb(dbToSlider(${db}))`) - db) < 1e-8);
  assert.equal(mixer.run("sliderToDb(0)"), -150);
  assert.equal(mixer.run("dbToSlider(-150)"), 0);
  assert.equal(mixer.run("sliderToDb(1)"), 10);
});

test("slider readouts display native dB, off and local drag values", () => {
  for (const source of [mixerSource, fs.readFileSync(path.join(__dirname, "../web/mixer.min.js"), "utf8")]) {
    const mixer = createMixer(source);
    const readout = mixer.controls.get("channels").children[0].querySelector(".level-readout");
    assert.equal(readout.textContent, "—");
    mixer.level(2, 2, -3);
    assert.equal(readout.textContent, "55% / -3 dB");
    assert.equal(mixer.slider(2).attributes["aria-valuetext"], "55 percent, -3 decibels");
    mixer.level(2, 2, -150);
    assert.equal(readout.textContent, "0% / −∞ dB");
    mixer.level(2, 2, 10);
    assert.equal(readout.textContent, "100% / 10 dB");
    mixer.slider(2).value = "0.5";
    mixer.slider(2).dispatchEvent({ type: "input" });
    assert.equal(readout.textContent, "50% / -5.1 dB");
  }
});

test("slider traffic is coalesced and a native commit flushes the final value immediately", () => {
  const mixer = createMixer();
  mixer.level(65, 2, 0);
  const slider = mixer.slider(65);
  for (const value of ["0.2", "0.3", "0.4"]) { slider.value = value; slider.dispatchEvent({ type: "input" }); }
  mixer.tick(34);
  assert.equal(mixer.writes().length, 0);
  mixer.tick(1);
  assert.equal(mixer.writes().length, 1);
  assert.equal(mixer.writes()[0].address, "/Input_Channels/65/Aux_Send/2/send_level");
  assert.ok(Math.abs(mixer.writes()[0].args[0] - mixer.run("sliderToDb(0.4)")) < 1e-8);
  slider.value = "1"; slider.dispatchEvent({ type: "input" }); slider.dispatchEvent({ type: "change" });
  assert.equal(mixer.writes().length, 2);
  assert.equal(mixer.writes()[1].args[0], 10);
  mixer.tick(100);
  assert.equal(mixer.writes().length, 2);
});

test("switching AUX cancels old queries and pending writes, then disables faders", () => {
  const mixer = createMixer();
  mixer.level(65, 2, 0);
  const slider = mixer.slider(65);
  slider.value = "0.5"; slider.dispatchEvent({ type: "input" });
  const aux = mixer.controls.get("aux"); aux.value = "4"; aux.dispatchEvent({ type: "change" });
  mixer.tick(100);
  assert.equal(mixer.writes().length, 0);
  assert.equal(slider.disabled, true);
  assert.equal(mixer.socket().sent.some(message => message.address === "/Input_Channels/65/Aux_Send/2/send_level/?"), false);
  assert.equal(mixer.socket().sent.some(message => message.address === "/Input_Channels/65/Aux_Send/4/send_level/?"), true);
  mixer.level(65, 2, 0);
  assert.equal(slider.disabled, true);
  mixer.level(65, 4, -20);
  assert.equal(slider.disabled, false);
});

test("disconnect clears pending writes and invalidates loaded values", () => {
  const mixer = createMixer();
  mixer.level(65, 2, 0);
  const slider = mixer.slider(65);
  slider.value = "0.5"; slider.dispatchEvent({ type: "input" });
  mixer.socket().close();
  mixer.tick(100);
  assert.equal(mixer.writes().length, 0);
  assert.equal(slider.disabled, true);
  assert.equal(slider.dataset.ready, "false");
});

test("a snapshot mix reload invalidates faders and requeries the selected AUX without rebuilding the layout", () => {
  const mixer = createMixer();
  mixer.tick(30);
  mixer.level(2, 2, -20); mixer.level(65, 2, 0);
  const slider = mixer.slider(65);
  slider.value = "0.5"; slider.dispatchEvent({ type: "input" });
  const rows = [...mixer.controls.get("channels").children];
  const previousValues = [mixer.slider(2).value, slider.value];
  const previousReadouts = rows.map(row => row.querySelector('.level-readout').textContent);
  mixer.socket().sent.length = 0;
  mixer.message({ address: "/MixReload", args: [] });
  assert.equal(mixer.slider(2).disabled, true);
  assert.equal(slider.disabled, true);
  assert.equal(slider.dataset.ready, "false");
  assert.deepEqual([mixer.slider(2).value, slider.value], previousValues);
  assert.deepEqual(rows.map(row => row.querySelector('.level-readout').textContent), previousReadouts);
  assert.equal(mixer.controls.get("mixerStatus").textContent, "Updating mix · 0/2");
  assert.deepEqual(mixer.controls.get("channels").children, rows);
  assert.deepEqual(mixer.socket().sent[0], { selectedAux: 2 });
  mixer.tick(100);
  assert.equal(mixer.writes().length, 0);
  assert.deepEqual(mixer.socket().sent.filter(message => message.address).map(message => message.address), [
    "/Input_Channels/2/Aux_Send/2/send_level/?", "/Input_Channels/65/Aux_Send/2/send_level/?",
  ]);
  mixer.level(65, 2, -10);
  assert.equal(slider.disabled, false);
  assert.equal(mixer.slider(2).disabled, true);
  assert.equal(mixer.slider(2).value, previousValues[0]);
  mixer.message({ address: "/MixReload", args: [] });
  assert.equal(mixer.slider(2).value, previousValues[0]);
  const aux = mixer.controls.get('aux'); aux.value = '4'; aux.dispatchEvent({ type: 'change' });
  assert.equal(mixer.slider(2).value, '0');
  assert.equal(slider.value, '0');
  assert.equal(mixer.controls.get('mixerStatus').textContent, 'Loading mix · 0/2');
});

for (const [name, source] of [["source", mixerSource], ["production", fs.readFileSync(path.join(__dirname, "../web/mixer.min.js"), "utf8")]]) {
  test(name + " pan toggle queries and writes pan, then restores level controls", () => {
    const mixer = createMixer(source);
    mixer.level(2, 2, -12);
    const slider = mixer.slider(2);
    slider.value = "0.8"; slider.dispatchEvent({ type: "input" });
    mixer.socket().sent.length = 0;
    const toggle = mixer.controls.get("panMode");
    toggle.dispatchEvent({ type: "click" });
    assert.equal(toggle.attributes["aria-pressed"], "true");
    assert.equal(slider.disabled, true);
    assert.equal(slider.value, "0.5");
    mixer.tick(40);
    assert.deepEqual(mixer.socket().sent.filter(m => m.address).map(m => m.address), [
      "/Input_Channels/2/Aux_Send/2/send_pan/?", "/Input_Channels/65/Aux_Send/2/send_pan/?",
    ]);
    mixer.level(2, 2, 0); // A late level update must not unlock a pan control.
    assert.equal(slider.disabled, true);
    const pan = (channel, aux, value) => mixer.message({ address: `/Input_Channels/${channel}/Aux_Send/${aux}/send_pan`, args: [value] });
    pan(2, 4, 1);
    assert.equal(slider.disabled, true);
    pan(2, 2, 0.5);
    assert.equal(slider.disabled, false);
    assert.equal(slider.attributes["aria-valuetext"], "Centre");
    pan(2, 2, 0);
    assert.equal(slider.attributes["aria-valuetext"], "100 percent left");
    slider.value = "1"; slider.dispatchEvent({ type: "input" }); mixer.tick(40);
    assert.deepEqual(mixer.socket().sent.at(-1), { address: "/Input_Channels/2/Aux_Send/2/send_pan", args: [1] });
    assert.equal(slider.attributes["aria-valuetext"], "100 percent right");
    assert.equal(mixer.controls.get("zeroAllChannels").disabled, true);
    slider.value = "0.25"; slider.dispatchEvent({ type: "input" });
    mixer.socket().sent.length = 0;
    toggle.dispatchEvent({ type: "click" }); mixer.tick(40);
    assert.equal(toggle.attributes["aria-pressed"], "false");
    assert.equal(slider.disabled, true);
    assert.ok(mixer.socket().sent.filter(m => m.address).every(m => m.address.endsWith("/send_level/?")));
    pan(2, 2, 1);
    assert.equal(slider.disabled, true);
    mixer.level(2, 2, 0);
    assert.equal(slider.disabled, false);
    slider.value = "1"; slider.dispatchEvent({ type: "input" }); mixer.tick(40);
    assert.deepEqual(mixer.writes().at(-1), { address: "/Input_Channels/2/Aux_Send/2/send_level", args: [10] });
  });

  test(name + " pan clears stale writes on AUX changes and disconnects", () => {
    const mixer = createMixer(source);
    mixer.controls.get("panMode").dispatchEvent({ type: "click" });
    mixer.message({ address: "/Input_Channels/2/Aux_Send/2/send_pan", args: [0.5] });
    const slider = mixer.slider(2);
    slider.value = "0"; slider.dispatchEvent({ type: "input" });
    const aux = mixer.controls.get("aux"); aux.value = "4"; aux.dispatchEvent({ type: "change" });
    mixer.tick(40);
    assert.equal(slider.disabled, true);
    assert.equal(mixer.socket().sent.filter(m => m.address?.endsWith("/send_pan")).length, 0);
    mixer.message({ address: "/Input_Channels/2/Aux_Send/4/send_pan", args: [0.75] });
    slider.value = "1"; slider.dispatchEvent({ type: "input" });
    mixer.socket().close(); mixer.tick(40);
    assert.equal(slider.disabled, true);
    assert.equal(mixer.socket().sent.filter(m => m.address?.endsWith("/send_pan")).length, 0);
  });

  function faderPointer(mixer, id = 2) {
    const thumb = mixer.run('channelElements.get("' + id + '").thumb');
    thumb.getBoundingClientRect = () => ({ width: 28 });
    return (type, x, pointerId = 1, button = 0) => thumb.dispatchEvent({ type, clientX: x, pointerId, button, preventDefault() {} });
  }

  test(name + " handle taps do not write; dragging preserves the grab offset and flushes on release", () => {
    const mixer = createMixer(source);
    mixer.level(2, 2, -20);
    const slider = mixer.slider(2);
    const initial = Number(slider.value);
    const pointer = faderPointer(mixer);
    pointer("pointerdown", 100);
    pointer("pointermove", 102);
    pointer("pointerup", 102);
    mixer.tick(100);
    assert.equal(Number(slider.value), initial, "tapping or finger jitter must not change a level");
    assert.equal(mixer.writes().length, 0);

    pointer("pointerdown", 100);
    pointer("pointermove", 160, 2);
    assert.equal(Number(slider.value), initial, "another finger cannot move this drag");
    pointer("pointermove", 150);
    assert.ok(Math.abs(Number(slider.value) - initial - 0.25) < 1e-8);
    assert.equal(mixer.writes().length, 0);
    pointer("pointerup", 150);
    assert.equal(mixer.writes().length, 1);
    assert.ok(Math.abs(mixer.writes()[0].args[0] - mixer.run(`sliderToDb(${initial + 0.25})`)) < 1e-8);
    pointer("pointermove", 180);
    mixer.tick(100);
    assert.equal(mixer.writes().length, 1, "a released drag cannot keep writing");
  });

  test(name + " handle drags clamp at both ends and ignore disabled or secondary-button input", () => {
    const mixer = createMixer(source);
    const pointer = faderPointer(mixer);
    pointer("pointerdown", 100); pointer("pointermove", 500); pointer("pointerup", 500);
    assert.equal(mixer.writes().length, 0);
    mixer.level(2, 2, -20);
    const initial = mixer.slider(2).value;
    pointer("pointerdown", 100, 1, 2); pointer("pointermove", 500); pointer("pointerup", 500);
    assert.equal(mixer.slider(2).value, initial);
    pointer("pointerdown", 100); pointer("pointerup", 500);
    assert.equal(mixer.writes().at(-1).args[0], 10);
    pointer("pointerdown", 100); pointer("pointerup", -500);
    assert.equal(mixer.writes().at(-1).args[0], -150);
  });

  for (const reason of ["pointercancel", "lostpointercapture", "aux", "pan", "reload", "disconnect", "layout"]) {
    test(name + " cancels active handle drags and queued writes on " + reason, () => {
      const mixer = createMixer(source);
      mixer.level(2, 2, -20);
      const pointer = faderPointer(mixer);
      pointer("pointerdown", 100); pointer("pointermove", 150);
      if (reason === "aux") {
        const aux = mixer.controls.get("aux"); aux.value = "4"; aux.dispatchEvent({ type: "change" });
        mixer.level(2, 4, -12);
      } else if (reason === "pan") {
        mixer.controls.get("panMode").dispatchEvent({ type: "click" });
        mixer.message({ address: "/Input_Channels/2/Aux_Send/2/send_pan", args: [0.5] });
      } else if (reason === "reload") {
        mixer.message({ address: "/MixReload", args: [] }); mixer.level(2, 2, -12);
      } else if (reason === "disconnect") mixer.socket().close();
      else if (reason === "layout") mixer.run("setEditingLayout(true); setEditingLayout(false)");
      else pointer(reason, 150);
      const value = mixer.slider(2).value;
      pointer("pointermove", 190); pointer("pointerup", 190);
      mixer.tick(100);
      assert.equal(mixer.slider(2).value, value, "a cancelled gesture must not resume after reloading");
      assert.equal(mixer.socket().sent.filter(m => /\/send_(level|pan)$/.test(m.address || "")).length, 0);
    });
  }
}
