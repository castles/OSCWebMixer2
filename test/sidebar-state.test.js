"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../web/sidebar-state.js"), "utf8");

function load(saved, blocked = false) {
  const events = [];
  const classes = new Set();
  const attributes = new Map();
  const writes = [];
  const context = vm.createContext({
    window: {},
    document: { documentElement: {
      classList: { toggle(name, enabled) { events.push("geometry"); if (enabled) classes.add(name); else classes.delete(name); } },
      setAttribute(name, value) { events.push("ready"); attributes.set(name, value); },
    } },
    localStorage: {
      getItem(key) { events.push("read"); assert.equal(key, "adminSidebarCollapsed"); if (blocked) throw new Error("Storage blocked"); return saved; },
      setItem(key, value) { if (blocked) throw new Error("Storage blocked"); writes.push([key, value]); },
    },
  });
  vm.runInContext(source, context);
  return { state: context.window.AdminSidebarState, events, classes, attributes, writes };
}

test("saved sidebar state is applied before the shell is revealed without rewriting storage", () => {
  for (const saved of ["true", "false", null]) {
    const sidebar = load(saved);
    assert.deepEqual(sidebar.events, ["read", "geometry", "ready"]);
    assert.equal(sidebar.classes.has("sidebar-collapsed"), saved === "true");
    assert.equal(sidebar.state.collapsed, saved === "true");
    assert(sidebar.attributes.has("data-sidebar-ready"));
    assert.deepEqual(sidebar.writes, []);
  }
});

test("sidebar changes persist and remain usable when browser storage is blocked", () => {
  const sidebar = load("true");
  sidebar.state.set(false);
  assert.equal(sidebar.classes.has("sidebar-collapsed"), false);
  assert.deepEqual(sidebar.writes, [["adminSidebarCollapsed", "false"]]);
  const blocked = load(null, true);
  assert(blocked.attributes.has("data-sidebar-ready"));
  assert.equal(blocked.state.collapsed, false);
  assert.doesNotThrow(() => blocked.state.set(true));
  assert.equal(blocked.classes.has("sidebar-collapsed"), true);
});
