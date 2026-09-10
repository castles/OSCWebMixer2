"use strict";

/**
 * Mock DiGiCo SD / Quantum console ("DiGiCo iPad" external-control OSC) for
 * developing / debugging OSCWebMixer2 without real hardware.
 *
 * It answers the OSC queries the server sends while loading (channel count, aux
 * modes, channel + aux names, snapshot, send levels and pans), so the server
 * reaches its "ready" state and the web mixer, plugins and external-device
 * routing can all be exercised on a workbench.
 *
 * Every message the server sends is printed, so this doubles as a way to see
 * exactly what the web mixer is doing to the desk.
 *
 * Usage:
 *   node tools/mock-desk.js                 # uses ./config.json (or defaults)
 *   node tools/mock-desk.js --channels 32 --auxes 8
 *   node tools/mock-desk.js --port 9000 --reply-port 8000 --host 127.0.0.1
 *   node tools/mock-desk.js --live          # also push periodic snapshot changes
 *
 * Point webmixer at it by setting the desk IP to this machine (127.0.0.1 when
 * both run on the same box) in the admin area.
 *
 * `createMockDesk(opts)` is also exported so tests can run it in-process.
 */

const osc = require("osc");

const CHANNEL_NAMES = [
	"Kick", "Snare Top", "Snare Btm", "Hi Hat", "Rack Tom", "Floor Tom",
	"OH L", "OH R", "Bass DI", "Bass Mic", "Gtr Stage L", "Gtr Stage R",
	"Acoustic", "Keys L", "Keys R", "Click", "Playback L", "Playback R",
	"Lead Vox", "BV 1", "BV 2", "BV 3", "Talkback", "Amb L", "Amb R"
];
const AUX_NAMES = [
	"Drums IEM", "Bass IEM", "Gtr IEM", "Keys IEM", "Vox IEM", "MD Mix",
	"Wedge 1", "Wedge 2", "Side Fill", "Sub"
];

/**
 * Create a mock SD / Quantum console.
 *
 * @param {Object} [opts]
 * @param {number} [opts.port=9000]       UDP port the desk listens on
 * @param {number} [opts.replyPort=8000]  fallback port to reply to before a packet is received
 * @param {string} [opts.host="0.0.0.0"]
 * @param {number} [opts.channels=24]
 * @param {number} [opts.auxes=6]
 * @param {boolean} [opts.live=false]
 * @param {(...args:any[])=>void} [opts.log=console.log]
 * @returns {{ port:number, replyPort:number, whenReady:Promise<void>, close:()=>void }}
 */
function createMockDesk(opts = {})
{
	const port = opts.port ?? 9000;
	const replyPort = opts.replyPort ?? 8000;
	const host = opts.host ?? "0.0.0.0";
	const channelCount = opts.channels ?? 24;
	const auxCount = opts.auxes ?? 6;
	const live = !!opts.live;
	const log = opts.log ?? console.log;

	const state = {
		channelCount,
		// alternate mono (1) / stereo (2) auxes so both code paths get exercised
		auxModes: Array.from({ length: auxCount }, (_, i) => (i % 3 === 2 ? 2 : 1)),
		channelName: (n) => CHANNEL_NAMES[(n - 1) % CHANNEL_NAMES.length] || `Channel ${n}`,
		auxName: (n) => AUX_NAMES[(n - 1) % AUX_NAMES.length] || `Aux ${n}`,
		snapshotIndex: 1,
		snapshotNames: ["Default", "Walk In", "Band 1", "Support", "Headliner", "Walk Out"],
		sends: new Map()   // OSC address -> value
	};

	const defaultSend = (address) => (address.endsWith("send_pan") ? 0.5 : -12);

	const udpPort = new osc.UDPPort({ localAddress: host, localPort: port, metadata: false });
	let replyTo = null;
	let liveTimer = null;

	function reply(address, oscArgs)
	{
		const target = replyTo || { address: "127.0.0.1", port: replyPort };
		udpPort.send({ address, args: oscArgs }, target.address, target.port);
		log(`  -> ${address} ${JSON.stringify(oscArgs)}`);
	}

	udpPort.on("ready", function()
	{
		log(`Mock DiGiCo SD/Quantum console listening on ${host}:${port}`);
		log(`Replies go to the webmixer OSC port ${replyPort} (learned from incoming packets).`);
		log(`${state.channelCount} channels, ${state.auxModes.length} auxes ` +
			`(${state.auxModes.filter((m) => m === 2).length} stereo).`);
	});

	udpPort.on("error", function(err)
	{
		console.error("UDP error:", err && err.stack ? err.stack : err);
	});

	udpPort.on("message", function(oscMsg, timeTag, info)
	{
		replyTo = { address: info.address, port: info.port };

		const address = oscMsg.address;
		log(`<- ${address} ${oscMsg.args && oscMsg.args.length ? JSON.stringify(oscMsg.args) : ""}`.trimEnd());

		// query for a value (address ends with /?)
		if(address.endsWith("/?"))
		{
			const query = address.slice(0, -2);
			let m;

			if(query === "/Console/Channels")
			{
				return reply("/Console/Input_Channels", [state.channelCount]);
			}
			if(query === "/Console/Aux_Outputs/modes")
			{
				return reply("/Console/Aux_Outputs/modes", state.auxModes.slice());
			}
			if((m = query.match(/^\/Aux_Outputs\/(\d+)\/Buss_Trim\/name$/)))
			{
				return reply(`/Aux_Outputs/${m[1]}/Buss_Trim/name`, [state.auxName(parseInt(m[1], 10))]);
			}
			if((m = query.match(/^\/Input_Channels\/(\d+)\/Channel_Input\/name$/)))
			{
				return reply(`/Input_Channels/${m[1]}/Channel_Input/name`, [state.channelName(parseInt(m[1], 10))]);
			}
			if(query === "/Snapshots/Current_Snapshot")
			{
				return reply("/Snapshots/Current_Snapshot", [state.snapshotIndex]);
			}
			if(query === "/Snapshots/names")
			{
				const name = state.snapshotNames[state.snapshotIndex] || `Snapshot ${state.snapshotIndex}`;
				// webmixer expects args[0] === current index and the name as the last arg
				return reply("/Snapshots/name", [state.snapshotIndex, name]);
			}
			if(query.match(/^\/Input_Channels\/\d+\/Aux_Send\/\d+\/send_(level|pan)$/))
			{
				return reply(query, [state.sends.has(query) ? state.sends.get(query) : defaultSend(query)]);
			}
			return; // unknown query - a real desk simply wouldn't answer
		}

		// a value being set by a web client (forwarded through webmixer)
		if(address.match(/^\/Input_Channels\/\d+\/Aux_Send\/\d+\/send_(level|pan)$/) && oscMsg.args && oscMsg.args.length)
		{
			state.sends.set(address, oscMsg.args[0]);
			return;
		}

		if(address === "/Console/Session/!")
		{
			log("  (session reload requested)");
		}
	});

	const whenReady = new Promise((resolve, reject) => {
		udpPort.once("ready", resolve);
		udpPort.once("error", reject);
	});

	udpPort.open();

	if(live)
	{
		liveTimer = setInterval(function()
		{
			state.snapshotIndex = (state.snapshotIndex + 1) % state.snapshotNames.length;
			log(`[live] snapshot -> ${state.snapshotIndex} "${state.snapshotNames[state.snapshotIndex]}"`);
			reply("/Snapshots/Current_Snapshot", [state.snapshotIndex]);
		}, 15000);
		if(liveTimer.unref) liveTimer.unref();
	}

	return {
		port,
		replyPort,
		whenReady,
		close()
		{
			if(liveTimer) clearInterval(liveTimer);
			try { udpPort.close(); } catch(e) { /* already closed */ }
		}
	};
}

module.exports = { createMockDesk };

// --- run as a script ---------------------------------------------------------

if(require.main === module)
{
	const fs = require("fs");
	const path = require("path");

	const args = {};
	const argv = process.argv.slice(2);
	for(let i = 0; i < argv.length; i++)
	{
		if(!argv[i].startsWith("--")) continue;
		const key = argv[i].slice(2);
		const next = argv[i + 1];
		if(next === undefined || next.startsWith("--")) { args[key] = true; }
		else { args[key] = next; i++; }
	}

	let fileConfig = {};
	const configPath = path.join(process.cwd(), "config.json");
	if(fs.existsSync(configPath))
	{
		try { fileConfig = JSON.parse(fs.readFileSync(configPath, "utf-8")); }
		catch(e) { console.warn(`Could not parse ${configPath}: ${e.message}. Using defaults.`); }
	}

	const desk = createMockDesk({
		port: parseInt(args.port ?? fileConfig?.desk?.port ?? 9000, 10),
		replyPort: parseInt(args["reply-port"] ?? fileConfig?.osc?.port ?? 8000, 10),
		host: args.host ?? "0.0.0.0",
		channels: parseInt(args.channels ?? args.channel ?? 24, 10),
		auxes: parseInt(args.auxes ?? args.auxilaries ?? 6, 10),
		live: !!args.live,
		log: (...a) => console.log(...a)
	});

	desk.whenReady.then(() =>
		console.log("Set the desk IP in the webmixer admin area to this machine, then reload.\n"));

	process.on("SIGINT", function()
	{
		console.log("\nStopping mock desk.");
		desk.close();
		process.exit(0);
	});
}
