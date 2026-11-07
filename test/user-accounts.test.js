"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { DatabaseSync } = require("node:sqlite");
const express = require("express");
const { createAdminAuth } = require("../lib/admin-session.js");
const { createUserAccounts } = require("../lib/user-accounts.js");

test("local accounts persist, isolate layouts, guard writes and support admin recovery", { timeout: 30000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ears-accounts-"));
  const previous = process.env.OSC_WEBMIXER_DATA_DIR;
  process.env.OSC_WEBMIXER_DATA_DIR = directory;
  let clock = Date.now();
  let accounts, server, base;
  async function start() {
    const app = express(); app.use(express.json()); app.use(express.urlencoded({ extended: false }));
    const adminAuth = await createAdminAuth(); adminAuth.register(app);
    accounts = createUserAccounts({ directory, now: () => clock }); accounts.register(app, { adminAuth });
    server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); accounts.close(); }
  t.after(async () => { await stop(); if (previous === undefined) delete process.env.OSC_WEBMIXER_DATA_DIR; else process.env.OSC_WEBMIXER_DATA_DIR = previous; await fs.rm(directory, { recursive: true, force: true }); });
  await start();
  async function request(route, method = "GET", body, cookie, extra = {}) {
    const response = await fetch(base + route, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json", Origin: base } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0], headers: response.headers };
  }
  const config = { selectedAux: 2, channelOrder: [65, 2, 1], favouritesByAux: { 2: { channels: [65, 1], enabled: true } }, view: "grid", compact: true };
  let alice, bob;
  await t.test("registration and authentication use hashed records and private cookies", async () => {
    assert.equal((await request("/api/account")).data.user, null);
    assert.equal((await request("/api/account/preferences", "PUT", { preferences: config, revision: 0 })).status, 401);
    alice = await request("/api/account/register", "POST", { username: "Alice", displayName: "Lead singer", password: "alice-secret-password" });
    assert.equal(alice.status, 201); assert.equal(alice.data.user.username, "alice");
    assert.match(alice.cookie, /^ears_user_session=[a-f0-9]{64}$/);
    assert.match(alice.headers.get("set-cookie"), /HttpOnly/); assert.match(alice.headers.get("set-cookie"), /SameSite=Strict/);
    assert.equal(alice.headers.get("cache-control"), "no-store");
    assert.equal((await request("/api/account/register", "POST", { username: "ALICE", password: "other-password" })).status, 409);
    assert.equal((await request("/api/account/login", "POST", { username: "alice", password: "wrong-password" })).status, 401);
    const inspector = new DatabaseSync(accounts.filename, { readOnly: true });
    const record = inspector.prepare("SELECT * FROM users WHERE username='alice'").get();
    assert.match(record.password_hash, /^[a-f0-9]{128}$/); assert.match(record.password_salt, /^[a-f0-9]{32}$/);
    assert.notEqual(record.password_hash, "alice-secret-password");
    assert.notEqual(inspector.prepare("SELECT token_hash FROM sessions LIMIT 1").get().token_hash, alice.cookie.split("=")[1]);
    inspector.close();
  });
  await t.test("profiles are isolated and stale-device saves cannot silently overwrite", async () => {
    const saved = await request("/api/account/preferences", "PUT", { userId: alice.data.user.id, preferences: { ...config, levels: [10] }, revision: 0 }, alice.cookie);
    assert.equal(saved.status, 200); assert.equal(saved.data.revision, 1); assert.deepEqual(saved.data.preferences, config);
    bob = await request("/api/account/register", "POST", { username: "bob", password: "bob-secret-password" });
    assert.equal(bob.status, 201); assert.equal(bob.data.preferences, null);
    assert.equal((await request("/api/account/preferences", "PUT", { preferences: { ...config, selectedAux: 4 }, revision: 0, userId: alice.data.user.id }, bob.cookie)).status, 401);
    assert.equal((await request("/api/account/preferences", "PUT", { preferences: { ...config, selectedAux: 4 }, revision: 0, userId: bob.data.user.id }, bob.cookie)).status, 200);
    assert.equal((await request("/api/account", "GET", undefined, alice.cookie)).data.preferences.selectedAux, 2);
    const conflict = await request("/api/account/preferences", "PUT", { userId: alice.data.user.id, preferences: { ...config, selectedAux: 8 }, revision: 0 }, alice.cookie);
    assert.equal(conflict.status, 409); assert.equal(conflict.data.revision, 1); assert.deepEqual(conflict.data.preferences, config);
    assert.equal((await request("/api/account/preferences", "PUT", { userId: alice.data.user.id, preferences: { ...config, compact: "yes" }, revision: 1 }, alice.cookie)).status, 400);
    const edited = await request("/api/account", "PUT", { userId: alice.data.user.id, displayName: "Alice vocals" }, alice.cookie);
    assert.equal(edited.data.user.displayName, "Alice vocals");
  });
  await t.test("cross-site and form submissions are rejected", async () => {
    assert.equal((await request("/api/account/preferences", "PUT", { preferences: config, revision: 1 }, alice.cookie, { Origin: "http://evil.example" })).status, 403);
    assert.equal((await request("/api/account/logout", "POST", {}, alice.cookie, { "Sec-Fetch-Site": "cross-site" })).status, 403);
    const response = await fetch(base + "/api/account/logout", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: alice.cookie }, body: "x=1" });
    assert.equal(response.status, 415);
  });
  await t.test("database and sign-in sessions survive service restart", async () => {
    await stop(); await start();
    const restored = await request("/api/account", "GET", undefined, alice.cookie);
    assert.equal(restored.data.user.displayName, "Alice vocals"); assert.deepEqual(restored.data.preferences, config);
    assert.equal((await request("/api/account", "GET", undefined, bob.cookie)).data.preferences.selectedAux, 4);
  });
  await t.test("admin recovery is protected and invalidates only the recovered user's sessions", async () => {
    clock += 60001;
    assert.equal((await request("/api/admin/users")).status, 403, "account management requires an admin password");
    const admin = await request("/api/admin/password", "PUT", { password: "admin-secret-password" });
    assert.equal(admin.status, 200);
    assert.equal((await request("/api/admin/users")).status, 401);
    assert.equal((await request("/api/admin/users", "GET", undefined, alice.cookie)).status, 401);
    assert.equal((await request("/api/admin/users", "GET", undefined, admin.cookie)).data.users.length, 2);
    assert.equal((await request(`/api/admin/users/${alice.data.user.id}/password`, "POST", { password: "new-alice-password" }, admin.cookie)).status, 200);
    assert.equal((await request("/api/account", "GET", undefined, alice.cookie)).data.user, null);
    assert.equal((await request("/api/account", "GET", undefined, bob.cookie)).data.user.username, "bob");
    assert.equal((await request("/api/account/login", "POST", { username: "alice", password: "alice-secret-password" })).status, 401);
    alice = await request("/api/account/login", "POST", { username: "alice", password: "new-alice-password" });
    assert.equal(alice.status, 200); assert.deepEqual(alice.data.preferences, config);
    assert.equal((await request(`/api/admin/users/${bob.data.user.id}`, "DELETE", {}, admin.cookie)).status, 200);
    assert.equal((await request("/api/account", "GET", undefined, bob.cookie)).data.user, null);
  });
  await t.test("logout and expired sessions cannot save settings", async () => {
    assert.equal((await request("/api/account/logout", "POST", {}, alice.cookie)).status, 200);
    assert.equal((await request("/api/account/preferences", "PUT", { preferences: config, revision: 1 }, alice.cookie)).status, 401);
    alice = await request("/api/account/login", "POST", { username: "alice", password: "new-alice-password" });
    clock += 31 * 24 * 60 * 60 * 1000;
    assert.equal((await request("/api/account", "GET", undefined, alice.cookie)).data.user, null);
  });
  await t.test("login throttling is bounded", async () => {
    clock += 60001;
    for (let i = 0; i < 10; i++) assert.equal((await request("/api/account/login", "POST", { username: "nobody", password: "incorrect-password" })).status, 401);
    assert.equal((await request("/api/account/login", "POST", { username: "nobody", password: "incorrect-password" })).status, 429);
  });
});
