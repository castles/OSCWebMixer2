"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function deskSettings(ids) {
  class Control {
    constructor() { this.children = []; this.dataset = {}; this.fields = new Map(); }
    addEventListener() {}
    querySelectorAll(selector) { return selector === ".desk-channel" ? this.children : []; }
    querySelector(selector) {
      if (selector.startsWith("[data-desk-tab")) return null;
      if (selector.startsWith("[data-channel=")) return this.children.find(row => row.dataset.channel === selector.match(/"(\d+)"/)[1]);
      if (!this.fields.has(selector)) this.fields.set(selector, new Control());
      return this.fields.get(selector);
    }
    closest() { return this; }
    get classList() { return { contains: () => false }; }
    get nextSibling() { return this.parent.children[this.parent.children.indexOf(this) + 1] || null; }
    insertBefore(row, target) {
      this.children.splice(this.children.indexOf(row), 1);
      this.children.splice(target ? this.children.indexOf(target) : this.children.length, 0, row);
    }
    focus() {}
    scrollIntoView() {}
  }
  const controls = new Map();
  const control = id => {
    if (!controls.has(id)) controls.set(id, new Control());
    return controls.get(id);
  };
  const names = ["channelName[]", "channelEnabled[]", "channelOrder[]", "channelIcon[]", "sectionTitle[]"];
  const rows = ids.map((id, index) => {
    const row = new Control();
    row.dataset.channel = String(id);
    row.parent = control("channels");
    for (const name of names) row.querySelector('[name="' + name + '"]').value = name === "channelOrder[]" ? String(index + 1) : name + id;
    // Live updates use the more specific input selector.
    row.fields.set('input[name="channelName[]"]', row.querySelector('[name="channelName[]"]'));
    row.fields.set('input[name="channelOrder[]"]', row.querySelector('[name="channelOrder[]"]'));
    return row;
  });
  control("channels").children = rows;
  class FormData extends URLSearchParams {
    constructor() {
      super([["osc_port", "8000"]]);
      for (const row of rows) for (const name of names) this.append(name, row.querySelector('[name="' + name + '"]').value);
    }
  }
  const context = vm.createContext({
    document: { getElementById: control, addEventListener() {} },
    window: { matchMedia: () => ({ matches: true, addEventListener() {} }) },
    sessionStorage: { getItem: () => null },
    TabSelector: { mount: () => ({ select() {} }) },
    FormData,
  });
  const source = fs.readFileSync(path.join(__dirname, "../web/desk-settings.js"), "utf8");
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, "globalThis.settingsTest = { settingsFormData, onMessage, moveChannelWithKeys };})();"), context);
  return { ...context.settingsTest, controls, rows, names };
}

test("reordering desk cards preserves channel-number indexing for every saved field", () => {
  const settings = deskSettings([3, 1, 2]);
  const data = settings.settingsFormData();
  assert.equal(data.get("osc_port"), "8000");
  assert.deepEqual(data.getAll("channelOrder[]"), ["2", "3", "1"]);
  for (const name of settings.names.filter(name => name !== "channelOrder[]")) {
    assert.deepEqual(data.getAll(name), [name + 1, name + 2, name + 3]);
  }
});

test("live desk renames target the physical channel after display reordering", () => {
  const settings = deskSettings([3, 1, 2]);
  settings.onMessage({ data: JSON.stringify({ address: "/Input_Channels/1/Channel_Input/name", args: ["Lead vocal"] }) });
  assert.equal(settings.rows[1].querySelector('[name="channelName[]"]').value, "Lead vocal");
  assert.equal(settings.rows[0].querySelector('[name="channelName[]"]').value, "channelName[]3");
});

test("keyboard moves follow the two-column grid and update saved order and dirty state", () => {
  const settings = deskSettings([1, 2, 3, 4]);
  const handle = { closest: () => settings.rows[0], focus() {} };
  settings.moveChannelWithKeys({ key: "ArrowDown", currentTarget: handle, preventDefault() {} });
  assert.deepEqual(settings.controls.get("channels").children.map(row => row.dataset.channel), ["2", "3", "1", "4"]);
  assert.deepEqual(settings.settingsFormData().getAll("channelOrder[]"), ["3", "1", "2", "4"]);
  assert.equal(settings.controls.get("deskSettingsMessage").textContent, "Unsaved changes");
});
