const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
test("personal templates roundtrip, attribution, concurrency, and safe persistence", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "osc-templates-test-"));
  process.env.OSC_WEBMIXER_DATA_DIR = directory;
  const { useTemplateRoutes } = require("../lib/templates");
  const app = express(); app.use(express.json()); useTemplateRoutes(app);
  const server = await new Promise(resolve => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
  const base = "http://127.0.0.1:" + server.address().port;
  const config = { selectedAux: 2, channelOrder: [3, 1, 2], favouritesByAux: { "1": { channels: [1, 3], enabled: true }, "2": { channels: [2], enabled: false } }, view: "grid" };
  const save = (name, settings = config, username = null) => fetch(base + "/api/admin/templates", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, config: settings, username }) });
  try {
    assert.deepEqual(await (await fetch(base + "/api/templates")).json(), { templates: [] });
    assert.equal((await fetch(base + "/api/templates", { method: "PUT" })).status, 404);
    assert.equal((await fetch(base + "/api/profiles", { method: "PUT" })).status, 404);
    let response = await save("  Joe   Clack  ", config, "  Joe  "); assert.equal(response.status, 200);
    const first = await response.json(); assert.equal(first.name, "Joe Clack"); assert.match(first.id, /^[a-f0-9]{64}$/); assert(Number.isFinite(Date.parse(first.updatedAt))); assert.deepEqual(first.config, { ...config, hiddenByAux: {}, groupsByAux: {}, globalGroups: [] });
    const diskPath = path.join(directory, "templates", first.id + ".json");
    assert.deepEqual(JSON.parse(await fs.readFile(diskPath, "utf8")), first);
    assert.equal(first.createdBy, "Joe"); assert.equal(first.updatedBy, "Joe"); assert.equal(first.createdAt, first.updatedAt); assert.equal(first.config.username, undefined);
    response = await save("joe clack", { ...config, selectedAux: 1 }, "Alice"); const updated = await response.json(); assert.equal(updated.id, first.id); assert(Date.parse(updated.updatedAt) >= Date.parse(first.updatedAt));
    assert.equal(updated.createdBy, "Joe"); assert.equal(updated.updatedBy, "Alice"); assert.equal(updated.createdAt, first.createdAt);
    const legacy = { ...updated }; delete legacy.createdAt; delete legacy.createdBy; delete legacy.updatedBy;
    await fs.writeFile(diskPath, JSON.stringify(legacy));
    const restoredLegacy = await (await fetch(base + "/api/templates/" + first.id)).json();
    assert.equal(restoredLegacy.createdBy, null); assert.equal(restoredLegacy.updatedBy, null); assert.equal(restoredLegacy.createdAt, updated.updatedAt);
    assert.equal((await (await fetch(base + "/api/templates")).json()).templates.length, 1);
    assert.equal((await (await fetch(base + "/api/templates/" + first.id)).json()).config.selectedAux, 1);
    const concurrent = await Promise.all([save("Alice"), save("Bob"), save("Alice", { ...config, view: "list" })]); assert(concurrent.every(response => response.status === 200));
    assert.equal((await (await fetch(base + "/api/templates")).json()).templates.length, 3);
    assert.equal((await save(" ")).status, 400); assert.equal((await save("X".repeat(81))).status, 400);
    assert.equal((await save("Invalid", { ...config, selectedAux: -1 })).status, 400);
    assert.equal((await save("Invalid", { ...config, view: ["grid"] })).status, 400);
    assert.equal((await save("Invalid", config, { name: "Joe" })).status, 400);
    assert.equal((await save("Invalid", { ...config, channelOrder: ["1"] })).status, 400);
    assert.equal((await save("Invalid", { ...config, favouritesByAux: { "../escape": { channels: [], enabled: false } } })).status, 400);
    assert.equal((await fetch(base + "/api/templates/invalid")).status, 400);
    assert.equal((await fetch(base + "/api/templates/" + "f".repeat(64))).status, 404);
    const traversal = await (await save("../../Person")).json(); assert.match(traversal.id, /^[a-f0-9]{64}$/);
    assert(await fs.readFile(path.join(directory, "templates", traversal.id + ".json"), "utf8"));
    const remove = id => fetch(base + "/api/admin/templates/" + id, { method: "DELETE" });
    assert.equal((await remove("invalid")).status, 400);
    assert.equal((await remove("f".repeat(64))).status, 404);
    assert.equal((await remove(traversal.id)).status, 200);
    assert.equal((await fetch(base + "/api/templates/" + traversal.id)).status, 404);
    assert.equal((await (await fetch(base + "/api/templates")).json()).templates.some(template => template.id === traversal.id), false);
    await assert.rejects(fs.readFile(path.join(directory, "templates", traversal.id + ".json")), { code: "ENOENT" });
    assert.equal((await remove(traversal.id)).status, 404);
    assert.equal((await fetch(base + "/api/templates/" + first.id)).status, 200);
    await fs.writeFile(diskPath, "corrupt original");
    assert.equal((await save("Joe Clack")).status, 500); assert.equal(await fs.readFile(diskPath, "utf8"), "corrupt original");
    assert((await fs.readdir(path.join(directory, "templates"))).every(file => file.endsWith(".json")));
    console.log("Template API tests passed: roundtrip, timestamps, case-insensitive updates, concurrent saves, validation, safe paths and failed-write preservation.");
  } finally {
    await new Promise(resolve => server.close(resolve));
    const target = path.resolve(directory);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith("osc-templates-test-")) throw Error("Unsafe test cleanup path");
    await fs.rm(target, { recursive: true, force: true });
  }
});

test("templates carry hidden channels and channel groups under the mobile app's rules", () => {
  const { validateTemplateConfig } = require("../lib/templates");
  const base = { selectedAux: 1, channelOrder: [1, 2, 3, 4], favouritesByAux: {}, view: "list" };
  const config = { ...base, hiddenByAux: { "1": [4, 4] }, globalGroups: [{ id: 1, name: " Vocals ", members: [1, 2] }],
    groupsByAux: { "2": [{ id: 2, name: "", members: [3, 4] }], "3": [] } };
  assert.deepEqual(validateTemplateConfig(config), { ...base, hiddenByAux: { "1": [4] }, globalGroups: [{ id: 1, name: "Vocals", members: [1, 2] }],
    groupsByAux: { "2": [{ id: 2, name: "", members: [3, 4] }] } });
  const rejects = settings => assert.throws(() => validateTemplateConfig({ ...base, ...settings }));
  rejects({ globalGroups: [{ id: 1, name: "", members: [1] }] });
  rejects({ globalGroups: [{ id: 0, name: "", members: [1, 2] }] });
  rejects({ globalGroups: [{ id: 1, name: "x".repeat(81), members: [1, 2] }] });
  rejects({ globalGroups: [{ id: 1, name: "", members: [1, 2] }, { id: 2, name: "", members: [2, 3] }] });
  rejects({ globalGroups: [{ id: 1, name: "", members: [1, 2] }], groupsByAux: { "1": [{ id: 2, name: "", members: [2, 3] }] } });
  rejects({ globalGroups: [{ id: 1, name: "", members: [1, 2] }], groupsByAux: { "1": [{ id: 1, name: "", members: [3, 4] }] } });
  rejects({ groupsByAux: { "0": [] } });
  rejects({ hiddenByAux: { "1": [0] } });
});
