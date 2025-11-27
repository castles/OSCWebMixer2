"use strict";

const osc = require("osc");
const express = require("express");
const http = require('http');
const webSocket = require("ws");
const fs = require('fs');

const Logger = require('./lib/logger.js');
const { getMainIPAddress, addToObject, generateColour } = require('./lib/utils.js');

/**
 * Stores global configuration for webmixer
 */
let config = loadConfig();

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
 * Logs messages to the console
 */
const logger = new Logger(config.debug, false);

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
 * Loading Spinner
 * @type {import('ora').Ora}
 */
let spinner = null;

const mixServerIP = getMainIPAddress();

let plugins = [];
const pluginFiles = fs.readdirSync('./plugins')
for (const plugin of pluginFiles)
{
	//ignore files that start with underscore
	if(plugin.substring(0,1) == "_")
	{
		logger.info(`Not loading "${plugin}" plugin.`);
		continue;
	}
	if(plugin.slice(-3) != ".js")
	{
		logger.info(`Ignoring "${plugin}" in plugin directory.`);
		continue;
	}
	let plug = require('./plugins/' + plugin);
	plugins.push(new plug());
}

/**
 * Build initial configuration for new connections
 * @returns - the initial configuration
 */
function buildConfig()
{
	let auxilaries = [];
	if(cache.has("/Console/Aux_Outputs/modes") && config.auxilaries != undefined)
	{
		let auxModes = cache.get("/Console/Aux_Outputs/modes").args;
		for(const [index, mode] of auxModes.entries())
		{
			auxilaries.push({
				enabled: config.auxilaries[index] ? config.auxilaries[index].enabled : true,
				label: cache.get(`/Aux_Outputs/${index+1}/Buss_Trim/name`).args[0],
				channel: index + 1,
				stereo: mode == 2,
				colour: config.auxilaries[index] ? config.auxilaries[index].colour : generateColour(auxModes.length, index),
				icon: config.auxilaries[index] ? config.auxilaries[index].icon : ""
			});
		}
	}

	let channels = [];
	if(cache.has("/Console/Input_Channels") && config.channels != undefined)
	{
		for(let i=0; i<cache.get("/Console/Input_Channels").args[0]; i++)
		{
			if(cache.has(`/Input_Channels/${i+1}/Channel_Input/name`))
			{
				channels.push({
					enabled: config.channels[i] ? config.channels[i].enabled : true,
					label: cache.get(`/Input_Channels/${i+1}/Channel_Input/name`).args[0],
					channel: i + 1,
					order: config.channels[i]?.order ?? i,
					title: config.channels[i] ? config.channels[i].title : "",
					icon: config.channels[i] ? config.channels[i].icon : ""
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

	// Tell express to use all the static files in /web
	app.use("/", express.static(__dirname + "/web"));

	// Tell express that we are expecting post data
	app.use(express.urlencoded({
		extended: true
	}));

	// Create the web server
	server = http.createServer(app).listen(config.server.port);

	//when a post request occurs in the admin area
	app.post('/admin', (req, res) => {

		//update config with new values
		let portChanged = false;
		if(config.server.port != req.body.server_port)
		{
			portChanged = true;
			config.server.port = req.body.server_port;
		}

		let oscPortChanged = false;
		if(config.osc.port != req.body.osc_port)
		{
			oscPortChanged = true;
			config.osc.port = req.body.osc_port;
		}

		config.debug = req.body.debug == "debug";

		config.desk.ip = req.body.desk_ip;
		config.desk.port = req.body.desk_port;

		config.external = [];
		if(req.body.externalName)
		{
			for(let x = 0; x<req.body.externalName.length; x++)
			{
				config.external.push({
					broadcast: req.body.externalBroadcast[x] == "true",
					name: req.body.externalName[x],
					ip: req.body.externalIP[x],
					port: req.body.externalReceive[x],
					loopback: req.body.externalLoopback[x] == "true"
				});
			}
		}

		if(req.body.auxEnabled && req.body.auxColour && req.body.auxIcon)
		{
			let auxConfig = [];
			for(const [index, value] of req.body.auxEnabled.entries())
			{
				addToObject(auxConfig, index, "enabled", value == "true");
			}
			for(const [index, value] of req.body.auxColour.entries())
			{
				addToObject(auxConfig, index, "colour", value);
			}
			for(const [index, value] of req.body.auxIcon.entries())
			{
				addToObject(auxConfig, index, "icon", value);
			}
			config.auxilaries = auxConfig;
		}

		if(req.body.channelEnabled && req.body.channelOrder && req.body.channelIcon)
		{
			let channelConfig = [];
			for(const [index, value] of req.body.channelEnabled.entries())
			{
				addToObject(channelConfig, index, "enabled", value == "true");
			}
			for(const [index, value] of req.body.channelOrder.entries())
			{
				addToObject(channelConfig, index, "order", parseInt(value));
			}
			for(const [index, value] of req.body.sectionTitle.entries())
			{
				addToObject(channelConfig, index, "title", value);
			}
			for(const [index, value] of req.body.channelIcon.entries())
			{
				addToObject(channelConfig, index, "icon", value);
			}
			config.channels = channelConfig;
		}

		writeConfig();

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
		closeAllConnections();

		if(oscPortChanged)
		{
			stopOSC();
			startOSC();
		}

		if(portChanged)
		{
			closeAllConnections();

			//close web socket server
			wss.close();

			//close web server
			server.close();

			logger.warn(`Server port has changed. Please visit http://${mixServerIP}:${config.server.port} to continue.`);

			//respond with redirection to the new port
			res.send(`<script>document.location.href="http://${mixServerIP}:${config.server.port}/admin";</script>`);

			startServer();
			return;
		}

		res.sendFile(__dirname + "/web/admin.html");
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
		config.server.ip = mixServerIP;
		res.json(config);
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
				if(config.auxilaries && config.auxilaries[i])
				{
					if(config.auxilaries[i].enabled != undefined)
					{
						enabled = config.auxilaries[i].enabled;
					}
					if(config.auxilaries[i].colour != undefined)
					{
						colour = config.auxilaries[i].colour;
					}
					if(config.auxilaries[i].icon != undefined)
					{
						icon = config.auxilaries[i].icon;
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
				if(config.channels && config.channels[i])
				{
					if(config.channels[i].enabled != undefined)
					{
						enabled = config.channels[i].enabled;
					}
					if(config.channels[i].order != undefined)
					{
						order = config.channels[i].order;
					}
					if(config.channels[i].title != undefined)
					{
						title = config.channels[i].title;
					}
					if(config.channels[i].icon != undefined)
					{
						icon = config.channels[i].icon;
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

	//if this is the first time webmixer has been run
	if(!fs.existsSync("config.json"))
	{
		logger.info(`Web Server Ready. Please visit ${url}/admin in a web browser to set up OSC Web Mixer.`);
		return;
	}
}

/**
 * Get the current server url
 */
function getServerURL()
{
	let url = `http://${mixServerIP}`;
	if(config.server.port != 80)
	{
		url += ":" + config.server.port;
	}
	return url;
}

function startWebSocketServer() {
	// Create the web socket server
	let wss = new webSocket.Server({
		server: server
	});

	//when a webmixer user has connected
	wss.on("connection", function(socket)
	{
		//only allow connections once everything has loaded
		if(!loaded)
		{
			socket.close();
			return;
		}

		//save the new connection
		connections.push(socket);

		logger.debug("New websockets connection")

		//send config for new connections
		socket.send(buildConfig());

		//when a message has been sent from a webmixer user
		socket.on('message', function message(data)
		{
			let oscMsg = JSON.parse(data);
			logger.debug("Message recieved from socket client: " + JSON.stringify(oscMsg));

			//ignore messages that are already cached
			if(cache.has(oscMsg.address) && JSON.stringify(cache.get(oscMsg.address)) == JSON.stringify(oscMsg))
			{
				logger.debug("Message already in cache " + JSON.stringify(oscMsg));
				return;
			}

			
			oscMsg = processPlugins(oscMsg);
			if(oscMsg === false)
			{
				return;
			}

			//respond from cache if a value exists
			const key = oscMsg.address.slice(0,-2);
			if(oscMsg.address.substr(-2) == "/?" && cache.has(key))
			{
				this.send(JSON.stringify(cache.get(key)));
				return;
			}

			maybeCacheResponse(oscMsg);

			broadcast(oscMsg, this);
		});
	});

	//when a websocket error occurs
	wss.on("error", function (err)
	{
		logger.error("wss error", err);
	});
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

	const osc = {address: "/Console/Channels/?", args: []};
	udpPort.send(osc, config.desk.ip, config.desk.port);

	logger.debug("Requesting channels from Mixing Desk");
	
	setTimeout(fetchValues, 3000);
}

/**
 * Start listening to OSC messages from the network
 */
function startOSC()
{
	udpPort = new osc.UDPPort({
		localAddress: "0.0.0.0",
		localPort: config.osc.port
	});

	udpPort.on("error", function (err)
	{
		if(err.code == "EHOSTDOWN" || err.code == "EHOSTUNREACH")
		{
			logger.error(err.address + " is not responding");
			return;
		}
		console.error("UDP error", err);
	});

	udpPort.on("message", function(oscMsg, timeTag, info)
	{
		logger.debug("Message received over UDP: " + JSON.stringify(oscMsg));

		//session has changed. Reload
		if(oscMsg.address == "/Console/Session/!")
		{
			cache.clear();
			loaded = false;
			closeAllConnections();
			fetchValues();
			return;
		}

		//ignore messages that are already cached
		if(cache.has(oscMsg.address) && JSON.stringify(cache.get(oscMsg.address)) == JSON.stringify(oscMsg))
		{
			logger.debug("Message already in cache " + JSON.stringify(oscMsg));
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
	spinner = logger.loading("Loading values from mixing desk...").start();
}

/**
 * Ha
 * @param {object} oscMsg
 */
function processSnapshotMsg(oscMsg)
{
	if(oscMsg.address == "/Snapshots/Current_Snapshot")
	{
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
function closeAllConnections()
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
	if(config.external)
	{
		for(let external of config.external)
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
	connections.forEach(function(connection)
	{
		/**
		* CONNECTING = 0
		* OPEN = 1
		*/
		if(connection.readyState <= 1)
		{
			validConnections.push(connection);
			if(connection != source)
			{
				connection.send(JSON.stringify(oscMsg));
				logger.debug(`Sent ${JSON.stringify(oscMsg)} to socket ${validConnections.length}`);
			}
		}
	});
	connections = validConnections;
}

/**
 * Stop listening to OSC messages
 */
function stopOSC()
{
	udpPort.close();
}

/**
 * Determine if we should cache the message and store it in memory.
 * @param {object} msg - the osc message to
 */
function maybeCacheResponse(msg)
{
	let matchAddresses = [
		/^\/Console\/Input_Channels$/, //cache total number of channels
		/^\/Aux_Outputs\/([0-9]+)\/Buss_Trim\/name$/, //cache aux name
		/^\/Console\/Aux_Outputs\/modes$/, //cache aux modes (stereo or mono)
		/^\/Input_Channels\/([0-9]+)\/Channel_Input\/name$/, //cache channel name
		/^\/Input_Channels\/([0-9]+)\/Aux_Send\/([0-9]+)\/send_level$/, //cache channel aux level
		/^\/Input_Channels\/([0-9]+)\/Aux_Send\/([0-9]+)\/send_pan$/ //cache channel aux pan
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

	cachePrimeInterval = setInterval(primeCache, 100);

	loaded = true;
	spinner.succeed("Loaded values from mixing desk.");

	startWebSocketServer();
	logger.info("Webmixer ready to use.");
}

let cachePrimeInterval = null;

/**
 * Load AUX levels and panning values into the cache.
 * These aren't essential to using webmixer so they can load in the background.
 * @returns
 */
function primeCache()
{
	logger.debug("Priming Cache");

	//request all aux level and pan values if they have been saved in config
	if(config.channels && config.auxilaries)
	{
		for(let aux=0; aux<config.auxilaries.length; aux++)
		{
			if(!config.auxilaries[aux].enabled)
			{
				continue;
			}

			for(let channel=0; channel<config.channels.length; channel++)
			{
				if(!config.channels[channel].enabled)
				{
					continue;
				}

				//request level
				if(!cache.has(`/Input_Channels/${channel+1}/Aux_Send/${aux+1}/send_level`))
				{
					udpPort.send({address: `/Input_Channels/${channel+1}/Aux_Send/${aux+1}/send_level/?`, args: []}, config.desk.ip, config.desk.port);
					return;
				}
				//request pan
				if(!cache.has(`/Input_Channels/${channel+1}/Aux_Send/${aux+1}/send_pan`))
				{
					udpPort.send({address: `/Input_Channels/${channel+1}/Aux_Send/${aux+1}/send_pan/?`, args: []}, config.desk.ip, config.desk.port);
					return;
				}
			}
		}
	}

	clearInterval(cachePrimeInterval);

	logger.debug("Cache Primed");
}

/**
 * Send a OSC message to a device via UDP
 * @param {string} name - the name of the device to send to
 * @param {object} msg - the OSC message to send
 */
function sendUDP(name, msg)
{
	if(config.external)
	{
		for(let external of config.external)
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
	};
	return oscMsg;
}

startServer();
startOSC();
