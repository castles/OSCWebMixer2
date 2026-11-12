"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const dgram = require("node:dgram");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const WebSocket = require("ws");
const osc = require("osc");
const QRCode = require("qrcode");
const { getMainIPAddress } = require("../lib/utils/utils.js");
const { productVersion } = require("../lib/product-info.js");

async function availablePort(udp = false) {
  const socket = udp ? dgram.createSocket("udp4") : net.createServer();
  if (udp) socket.bind(0, "127.0.0.1");
  else socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
async function waitFor(check, description, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${description}`);
}
async function connect(url) {
  const socket = new WebSocket(url);
  const messages = [];
  socket.on("message", data => messages.push(JSON.parse(data.toString())));
  await once(socket, "open");
  const config = await waitFor(() => messages.find(message => message.config), "WebSocket configuration");
  return { socket, messages, config: config.config };
}

test("offline v2: discovery, scoped clients, dashboard, templates, admin sessions and shutdown", { timeout: 30000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "earsmixer-demo-"));
  const webPort = await availablePort();
  const publicBase = `http://${getMainIPAddress() || "127.0.0.1"}:${webPort}`;
  const oscPort = await availablePort(true);
  let deskPort = await availablePort(true);
  while (deskPort === oscPort) deskPort = await availablePort(true);
  let output = "";
  function startDemo() {
    const demoProcess = spawn(process.execPath, ["tools/dev.cjs"], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, OSC_WEBMIXER_DEV_CONFIG_DIR: directory,
        OSC_WEBMIXER_DEV_WEB_PORT: String(webPort), OSC_WEBMIXER_DEV_OSC_PORT: String(oscPort),
        OSC_WEBMIXER_DEV_DESK_PORT: String(deskPort),
        OSC_WEBMIXER_DEV_BIND_ADDRESS: "", OSC_WEBMIXER_PUBLIC_URL: "",
        OSC_WEBMIXER_DEV_VERBOSE: "1",
        OSC_WEBMIXER_DEV_DROP_QUERY_ONCE: "/Input_Channels/3/Channel_Input/name/?" },
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    });
    demoProcess.stdout.on("data", chunk => { output += chunk; });
    demoProcess.stderr.on("data", chunk => { output += chunk; });
    return demoProcess;
  }
  let child = startDemo();
  const clients = [];
  let probe;
  try {
    await waitFor(() => {
      if (child.exitCode !== null) throw new Error(output);
      return output.includes("Webmixer ready to use.");
    }, "mock desk and server startup");
    assert(output.includes("dropping one reply to simulate packet loss"), "startup must exercise the missing metadata reply");
    const base = `http://127.0.0.1:${webPort}`;
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(base + "/admin")).status, 200);
    assert.equal((await fetch(publicBase)).status, 200, "demo must be reachable through the advertised LAN IP");
    assert.equal((await fetch(publicBase + "/admin")).status, 200);
    assert(output.includes(`Demo mixer: ${publicBase}\nAdmin: ${publicBase}/admin`));
    const connection = await (await fetch(base + "/api/connection")).json();
    assert.deepEqual(Object.keys(connection).sort(), ["qr", "url"]);
    assert.equal(connection.url, publicBase + "/");
    assert.match(connection.qr, /^data:image\/png;base64,/);
    const browserHeaders = { Origin: "http://localhost:8081" };
    const browserProbe = await fetch(base + "/api/connection", { headers: browserHeaders });
    assert.equal(browserProbe.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(Object.keys(await browserProbe.json()).sort(), ["qr", "url"]);
    const browserTemplates = await fetch(base + "/api/templates", { headers: browserHeaders });
    assert.equal(browserTemplates.headers.get("access-control-allow-origin"), "*");
    assert.equal(browserTemplates.status, 200);
    const browserAdmin = await fetch(base + "/api/admin/status", { headers: browserHeaders });
    assert.equal(browserAdmin.headers.get("access-control-allow-origin"), null);
    assert.equal((await (await fetch(base + "/config")).json()).desk.ip, "127.0.0.1");
    const first = await connect(publicBase.replace("http:", "ws:")); clients.push(first);
    const second = await connect(base.replace("http:", "ws:")); clients.push(second);
    assert.equal(first.config.channels.length, 20);
    assert.equal(first.config.aux.length, 8);
    assert(first.config.aux.some(aux => aux.stereo));
    const level = "/Input_Channels/20/Aux_Send/8/send_level";
    const pan = "/Input_Channels/20/Aux_Send/8/send_pan";
    first.socket.send(JSON.stringify({ address: level + "/?", args: [] }));
    const initial = await waitFor(() => first.messages.find(message => message.address === level), "send level query");
    assert.equal(initial.args[0], -12);
    first.socket.send(JSON.stringify({ address: pan + "/?", args: [] }));
    assert.equal((await waitFor(() => first.messages.find(message => message.address === pan), "pan query")).args[0], 0.5);
    first.socket.send(JSON.stringify({ address: level, args: [-6] }));
    await waitFor(() => second.messages.find(message => message.address === level && message.args[0] === -6), "second client update");
    // Query the mock directly: this proves the write reached UDP, not just the server cache.
    probe = new osc.UDPPort({ localAddress: "127.0.0.1", localPort: 0 });
    probe.open(); await once(probe, "ready");
    const reply = once(probe, "message");
    probe.send({ address: level + "/?", args: [] }, "127.0.0.1", deskPort);
    assert.equal((await reply)[0].args[0], -6);
    const publicConfig = await fs.readFile(path.join(directory, "global.json"), "utf8");
    assert.equal(JSON.parse(publicConfig).osc.port, oscPort);

    const request = (route, method = "GET", body, session) => fetch(base + route, {
      method, redirect: "manual",
      headers: { ...(body !== undefined ? { "Content-Type": "application/json", Origin: base } : {}), ...(session ? { Cookie: session } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const status = async session => {
      const response = await request("/api/admin/status?aux=8", "GET", undefined, session);
      assert.equal(response.status, 200);
      return response.json();
    };
    const expectedSliderAtMinus6 = 0.47863009232263826;
    first.socket.send(JSON.stringify({ username: "  Lead   singer  " }));
    second.socket.send(JSON.stringify({ username: "Drummer" }));
    second.socket.send(JSON.stringify({ selectedAux: 1 }));
    const third = await connect(base.replace("http:", "ws:")); clients.push(third);
    third.socket.send(JSON.stringify({ username: "Guitarist" }));
    third.socket.send(JSON.stringify({ selectedAux: 8 }));
    const observer = await connect(base.replace("http:", "ws:") + "/?role=observer"); clients.push(observer);
    let dashboard = await waitFor(async () => {
      const result = await status();
      return result.clients.length === 3 && result.clients.some(client => client.username === "Lead singer" && client.aux === 8)
        && result.clients.some(client => client.username === "Drummer" && client.aux === 1)
        && result.clients.some(client => client.username === "Guitarist" && client.aux === 8) ? result : null;
    }, "client identity and selected mixes");
    const presence = client => client.messages.filter(message => message.presence).at(-1)?.presence;
    await waitFor(() => presence(first)?.peers.some(peer => peer.nickname === "Guitarist"), "same AUX presence");
    assert.deepEqual(presence(first).peers.map(peer => peer.nickname), ["Guitarist"]);
    assert.deepEqual(presence(third).peers.map(peer => peer.nickname), ["Lead singer"]);
    assert.deepEqual(presence(second).peers, []);
    assert(!observer.messages.some(message => message.presence), "observers do not receive musician presence");
    assert.deepEqual(Object.keys(presence(first).peers[0]).sort(), ["id", "nickname"]);
    third.socket.send(JSON.stringify({ username: "New nickname" }));
    await waitFor(() => presence(first)?.peers[0]?.nickname === "New nickname", "nickname presence update");
    third.socket.send(JSON.stringify({ selectedAux: 1 }));
    await waitFor(() => presence(first)?.peers.length === 0 && presence(second)?.peers[0]?.nickname === "New nickname", "AUX move presence");
    third.socket.send(JSON.stringify({ username: "Guitarist" }));
    third.socket.send(JSON.stringify({ selectedAux: 8 }));
    await waitFor(() => presence(first)?.peers[0]?.nickname === "Guitarist" && presence(second)?.peers.length === 0, "presence after AUX return");
    const visitor = await connect(base.replace("http:", "ws:")); clients.push(visitor);
    visitor.socket.send(JSON.stringify({ username: "Visitor" }));
    visitor.socket.send(JSON.stringify({ selectedAux: 8 }));
    await waitFor(() => presence(first)?.peers.length === 2, "new peer joins");
    visitor.socket.close();
    await waitFor(() => presence(first)?.peers.length === 1, "peer leaves");
    assert.equal(dashboard.connections, 3, "observer sockets must not appear as mixer clients");
    assert.equal(new Set(dashboard.clients.map(client => client.id)).size, 3);
    assert.equal(dashboard.loaded, true);
    assert.equal(dashboard.version, productVersion());
    assert.equal(dashboard.url, publicBase + "/");
    assert.match(dashboard.qr, /^data:image\/png;base64,/);
    assert.equal(dashboard.channels.length, 20);
    assert.equal(dashboard.aux.length, 8);
    assert.equal(dashboard.adminPasswordEnabled, false);
    const dashboardLevel = dashboard.mixLevels[8].find(channel => channel.channel === 20);
    assert(Math.abs(dashboardLevel.level - expectedSliderAtMinus6) < 0.000001);
    assert.equal(dashboardLevel.pan, 0, "native centre pan must be normalized to zero");
    const singer = dashboard.clients.find(client => client.username === "Lead singer");
    assert(singer.log.some(entry => entry.type === "level" && entry.aux === 8 && entry.channel === 20
      && Math.abs(entry.value - expectedSliderAtMinus6) < 0.000001 && entry.previousValue < entry.value));
    assert(singer.log.some(entry => entry.type === "aux" && entry.aux === 8));
    assert(Math.abs(singer.levels.find(channel => channel.channel === 20).level - expectedSliderAtMinus6) < 0.000001);

    // A write must reach another client on AUX 8 without reaching a client on AUX 1.
    const secondMessageCount = second.messages.length;
    first.socket.send(JSON.stringify({ address: level, args: [-5] }));
    await waitFor(() => third.messages.find(message => message.address === level && message.args[0] === -5), "same-AUX update");
    await waitFor(() => observer.messages.find(message => message.address === level && message.args[0] === -5), "live admin observer update");
    await new Promise(resolve => setTimeout(resolve, 100));
    assert(!second.messages.slice(secondMessageCount).some(message => message.address === level && message.args[0] === -5),
      "clients viewing another AUX must not receive this send update");
    second.socket.close();
    dashboard = await waitFor(async () => {
      const result = await status();
      return result.connections === 2 && result.disconnectedClients.some(client => client.username === "Drummer") ? result : null;
    }, "disconnected client history");
    const drummer = dashboard.disconnectedClients.find(client => client.username === "Drummer");
    assert(Number.isFinite(drummer.disconnectedAt));
    assert.equal(drummer.aux, 1);

    const templateConfig = { selectedAux: 8, channelOrder: [20, 3, 1],
      favouritesByAux: { "8": { channels: [20, 1], enabled: true } }, view: "grid" };
    let response = await request("/api/admin/templates", "PUT", { name: "Singer layout", username: "Lead singer", config: templateConfig });
    assert.equal(response.status, 200);
    const template = await response.json();
    assert.equal(template.createdBy, "Lead singer");
    assert.equal(template.updatedBy, "Lead singer");
    const savedConfig = { ...templateConfig, hiddenByAux: {}, groupsByAux: {}, globalGroups: [] };
    assert.deepEqual(template.config, savedConfig);
    assert(!("level" in template.config), "personal layouts must not store desk send values");
    assert.deepEqual((await (await request("/api/templates/" + template.id)).json()).config, savedConfig);
    assert((await (await request("/api/templates")).json()).templates.some(entry => entry.id === template.id));

    // Enable protection through the real running backend, then verify both dashboards
    // and native v2 settings/preset APIs use the same session cookie.
    const password = "demo-admin-password";
    response = await request("/api/admin/password", "PUT", { password });
    const trayConnection = await fetch(base + "/api/connection");
    assert.equal(trayConnection.status, 200, "tray QR must work without an admin session");
    assert.equal(trayConnection.headers.get("cache-control"), "no-store");
    assert.deepEqual(await trayConnection.json(), connection, "public QR must expose only connection information");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie"), /HttpOnly/);
    const setupSession = response.headers.get("set-cookie").split(";")[0];
    for (const route of ["/api/admin/status", "/config", "/aux", "/channels", "/api/presets"]) {
      assert.equal((await request(route)).status, 401, route);
    }
    for (const route of ["/admin", "/admin.html", "/desk-settings.html"]) {
      response = await request(route);
      assert.equal(response.status, 302, route);
      assert.equal(response.headers.get("location"), "/admin-login.html", route);
    }
    assert.equal((await request("/api/admin/templates", "PUT", { name: "Unauthenticated", config: templateConfig })).status, 401);
    assert.equal((await request("/api/admin/mixer-url", "PUT", { url: "ears.glow.uk" })).status, 401);
    assert.equal((await request("/api/presets/save-current-state", "POST", { name: "Unauthenticated" })).status, 401);
    assert.equal((await request("/api/presets/example/load", "POST", {})).status, 401);
    assert.equal((await request("/api/presets/example", "DELETE", {})).status, 401);
    assert.equal((await fetch(base + "/admin", { method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base }, body: "server_port=9999" })).status, 302);
    assert.equal(await fs.readFile(path.join(directory, "global.json"), "utf8"), publicConfig,
      "an unauthenticated native settings POST must not change saved configuration");
    assert.equal((await request("/")).status, 200);
    assert.equal((await request("/api/templates/" + template.id)).status, 200);
    assert.equal((await request("/api/admin/login", "POST", { password: "wrong-password" })).status, 401);
    response = await request("/api/admin/login", "POST", { password });
    assert.equal(response.status, 200);
    const session = response.headers.get("set-cookie").split(";")[0];
    dashboard = await status(session);
    assert.equal(dashboard.adminPasswordEnabled, true);
    assert.equal(dashboard.connections, 2);
    const oldDeskPage = await request("/desk-settings.html", "GET", undefined, session);
    assert.equal(oldDeskPage.status, 302);
    assert.equal(oldDeskPage.headers.get("location"), "/admin.html#desk-settings");
    const dashboardPage = await (await request("/admin.html", "GET", undefined, session)).text();
    assert.match(dashboardPage, /id="configForm"/);
    assert.match(dashboardPage, /data-page="desk-settings"/);
    assert.doesNotMatch(dashboardPage, /class="donate"|paypal\.com|<iframe/);
    assert.equal((await request("/config", "GET", undefined, session)).status, 200);
    assert.equal((await request("/api/admin/templates", "PUT", { name: "Protected layout", username: "Guitarist", config: templateConfig }, session)).status, 200);
    const passwordFile = await fs.readFile(path.join(directory, "data", "admin-password.json"), "utf8");
    assert(!passwordFile.includes(password));
    assert.match(JSON.parse(passwordFile).hash, /^[a-f0-9]{128}$/);
    assert.equal((await request("/api/admin/logout", "POST", {}, session)).status, 200);
    assert.equal((await request("/api/admin/status", "GET", undefined, session)).status, 401);
    assert.equal((await request("/api/admin/password", "DELETE", { currentPassword: password }, setupSession)).status, 200);
    assert.equal((await status()).adminPasswordEnabled, false);

    const saveSettings = overrides => fetch(base + "/admin", {
      method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base },
      body: new URLSearchParams({ server_port: String(webPort), osc_port: String(oscPort),
        desk_ip: "127.0.0.1", desk_port: String(deskPort), ...overrides }),
    });
    for (const invalid of [{ server_port: "-1" }, { osc_port: "70000" }, { desk_port: "0" }, { osc_port: "" }, { desk_ip: " " }]) {
      assert.equal((await saveSettings(invalid)).status, 400, JSON.stringify(invalid));
      assert.equal(await fs.readFile(path.join(directory, "global.json"), "utf8"), publicConfig,
        "invalid settings must not overwrite working saved configuration");
    }

    // Changing only the desk address must invalidate old names/values and safely
    // reopen the same UDP receive port when the target is changed back.
    const firstClosed = once(first.socket, "close");
    const thirdClosed = once(third.socket, "close");
    assert.equal((await saveSettings({ desk_ip: "127.0.0.2" })).status, 200);
    await Promise.all([firstClosed, thirdClosed]);
    dashboard = await status();
    assert.equal(dashboard.loaded, false);
    assert.deepEqual(dashboard.channels, []);
    assert.deepEqual(dashboard.aux, []);
    assert.deepEqual(dashboard.mixLevels, {});
    assert.equal((await saveSettings({ desk_ip: "127.0.0.1" })).status, 200);
    await waitFor(async () => (await status()).loaded, "discovery after same-port OSC restart");
    const reconnected = await connect(base.replace("http:", "ws:")); clients.push(reconnected);
    assert.equal(reconnected.config.channels.length, 20);
    reconnected.socket.send(JSON.stringify({ selectedAux: 8 }));
    reconnected.socket.send(JSON.stringify({ address: level + "/?", args: [] }));
    assert.equal((await waitFor(() => reconnected.messages.find(message => message.address === level), "restored desk value")).args[0], -5);

    const setMockLevel = async value => {
      probe.send({ address: level, args: [value] }, "127.0.0.1", deskPort);
      const answer = once(probe, "message");
      probe.send({ address: level + "/?", args: [] }, "127.0.0.1", deskPort);
      assert.equal((await answer)[0].args[0], value);
    };
    // Change the desk without notifying the backend, then recall a snapshot.
    // /MixReload must discard the cached -5 so a fresh query obtains -9.
    await setMockLevel(-9);
    const beforeSnapshot = reconnected.messages.length;
    probe.send({ address: "/Snapshots/Current_Snapshot", args: [2] }, "127.0.0.1", oscPort);
    await waitFor(() => reconnected.messages.slice(beforeSnapshot).find(message => message.address === "/MixReload"), "snapshot mix invalidation");
    reconnected.socket.send(JSON.stringify({ address: level + "/?", args: [] }));
    assert.equal((await waitFor(() => reconnected.messages.slice(beforeSnapshot).find(message => message.address === level), "fresh snapshot value")).args[0], -9);

    // A native session reload closes old clients, re-discovers metadata and clears
    // sends so the next connection receives the desk's newly changed value.
    await setMockLevel(-8);
    const readinessCount = output.split("Webmixer ready to use.").length;
    const sessionClosed = once(reconnected.socket, "close");
    probe.send({ address: "/Console/Session/!", args: [] }, "127.0.0.1", oscPort);
    await sessionClosed;
    await waitFor(() => output.split("Webmixer ready to use.").length > readinessCount, "session metadata rediscovery");
    const afterSession = await connect(base.replace("http:", "ws:")); clients.push(afterSession);
    assert.equal(afterSession.config.channels.length, 20);
    assert.equal(afterSession.config.aux.length, 8);
    afterSession.socket.send(JSON.stringify({ address: level + "/?", args: [] }));
    assert.equal((await waitFor(() => afterSession.messages.find(message => message.address === level), "fresh session value")).args[0], -8);

    // Custom URLs change only advertised links and QR codes, preserving the listener and desk settings.
    const globalPath = path.join(directory, "global.json");
    const beforeCustomUrl = await fs.readFile(globalPath, "utf8");
    for (const invalid of [null, "javascript:alert(1)", "https://user:password@ears.glow.uk", "https://ears.glow.uk/mixer"]) {
      assert.equal((await request("/api/admin/mixer-url", "PUT", { url: invalid })).status, 400);
      assert.equal(await fs.readFile(globalPath, "utf8"), beforeCustomUrl);
    }
    assert.equal((await fetch(base + "/api/admin/mixer-url", {
      method: "PUT", headers: { "Content-Type": "application/json", Origin: "http://other-site.example" },
      body: JSON.stringify({ url: "ears.glow.uk" }),
    })).status, 403);
    let customUrlResponse = await request("/api/admin/mixer-url", "PUT", { url: "ears.glow.uk" });
    assert.equal(customUrlResponse.status, 200);
    const customConnection = await customUrlResponse.json();
    assert.equal(customConnection.customMixerUrl, "http://ears.glow.uk");
    assert.equal(customConnection.url, "http://ears.glow.uk/");
    assert.equal(customConnection.qr, await QRCode.toDataURL(customConnection.url, { width: 320, margin: 2 }));
    assert.equal((await status()).customMixerUrl, "http://ears.glow.uk");
    assert.deepEqual(await (await request("/api/connection")).json(), { url: customConnection.url, qr: customConnection.qr });
    const savedWithCustomUrl = JSON.parse(await fs.readFile(globalPath, "utf8"));
    assert.equal(savedWithCustomUrl.server.publicUrl, "http://ears.glow.uk");
    assert.equal(savedWithCustomUrl.server.port, webPort);
    assert.deepEqual(savedWithCustomUrl.desk, { ip: "127.0.0.1", port: deskPort });

    const exited = once(child, "exit");
    child.send({ type: "stop" });
    await exited;
    output = "";
    child = startDemo();
    await waitFor(() => output.includes("Webmixer ready to use."), "demo restart with saved custom URL");
    assert(output.includes("Demo mixer: http://ears.glow.uk"));
    assert.equal((await status()).customMixerUrl, "http://ears.glow.uk");
    assert.deepEqual(await (await request("/api/connection")).json(), { url: customConnection.url, qr: customConnection.qr });
    customUrlResponse = await request("/api/admin/mixer-url", "PUT", { url: "" });
    assert.equal(customUrlResponse.status, 200);
    assert.equal((await customUrlResponse.json()).url, publicBase + "/");
    assert.equal((await status()).customMixerUrl, "");
  } catch (error) {
    error.message += "\n" + output;
    throw error;
  } finally {
    for (const client of clients) client.socket.terminate();
    if (probe) probe.close();
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      if (child.connected) child.send({ type: "stop" });
      else child.kill();
      let timer;
      try {
        await Promise.race([exited, new Promise((_, reject) => {
          timer = setTimeout(() => { child.kill(); reject(new Error("Demo shutdown timed out.")); }, 3000);
        })]);
      } finally { clearTimeout(timer); }
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
  // Both services must release their listening ports when the runner stops.
  for (const [port, udp] of [[webPort, false], [oscPort, true], [deskPort, true]]) {
    const socket = udp ? dgram.createSocket("udp4") : net.createServer();
    if (udp) socket.bind(port, "127.0.0.1");
    else socket.listen(port, "127.0.0.1");
    await once(socket, "listening");
    await new Promise(resolve => socket.close(resolve));
  }
});
