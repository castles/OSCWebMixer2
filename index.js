"use strict";

const osc = require("osc");
const express = require("express");
const http = require('http');
const webSocket = require("ws");
const fs = require('fs');
const QRCode = require('qrcode');

const configManager = require("./lib/config/configManager.js")
const logger = require('./lib/logging/logger.js');
const { getMainIPAddress, generateColour } = require('./lib/utils/utils.js');
const { createAdminAuth } = require('./lib/admin-session.js');
const { createUserAccounts } = require('./lib/user-accounts.js');
const { useTemplateRoutes, deviceUsername } = require('./lib/templates.js');
const { dbToSlider, panToCentered, colourToRGB } = require('./lib/mix-values.js');
const { QueryQueue } = require('./lib/query-queue.js');
const { productVersion } = require('./lib/product-info.js');
const appVersion = productVersion();
const { normalizeMixerUrl } = require('./lib/mixer-url.js');
let adminAuth;
let userAccounts;
let discoveryTimer = null;
let nextClientId = 1;
let qrURL = null;
let qrImage = null;
const disconnectedClients = [];
const queryQueue = new QueryQueue(msg => {
	if(udpPort && loaded) udpPort.send(msg, config.desk.ip, config.desk.port);
});

/**
 * Stores global configuration for webmixer
 */
configManager.ensureConfigDirectoryExists();
let config = configManager.getGlobalConfigOrDefault();
for(const [name, section] of [['OSC_WEBMIXER_WEB_PORT', 'server'], ['OSC_WEBMIXER_OSC_PORT', 'osc']]) {
	if(process.env[name]) {
		const port = Number(process.env[name]);
		if(!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(name + ' must be a valid port.');
		config[section].port = port;
	}
}
let currentState = configManager.getCurrentStateOrDefault();

// Configure logger to use settings from global config
logger.configure(config.debug, Boolean(process.env.OSC_WEBMIXER_SERVICE));

/**
 * the osc.js UDP Listening Port
 */
let udpPort = undefined;

/**
 * Socket connections that have connected
 * @type {Array}
 */
let connections = [];

/**
 * Whether or not the system has finished loading
 * @type {Boolean}
 */
let loaded = false;

/**
 * Stores OSC messages that have been cached
 * @type {Map}
 */
let cache = new Map();

/**
 * Stores the name of the current snapshot
 * @type string
 */
let currentSnapshotName = "";

/**
 * Stores the number of the current snapshot
 * @type int
 */
let currentSnapshot = -1;

/**
 * Last-resort handlers so an unexpected error is logged instead of silently
 * killing the server (which would drop every connected device mid-show).
 */
process.on('uncaughtException', function(err)
{
	logger.error("Uncaught exception: " + (err && err.stack ? err.stack : err));
});
process.on('unhandledRejection', function(reason)
{
	logger.error("Unhandled promise rejection: " + (reason && reason.stack ? reason.stack : reason));
});

/**
 * The main http server
 * @type {http.Server}
 */
let server = null;

/**
 * The socket server
 * @type {WebSocketServer}
 */
let wss = null;


/**
 * Load all plugins from the ./plugins directory
 * @returns - Array of plugins (empty if none found/enabled)
 */
function loadPlugins() {
	if (!fs.existsSync('./plugins')) {
		logger.warn("Directory ./plugins/ not found. Creating empty directory.");
		fs.mkdirSync('./plugins');
		logger.info("To use plugins, please add them to the ./plugins/ directory.");
		return [];
	}

	let plugins = [];
	const pluginFiles = fs.readdirSync('./plugins');

	for (const file of pluginFiles) {
		if (file.startsWith('_')) {
			logger.info(`Not loading plugin "${file}".`);
			continue;
		}
		if (!file.endsWith('.js')) {
			logger.warn(`Ignoring non-JS file "${file}" in plugin directory.`);
			continue;
		}
		let plugin = require(require('path').resolve('plugins', file));
		plugins.push(new plugin());
		logger.info(`Loaded plugin "${file}".`);
	}

	return plugins;
}

const plugins = loadPlugins();

/**
 * Build initial configuration for new connections
 * @returns - the initial configuration
 */
function buildConfig()
{
	let auxilaries = [];
	if(cache.has("/Console/Aux_Outputs/modes") && currentState.auxes != undefined)
	{
		let auxModes = cache.get("/Console/Aux_Outputs/modes").args;
		for(const [index, mode] of auxModes.entries())
		{
			//skip auxes whose name hasn't arrived from the desk yet (matches the /aux route)
			if(!cache.has(`/Aux_Outputs/${index+1}/Buss_Trim/name`))
			{
				continue;
			}

			auxilaries.push({
				enabled: currentState.auxes[index] ? currentState.auxes[index].enabled : true,
				label: cache.get(`/Aux_Outputs/${index+1}/Buss_Trim/name`).args[0],
				channel: index + 1,
				stereo: mode == 2,
				colour: currentState.auxes[index] ? currentState.auxes[index].colour : generateColour(auxModes.length, index),
				icon: currentState.auxes[index] ? currentState.auxes[index].icon : ""
			});
		}
	}

	let channels = [];
	if(cache.has("/Console/Input_Channels") && currentState.channels != undefined)
	{
		for(let i=0; i<cache.get("/Console/Input_Channels").args[0]; i++)
		{
			if(cache.has(`/Input_Channels/${i+1}/Channel_Input/name`))
			{
				channels.push({
					enabled: currentState.channels[i] ? currentState.channels[i].enabled : true,
					label: cache.get(`/Input_Channels/${i+1}/Channel_Input/name`).args[0],
					channel: i + 1,
					order: currentState.channels[i]?.displayOrder ?? i,
					title: currentState.channels[i] ? currentState.channels[i].title : "",
					icon: currentState.channels[i] ? currentState.channels[i].icon : ""
				});
			}
		}
	}

	return JSON.stringify({
		"config": {
			channels: channels,
			aux: auxilaries,
			snapshot: currentSnapshotName
		}
	});
}

/**
 * Start the main web server
 */
function startServer()
{
	// Create an Express-based Web Socket server that clients can connect to
	let app = express();
	app.use(express.urlencoded({ extended: true }));
	app.use(express.json());
	adminAuth.register(app);
	userAccounts.register(app, { adminAuth });
	useTemplateRoutes(app);
	// Only connection information, so the tray QR still works with an admin password.
	app.get('/api/connection', async (req, res, next) => {
		try { res.set('Cache-Control', 'no-store').json(await getConnectionInfo()); }
		catch(error) { next(error); }
	});
	app.get('/api/admin/status', async (req, res) => {
		const mix = getVisibleConfig();
		const clients = connections.filter(socket => !socket.isObserver && socket.readyState === webSocket.OPEN);
		const selectedAux = Number(req.query.aux);
		if(loaded && mix.aux.some(aux => aux.channel === selectedAux)) warmAux(selectedAux);
		const connection = await getConnectionInfo();
		res.json({
			...connection, customMixerUrl: config.server.publicUrl || "", loaded, snapshot: currentSnapshotName,
			version: appVersion, connections: clients.length, authEnabled: false,
			adminPasswordEnabled: adminAuth.isEnabled(),
			clients: clients.map(socket => serializeClient(socket, null, mix)), disconnectedClients,
			aux: mix.aux.map(aux => ({ ...aux, colour: colourToRGB(aux.colour) })),
			channels: mix.channels,
			mixLevels: Object.fromEntries(mix.aux.map(aux => [aux.channel, getClientLevels(aux.channel, mix.channels)]))
		});
	});

	app.put('/api/admin/mixer-url', async (req, res) => {
		let publicUrl;
		try { publicUrl = normalizeMixerUrl(req.body?.url); }
		catch(error) { res.status(400).json({ error: error.message }); return; }
		try {
			const connection = await getConnectionInfo(publicUrl || getServerURL());
			const nextConfig = { ...config, server: { ...config.server, publicUrl } };
			configManager.saveGlobalConfig(nextConfig);
			config = nextConfig;
			res.json({ ...connection, customMixerUrl: publicUrl });
		} catch(error) {
			logger.error('Mixer URL save failed: ' + error.message);
			res.status(500).json({ error: 'Could not save the mixer URL. Please try again.' });
		}
	});

	// Apply no-cache policy for admin endpoints to prevent stale browser state
	app.use(["/admin", "/admin.html", "/admin.js", "/admin.css"], (req, res, next) => {
		res.set("Cache-Control", "no-store");
		next();
	});

	// Tell express to use all the static files in /web
	app.use("/", express.static(__dirname + "/web"));

	// Create the web server
	server = http.createServer(app);
	server.on("error", function(err)
	{
		if(err.code == "EADDRINUSE" || err.code == "EACCES")
		{
			logger.error(`Web server port ${config.server.port} is ${err.code == "EACCES" ? "not permitted (ports below 1024 need elevated privileges)" : "already in use"}. ` +
				`Close whatever is using it or change the Webserver Port in the admin area.`);
			process.exit(1);
		}
		logger.error("Web server error: " + (err && err.stack ? err.stack : err));
	});
	server.listen(config.server.port, process.env.OSC_WEBMIXER_BIND_ADDRESS || "0.0.0.0");

	// Session middleware above protects both dashboard and native settings routes.
	//when a post request occurs in the admin area
	app.post('/admin', (req, res) => {

		const requestedWebPort = Number(process.env.OSC_WEBMIXER_WEB_PORT || req.body.server_port);
		const requestedOscPort = Number(process.env.OSC_WEBMIXER_OSC_PORT || req.body.osc_port);
		const requestedDeskPort = Number(req.body.desk_port);
		const validPort = port => Number.isInteger(port) && port >= 1 && port <= 65535;
		if(![requestedWebPort, requestedOscPort, requestedDeskPort].every(validPort) ||
			typeof req.body.desk_ip !== 'string' || !req.body.desk_ip.trim()) {
			res.status(400).json({ error: 'Enter a desk address and port numbers between 1 and 65535.' }); return;
		}
		const deskChanged = config.desk.ip !== req.body.desk_ip.trim() || Number(config.desk.port) !== requestedDeskPort;
		//update config with new values
		let portChanged = false;
		if(config.server.port != requestedWebPort)
		{
			portChanged = true;
			config.server.port = requestedWebPort;
		}

		let oscPortChanged = false;
		if(config.osc.port != requestedOscPort)
		{
			oscPortChanged = true;
			config.osc.port = requestedOscPort;
		}

		config.debug = req.body.debug == "debug";
		logger.setDebug(config.debug);

		config.desk.ip = req.body.desk_ip.trim();
		config.desk.port = requestedDeskPort;

		config.externalDevices = [];
		if(req.body.externalName)
		{
			for(let x = 0; x<req.body.externalName.length; x++)
			{
				config.externalDevices.push({
					broadcast: req.body.externalBroadcast[x] == "true",
					name: req.body.externalName[x],
					ip: req.body.externalIP[x],
					port: req.body.externalReceive[x],
					loopback: req.body.externalLoopback[x] == "true"
				});
			}
		}

		if (req.body.auxEnabled && req.body.auxColour && req.body.auxIcon) {
			const auxConfig = req.body.auxEnabled.map((enabledValue, index) => ({
				enabled: enabledValue === "true",
				colour: req.body.auxColour[index],
				icon: req.body.auxIcon[index]
			}));
			currentState.auxes = auxConfig;
		}

		if(req.body.channelEnabled && req.body.channelOrder && req.body.channelIcon)
		{
			const channelConfig = req.body.channelEnabled.map((enabledValue, index) => ({
				enabled: enabledValue === "true",
				displayOrder: parseInt(req.body.channelOrder[index]) || index,
				title: req.body.sectionTitle ? req.body.sectionTitle[index] : "",
				icon: req.body.channelIcon ? req.body.channelIcon[index] : ""
			}))
			currentState.channels = channelConfig;
		}

		logger.info("Configuration updated via web interface. Saving current configuration state to disk.")
		configManager.saveGlobalConfig(config);
		configManager.saveCurrentState(currentState);

		if(req.body.auxName)
		{
			for(let i=0; i<req.body.auxName.length; i++)
			{
				if(
					cache.has(`/Aux_Outputs/${i+1}/Buss_Trim/name`) &&
					cache.get(`/Aux_Outputs/${i+1}/Buss_Trim/name`).args[0] != req.body.auxName[i]
				)
				{
					//store new name
					cache.get(`/Aux_Outputs/${i+1}/Buss_Trim/name`).args[0] = req.body.auxName[i];

					//let other connections know about new name
					broadcast({
							"address": `/Aux_Outputs/${i+1}/Buss_Trim/name`,
							"args": [
								req.body.auxName[i]
							]
						}
					);
				}
			}
		}

		if(req.body.channelName)
		{
			for(let i=0; i<req.body.channelName.length; i++)
			{
				if(
					cache.has(`/Input_Channels/${i+1}/Channel_Input/name`) &&
					cache.get(`/Input_Channels/${i+1}/Channel_Input/name`).args[0] != req.body.channelName[i]
				)
				{
					//store new name
					cache.get(`/Input_Channels/${i+1}/Channel_Input/name`).args[0] = req.body.channelName[i];

					//let other connections know about new name
					broadcast({
							"address": `/Input_Channels/${i+1}/Channel_Input/name`,
							"args": [
								req.body.channelName[i]
							]
						}
					);
				}
			}
		}

		//force webmixer client and admin connections to reload
		closeAllWebsocketConnections();

		if(oscPortChanged || deskChanged)
		{
			stopOSC(startOSC);
		}

		if(portChanged)
		{
			closeAllWebsocketConnections();

			//close web socket server if it is running
			if(wss)
			{
				wss.close();
				wss = null;
			}

			//close web server
			server.close();

			logger.warn(`Server port has changed. Please visit ${getServerURL()} to continue.`);

			//respond with redirection to the new port
			res.send(`<script>document.location.href="${getServerURL()}/admin.html#desk-settings";</script>`);

			startServer();
			return;
		}

		res.json({ success: true });
	});

	//when a get request occurs in the admin area
	app.get('/admin', (req, res) => {
		res.sendFile(__dirname + "/web/admin.html");
	});

	//provide the current config to the admin area when it has been requested by ajax.
	app.get('/config', (req, res) => {
		if(!config.server)
		{
			config.server = {};
		}
		config.server.ip = getMainIPAddress() || '127.0.0.1';
		res.json(config);
	});

	app.get('/api/presets', (req, res) => {
		let presets = configManager.getPresets()

		res.json(presets.map(p => ({
			uuid: p.uuid,
			name: p.name,
			lastChanged: p.lastChanged
		})));
	});

	app.post('/api/presets/:uuid/load', (req, res) => {
		try {
			const { uuid } = req.params;

			if (!uuid) {
				return res.status(400).json({
					success: false,
					message: "Preset UUID is required."
				});
			}

			const preset = configManager.getPresetById(uuid);

			if (!preset) {
				return res.status(404).json({
					success: false,
					message: `Preset with ID "${uuid}" not found.`
				});
			}

			currentState = structuredClone(preset)
			configManager.saveCurrentState(currentState);
			closeAllWebsocketConnections();

			res.json({
				success: true,
				message: `Preset "${preset.name}" loaded successfully.`,
				state: currentState
			});
		} catch (err) {
			logger.error(`Error loading preset: ${err}`);
			res.status(500).json({
				success: false,
				message: "An internal server error occurred."
			});
		}
	});

	app.post('/api/presets/save-current-state', (req, res) => {
		try {
			const { name } = req.body;

			if (!name || name.trim() === "") {
				return res.status(400).json({ success: false, message: "Preset name is required." });
			}

			const newPreset = configManager.saveCurrentStateAsPreset(currentState, name);

			res.status(201).json({
				success: true,
				message: "Preset saved successfully.",
				preset: newPreset
			});
		} catch (err) {
			if (err.code === 'PRESET_EXISTS') {
				return res.status(409).json({
					success: false,
					message: err.message
				});
			}

			logger.error(`Error saving preset: ${err}`);
			res.status(500).json({
				success: false,
				message: "An internal server error occurred."
			});
		}
	});

	app.delete('/api/presets/:uuid', (req, res) => {
		try {
			const { uuid } = req.params;
			configManager.deletePreset(uuid);

			res.json({ 
				success: true, 
				message: "Preset deleted successfully." 
			});

		} catch (err) {
			if (err.code === 'PRESET_NOT_FOUND') {
				return res.status(404).json({ 
					success: false, 
					message: err.message 
				});
			}

			logger.error("Error deleting preset:", err);
			res.status(500).json({ 
				success: false, 
				message: "Failed to delete preset." 
			});
		}
	});

	app.get('/api/presets/:uuid/download', (req, res) => {
		try {
			const { uuid } = req.params;
			const preset = configManager.getPresetById(uuid);

			if (!preset) {
				return res.status(404).json({ success: false, message: "Preset not found." });
			}

			const filename = `${preset.name.replace(/\s+/g, '_')}.json`;
			res.setHeader('Content-Type', 'application/json');
			res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

			res.send(JSON.stringify(preset, null, 4));
		} catch (err) {
			res.status(500).send("Error generating download.");
		}
	});

	//provide the current config for the auxilaries
	app.get('/aux', (req, res) => {
		let auxDetails = [];

		if(cache.has("/Console/Aux_Outputs/modes"))
		{
			let auxModes = cache.get("/Console/Aux_Outputs/modes").args;
			for(let i=0; i<auxModes.length; i++)
			{
				if(!cache.has(`/Aux_Outputs/${i+1}/Buss_Trim/name`))
				{
					continue;
				}

				let enabled = true;
				let colour = generateColour(auxModes.length, i);
				let icon = "";
				if(currentState.auxes && currentState.auxes[i])
				{
					if(currentState.auxes[i].enabled != undefined)
					{
						enabled = currentState.auxes[i].enabled;
					}
					if(currentState.auxes[i].colour != undefined)
					{
						colour = currentState.auxes[i].colour;
					}
					if(currentState.auxes[i].icon != undefined)
					{
						icon = currentState.auxes[i].icon;
					}
				}
				auxDetails.push({
					"enabled": enabled,
					"name": cache.get(`/Aux_Outputs/${i+1}/Buss_Trim/name`).args[0],
					"colour": colour,
					"icon": icon
				});
			}
		}
		res.json(auxDetails);
	});

	//provide the current config for the channels
	app.get('/channels', (req, res) => {

		let channelDetails = [];
		if(cache.has("/Console/Input_Channels"))
		{
			for(let i=0; i<cache.get("/Console/Input_Channels").args[0]; i++)
			{
				if(!cache.has(`/Input_Channels/${i+1}/Channel_Input/name`))
				{
					continue;
				}

				let enabled = true;
				let order = i + 1;
				let title = "";
				let icon = "";
				if(currentState.channels && currentState.channels[i])
				{
					if(currentState.channels[i].enabled != undefined)
					{
						enabled = currentState.channels[i].enabled;
					}
					if(currentState.channels[i].displayOrder != undefined)
					{
						order = currentState.channels[i].displayOrder;
					}
					if(currentState.channels[i].title != undefined)
					{
						title = currentState.channels[i].title;
					}
					if(currentState.channels[i].icon != undefined)
					{
						icon = currentState.channels[i].icon;
					}
				}
				channelDetails.push({
					"enabled": enabled,
					"name": cache.get(`/Input_Channels/${i+1}/Channel_Input/name`).args[0],
					"order": order,
					"title": title,
					"icon": icon
				});
			}
		}
		res.json(channelDetails);
	});

	logger.info(`Web Server Ready. Please visit ${getServerURL()}/admin in a web browser to configure EarsMixer.`);
	startWebSocketServer();
}

/**
 * Get the current server url
 */
async function getConnectionInfo(publicUrl = config.server.publicUrl || getServerURL()) {
	const url = publicUrl.replace(/\/$/, '') + '/';
	if(qrURL !== url) {
		qrURL = url;
		qrImage = QRCode.toDataURL(url, { width: 320, margin: 2 });
		qrImage.catch(() => { if(qrURL === url) qrURL = null; });
	}
	return { url, qr: await qrImage };
}

function getServerURL()
{
	if(process.env.OSC_WEBMIXER_PUBLIC_URL)
	{
		return process.env.OSC_WEBMIXER_PUBLIC_URL.replace(/\/$/, "");
	}
	// A boot-time service may start before the network adapter has an address.
	let url = `http://${getMainIPAddress() || '127.0.0.1'}`;
	if(config.server.port != 80)
	{
		url += ":" + config.server.port;
	}
	return url;
}

function getVisibleConfig() {
	const result = JSON.parse(buildConfig()).config;
	result.channels = result.channels.filter(channel => channel.enabled).sort((a, b) => a.order - b.order);
	result.aux = result.aux.filter(aux => aux.enabled);
	return result;
}

function getClientLevels(aux, channels = getVisibleConfig().channels) {
	return channels.map(channel => {
		const prefix = '/Input_Channels/' + channel.channel + '/Aux_Send/' + aux;
		return { channel: channel.channel, label: channel.label,
			level: dbToSlider(cache.get(prefix + '/send_level')?.args[0]),
			pan: panToCentered(cache.get(prefix + '/send_pan')?.args[0]) };
	});
}

function serializeClient(socket, disconnectedAt = null, mix = getVisibleConfig()) {
	const info = socket.clientInfo;
	const aux = mix.aux.find(entry => entry.channel === info.aux);
	return { ...info, disconnectedAt, auxLabel: aux?.label ?? null,
		auxColour: colourToRGB(aux?.colour), levels: info.aux ? getClientLevels(info.aux, mix.channels) : null };
}

function logClient(socket, entry) {
	socket.clientInfo.log.push({ at: Date.now(), ...entry });
	if(socket.clientInfo.log.length > 100) socket.clientInfo.log.shift();
}

function selectClientAux(socket, aux) {
	const selected = socket.mixConfig.aux.find(entry => entry.channel === aux);
	if(!selected) return false;
	if(socket.clientInfo.aux !== aux) {
		logClient(socket, { type: 'aux', aux, auxLabel: selected.label, value: aux });
		socket.clientInfo.aux = aux;
		warmAux(aux, true, socket.mixConfig);
	}
	return true;
}

function warmAux(aux, priority = true, mix = getVisibleConfig()) {
	const stereo = mix.aux.find(entry => entry.channel === aux)?.stereo;
	for(const channel of mix.channels) {
		const prefix = '/Input_Channels/' + channel.channel + '/Aux_Send/' + aux;
		if(!cache.has(prefix + '/send_level')) queryQueue.request(prefix + '/send_level', priority);
		if(stereo && !cache.has(prefix + '/send_pan')) queryQueue.request(prefix + '/send_pan', priority);
	}
}

function startWebSocketServer() {
	if(wss) return;
	wss = new webSocket.Server({ server });
	wss.on('connection', function(socket, req) {
		if(!loaded) { socket.close(); return; }
		socket.isObserver = new URL(req.url, 'http://localhost').searchParams.get('role') === 'observer';
		// Settings changes close clients; reuse this configuration during fader moves.
		socket.mixConfig = getVisibleConfig();
		socket.clientInfo = { id: nextClientId++, username: null, address: req.socket.remoteAddress,
			connectedAt: Date.now(), lastActivity: Date.now(), aux: null, log: [] };
		connections.push(socket);
		socket.send(buildConfig());
		socket.on('message', function(data) {
			let msg;
			try { msg = JSON.parse(data.toString()); } catch { return; }
			if(!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
			if(socket.isObserver) return;
			socket.clientInfo.lastActivity = Date.now();
			if('username' in msg) {
				try { socket.clientInfo.username = deviceUsername(msg.username); } catch {}
				return;
			}
			if('selectedAux' in msg) { selectClientAux(socket, Number(msg.selectedAux)); return; }
			if(typeof msg.address !== 'string' || !Array.isArray(msg.args)) return;
			const match = /^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_(level|pan)(\/\?)?$/.exec(msg.address);
			if(!match) return;
			const channel = Number(match[1]), aux = Number(match[2]), parameter = match[3], query = !!match[4];
			const mix = socket.mixConfig;
			if(!mix.channels.some(entry => entry.channel === channel) || !mix.aux.some(entry => entry.channel === aux)) return;
			if(query ? msg.args.length !== 0 : (msg.args.length !== 1 || !Number.isFinite(msg.args[0]) ||
				(parameter === 'level' ? msg.args[0] < -150 || msg.args[0] > 10 : msg.args[0] < 0 || msg.args[0] > 1))) return;
			selectClientAux(socket, aux);
			msg = processPlugins(msg);
			if(msg === false) return;
			if(query) {
				const key = msg.address.slice(0, -2);
				if(cache.has(key)) socket.send(JSON.stringify(cache.get(key)));
				else queryQueue.request(key, true);
				return;
			}
			if(cache.has(msg.address) && JSON.stringify(cache.get(msg.address)) === JSON.stringify(msg)) return;
			const previous = cache.get(msg.address)?.args[0];
			logClient(socket, { type: parameter, aux, auxLabel: cache.get(`/Aux_Outputs/${aux}/Buss_Trim/name`)?.args[0],
				channel, channelLabel: cache.get(`/Input_Channels/${channel}/Channel_Input/name`)?.args[0],
				value: parameter === 'level' ? dbToSlider(msg.args[0]) : panToCentered(msg.args[0]),
				previousValue: parameter === 'level' ? dbToSlider(previous) : panToCentered(previous) });
			maybeCacheResponse(msg);
			broadcast(msg, socket);
		});
		socket.on('close', () => {
			if(!socket.isObserver) disconnectedClients.unshift(serializeClient(socket, Date.now()));
			if(disconnectedClients.length > 50) disconnectedClients.pop();
			connections = connections.filter(connection => connection !== socket);
		});
		socket.on('error', err => logger.debug('Client socket error: ' + err.message));
	});
	wss.on('error', err => logger.error('wss error: ' + err));
}

/**
 * Write the current configuration to disk
 */
function writeConfig()
{
	let err = fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
	if(err)
	{
		throw err;
	}
	logger.debug("Config Saved.");
}

/**
 * Load config from disk. If it doesn't exist then use default values.
 */
function loadConfig()
{
	if(fs.existsSync("config.json"))
	{
		return JSON.parse(
			fs.readFileSync("config.json", "utf-8")
		)
	}
	
	return {
		debug: false,
		server: {
			port: 80
		},
		osc: {
			port: 8000
		},
		desk: {
			ip: "",
			port: 9000
		},
		external: []
	};
}

/**
 * Callback to request values from the desk. Will keep trying until values have loaded.
 * @returns null
 */
function fetchValues()
{
	if(loaded)
	{
		return;
	}

	if(config.desk.ip) loadNextRequiredParameter();
	clearTimeout(discoveryTimer);
	if(!loaded) discoveryTimer = setTimeout(fetchValues, 3000);
}

/**
 * Start listening to OSC messages from the network
 */
function startOSC()
{
	udpPort = new osc.UDPPort({
		localAddress: process.env.OSC_WEBMIXER_BIND_ADDRESS || "0.0.0.0",
		localPort: config.osc.port
	});

	udpPort.on("error", function (err)
	{
		if(err.code == "EHOSTDOWN" || err.code == "EHOSTUNREACH")
		{
			logger.error(err.address + " is not responding");
			return;
		}
		if(err.code == "EADDRINUSE" || err.code == "EACCES")
		{
			//can't receive OSC without this port - retrying is pointless, so fail loudly
			logger.error("Could not open OSC port.");
			logger.error(`OSC port ${config.osc.port} is ${err.code == "EACCES" ? "not permitted" : "already in use"}. ` +
				`Close whatever is using it or change the OSC Receive Port in the admin area.`);
			process.exit(1);
		}
		logger.error("UDP error: " + (err && err.stack ? err.stack : err));
	});

	udpPort.on("message", function(oscMsg, timeTag, info)
	{
		logger.debug("Message received over UDP: " + JSON.stringify(oscMsg));

		//session has changed. Reload
		if(oscMsg.address == "/Console/Session/!")
		{
			queryQueue.clear();
			cache.clear();
			loaded = false;
			currentSnapshot = -1;
			currentSnapshotName = '';
			closeAllWebsocketConnections();
			fetchValues();
			return;
		}

		//ignore messages that are already cached
		queryQueue.received(oscMsg.address);
		if(cache.has(oscMsg.address) && JSON.stringify(cache.get(oscMsg.address)) == JSON.stringify(oscMsg))
		{
			logger.debug("Message already in cache " + JSON.stringify(oscMsg));
			if(!loaded) loadNextRequiredParameter();
			return;
		}

		oscMsg = processPlugins(oscMsg);
		if(oscMsg === false)
		{
			return;
		}

		processSnapshotMsg(oscMsg);

		maybeCacheResponse(oscMsg);

		if(!loaded)
		{
			loadNextRequiredParameter();
			return;
		}

		//respond from cache if a value exists
		const key = oscMsg.address.slice(0,-2);
		if(oscMsg.address.substr(-2) == "/?" && cache.has(key))
		{
			broadcast(cache.get(key));
			return;
		}

		broadcast(oscMsg, info.address); //send to everyone except the IP that it came from
	});

	udpPort.on("ready", fetchValues);

	udpPort.open();
	logger.info("Loading values from mixing desk...");
}

/**
 * Handles Current Snapshot messages sent by the console
 * @param {object} oscMsg
 */
function processSnapshotMsg(oscMsg)
{
	if(oscMsg.address == "/Snapshots/Current_Snapshot")
	{
		if(loaded && currentSnapshot !== -1 && currentSnapshot !== oscMsg.args[0]) {
			queryQueue.clear();
			for(const address of cache.keys()) if(/\/Aux_Send\/\d+\/send_(level|pan)$/.test(address)) cache.delete(address);
			for(const socket of connections) if(socket.readyState === webSocket.OPEN) {
				socket.send(JSON.stringify({ address: '/MixReload', args: [] }));
			}
		}
		currentSnapshot = oscMsg.args[0];

		//when the current snapshot has been deleted
		if(currentSnapshot < 0)
		{
			currentSnapshotName = "";
			broadcast({
				"address": "/SnapshotName",
				args: [
					currentSnapshotName
				]
			}, config.desk.ip);
			return;
		}

		//request the names for the current snapshots. We will use the response to store the snapshot name below.
		udpPort.send({address: "/Snapshots/names/?", args: []}, config.desk.ip, config.desk.port);

		return;
	}

	//rename the current snapshot
	let renameSnapshot = oscMsg.address.match(/^\/Snapshots\/Rename_Snapshot\/([0-9]+)$/);
	if(renameSnapshot !== null && renameSnapshot[1] == currentSnapshot)
	{
		currentSnapshotName = oscMsg.args[0];

		broadcast({
			"address": "/SnapshotName",
			args: [
				currentSnapshotName
			]
		}, config.desk.ip);

		return;
	}

	//if the message is the snapshot name we are waiting for
	if(oscMsg.address == "/Snapshots/name" && oscMsg.args[0] == currentSnapshot)
	{
		currentSnapshotName = oscMsg.args[oscMsg.args.length - 1];

		broadcast({
			"address": "/SnapshotName",
			args: [
				currentSnapshotName
			]
		}, config.desk.ip);
	}
}

/**
 * Close all webmixer connections
 */
function closeAllWebsocketConnections()
{
	for(let connection of connections)
	{
		connection.close();
	}
	connections = [];
}

/**
 * Broadcast an OSC message to all connections
 * @param {Object} oscMsg - the OSC message to send
 * @param {string|WebSocketConnection} source - don't broadcast to this connection
 * @returns {void}
 */
function broadcast(oscMsg, source)
{
	//notify desk
	if(config.desk.ip != source)
	{
		udpPort.send(oscMsg, config.desk.ip, config.desk.port);
		logger.debug(`Sent ${JSON.stringify(oscMsg)} to Mixing Desk (${config.desk.ip}:${config.desk.port})`);
	}

	//notify all external devices
	if(config.externalDevices)
	{
		for(let external of config.externalDevices)
		{
			if(external.broadcast && (external.loopback || external.ip != source))
			{
				udpPort.send(oscMsg, external.ip, external.port);
				logger.debug(`Sent ${JSON.stringify(oscMsg)} to External "${external.name}" (${external.ip}:${external.port})`);
			}
		}
	}

	//notify all webmixer connections
	let validConnections = [];
	const payload = JSON.stringify(oscMsg);
	const sendAux = /^\/Input_Channels\/\d+\/Aux_Send\/(\d+)\/send_(?:level|pan)$/.exec(oscMsg.address);
	connections.forEach(function(connection)
	{
		/**
		* CONNECTING = 0
		* OPEN = 1
		*/
		if(connection.readyState === webSocket.OPEN)
		{
			validConnections.push(connection);
			if(connection != source && (!sendAux || connection.clientInfo?.aux == null || connection.clientInfo.aux === Number(sendAux[1])))
			{
				connection.send(payload);
				logger.debug(`Sent ${JSON.stringify(oscMsg)} to socket ${validConnections.length}`);
			}
		}
	});
	connections = validConnections;
}

/**
 * Stop listening to OSC messages
 */
function stopOSC(onClosed)
{
	clearTimeout(discoveryTimer);
	queryQueue.clear();
	cache.clear();
	loaded = false;
	currentSnapshot = -1;
	currentSnapshotName = '';
	closeAllWebsocketConnections();
	const previousPort = udpPort;
	udpPort = undefined;
	if(previousPort) {
		if(onClosed) previousPort.once('close', onClosed);
		previousPort.close();
	} else if(onClosed) onClosed();
}

/**
 * Determine if we should cache the message and store it in memory.
 * @param {object} msg - the osc message to
 */
function maybeCacheResponse(msg)
{
	let matchAddresses = [
		/^\/Input_Channels\/(\d{1,3})\/Aux_Send\/(\d{1,3})\/send_level$/, //cache channel aux level
		/^\/Input_Channels\/(\d{1,3})\/Aux_Send\/(\d{1,3})\/send_pan$/, //cache channel aux pan
		/^\/Input_Channels\/(\d{1,3})\/Channel_Input\/name$/, //cache channel name
		/^\/Aux_Outputs\/([0-9]+)\/Buss_Trim\/name$/, //cache aux name
		/^\/Console\/Aux_Outputs\/modes$/, //cache aux modes (stereo or mono)
		/^\/Console\/Input_Channels$/ //cache total number of channels
	];

	for(let address of matchAddresses)
	{
		if(address.test(msg.address))
		{
			cache.set(msg.address, msg);
			logger.debug(`Cached ${JSON.stringify(msg)}`);
			return;
		}
	}
}

/**
 * Request the required parameters from the desk in order.
 * This gets called every time a mesage arrives until all the required parameters have loaded.
 */
function loadNextRequiredParameter()
{
	if(!cache.has("/Console/Input_Channels"))
	{
		//reguest channel count (amoung other things)
		udpPort.send({address: "/Console/Channels/?", args: []}, config.desk.ip, config.desk.port);
		return;
	}

	if(!cache.has("/Console/Aux_Outputs/modes"))
	{
		//request aux modes
		udpPort.send({address: "/Console/Aux_Outputs/modes/?", args: []}, config.desk.ip, config.desk.port);
		return;
	}

	//request aux names
	for(let i=1; i<=cache.get("/Console/Aux_Outputs/modes").args.length; i++)
	{
		if(!cache.has(`/Aux_Outputs/${i}/Buss_Trim/name`))
		{
			udpPort.send({address: `/Aux_Outputs/${i}/Buss_Trim/name/?`, args: []}, config.desk.ip, config.desk.port);
			return;
		}
	}

	//request channel names
	for(let i=1; i<=cache.get("/Console/Input_Channels").args[0]; i++)
	{
		if(!cache.has(`/Input_Channels/${i}/Channel_Input/name`))
		{
			udpPort.send({address: `/Input_Channels/${i}/Channel_Input/name/?`, args: []}, config.desk.ip, config.desk.port);
			return;
		}
	}

	//request current snapshot. If there is a snapshot then the index on the snapshot will be returned.
	//We can then request the name of that snapshot
	udpPort.send({address: "/Snapshots/Current_Snapshot/?", args: []}, config.desk.ip, config.desk.port);

	loaded = true;
	primeCache();
	clearTimeout(discoveryTimer);
	logger.info("Loaded values from mixing desk.");

	startWebSocketServer();
	logger.info("Webmixer ready to use.");
}

/**
 * Load AUX levels and panning values into the cache.
 * These aren't essential to using webmixer so they can load in the background.
 * @returns
 */
function primeCache()
{
	logger.debug("Priming Cache");
	const mix = getVisibleConfig();
	for(const aux of mix.aux) warmAux(aux.channel, false, mix);
	logger.debug("Background cache queries queued");
}

/**
 * Send a OSC message to a device via UDP
 * @param {string} name - the name of the device to send to
 * @param {object} msg - the OSC message to send
 */
function sendUDP(name, msg)
{
	if(config.externalDevices)
	{
		for(let external of config.externalDevices)
		{
			if(external.name == name)
			{
				udpPort.send(msg, external.ip, external.port);
					logger.debug(`Sent ${JSON.stringify(msg)} to External "${external.name}" (${external.ip}:${external.port})`);
			}
		}
	}
}

/**
 * Processes all loaded plugins.
 * @param {Object} oscMsg
 * @return {bool|object} - false when nothing should happen after the plugins have executed or the OSC message which may have been modified.
 */
function processPlugins(oscMsg)
{
	for(const plugin of plugins)
	{
		let response = plugin.handleOSC(oscMsg, {broadcast: broadcast, cache: cache, send: sendUDP});
		if(response === false)
		{
			return false;
		}
		if(response !== undefined)
		{
			oscMsg = response;
		}
	}
	return oscMsg;
}

createAdminAuth().then(auth => {
	adminAuth = auth;
	userAccounts = createUserAccounts();
	process.once('exit', () => userAccounts.close());
	startServer();
	startOSC();
}).catch(error => { logger.error(error.stack || error); process.exit(1); });
