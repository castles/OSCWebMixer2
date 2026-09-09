"use strict";

/**
 * Mock DiGiCo console for developing / debugging OSCWebMixer2 without real hardware.
 *
 * It listens on the desk port and answers the OSC queries that index.js sends while
 * loading (channel count, aux modes, channel + aux names, snapshot, send levels and
 * pans), so the server reaches its "ready" state and the web mixer, plugins and
 * external-device routing can all be exercised on a workbench.
 *
 * Every message the server sends is printed, so this doubles as a way to see exactly
 * what the web mixer is doing to the desk.
 *
 * Usage:
 *   node tools/mock-desk.js                 # uses ./config.json (or defaults)
 *   node tools/mock-desk.js --channels 32 --auxes 8
 *   node tools/mock-desk.js --port 9000 --reply-port 8000 --host 127.0.0.1
 *   node tools/mock-desk.js --live          # also push periodic snapshot changes
 *
 * Point webmixer at it by setting the desk IP to this machine (127.0.0.1 when both
 * run on the same box) in the admin area.
 */

const fs = require("fs");
const path = require("path");
const osc = require("osc");

/**
 * Parse "--flag value" / "--flag" style arguments.
 * @returns {Object.<string, string|boolean>}
 */
function parseArgs(argv)
{
	const args = {};
	for(let i = 0; i < argv.length; i++)
	{
		if(!argv[i].startsWith("--"))
		{
			continue;
		}
		const key = argv[i].slice(2);
		const next = argv[i + 1];
		if(next === undefined || next.startsWith("--"))
		{
			args[key] = true;
		}
		else
		{
			args[key] = next;
			i++;
		}
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));

/**
 * Read ports from ./config.json when it exists so the mock lines up with whatever
 * webmixer is configured to use. CLI flags win over the file.
 */
let fileConfig = {};
const configPath = path.join(process.cwd(), "config.json");
if(fs.existsSync(configPath))
{
	try
	{
		fileConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
	}
	catch(e)
	{
		console.warn(`Could not parse ${configPath}: ${e.message}. Using defaults.`);
	}
}

const DESK_PORT = parseInt(args.port ?? fileConfig?.desk?.port ?? 9000, 10);
const REPLY_PORT = parseInt(args["reply-port"] ?? fileConfig?.osc?.port ?? 8000, 10);
const HOST = args.host ?? "0.0.0.0";
const CHANNEL_COUNT = parseInt(args.channels ?? 24, 10);
const AUX_COUNT = parseInt(args.auxes ?? args.auxilaries ?? 6, 10);

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
 * Build the mock desk state.
 */
const state = {
	channelCount: CHANNEL_COUNT,
	// alternate mono (1) / stereo (2) auxes so both code paths get exercised
	auxModes: Array.from({ length: AUX_COUNT }, (_, i) => (i % 3 === 2 ? 2 : 1)),
	channelName: (n) => CHANNEL_NAMES[(n - 1) % CHANNEL_NAMES.length] || `Channel ${n}`,
	auxName: (n) => AUX_NAMES[(n - 1) % AUX_NAMES.length] || `Aux ${n}`,
	snapshotIndex: 1,
	snapshotNames: ["Default", "Walk In", "Band 1", "Support", "Headliner", "Walk Out"],
	// live send level (dB) / pan (0..1) values, keyed by OSC address, lazily defaulted
	sends: new Map()
};

/**
 * Default send level / pan for a channel->aux pair before anything has moved it.
 */
function defaultSend(address)
{
	return address.endsWith("send_pan") ? 0.5 : -12;
}

const udpPort = new osc.UDPPort({
	localAddress: HOST,
	localPort: DESK_PORT,
	metadata: false
});

let replyTo = null; // { address, port } of the webmixer server, learned from its first packet

/**
 * Send an OSC message back to the webmixer server.
 */
function reply(address, oscArgs)
{
	const target = replyTo || { address: "127.0.0.1", port: REPLY_PORT };
	udpPort.send({ address: address, args: oscArgs }, target.address, target.port);
	console.log(`  -> ${address} ${JSON.stringify(oscArgs)}`);
}

udpPort.on("ready", function()
{
	console.log(`Mock DiGiCo desk listening on ${HOST}:${DESK_PORT}`);
	console.log(`Replies go to the webmixer OSC port ${REPLY_PORT} (learned from incoming packets).`);
	console.log(`${state.channelCount} channels, ${state.auxModes.length} auxes ` +
		`(${state.auxModes.filter(m => m === 2).length} stereo).`);
	console.log("Set the desk IP in the webmixer admin area to this machine, then reload.\n");
});

udpPort.on("error", function(err)
{
	console.error("UDP error:", err && err.stack ? err.stack : err);
});

udpPort.on("message", function(oscMsg, timeTag, info)
{
	replyTo = { address: info.address, port: info.port };

	const address = oscMsg.address;
	console.log(`<- ${address} ${oscMsg.args && oscMsg.args.length ? JSON.stringify(oscMsg.args) : ""}`.trimEnd());

	// --- query for a value (address ends with /?) ---
	if(address.endsWith("/?"))
	{
		const q = address.slice(0, -2);
		let m;

		if(q === "/Console/Channels")
		{
			return reply("/Console/Input_Channels", [state.channelCount]);
		}

		if(q === "/Console/Aux_Outputs/modes")
		{
			return reply("/Console/Aux_Outputs/modes", state.auxModes.slice());
		}

		if((m = q.match(/^\/Aux_Outputs\/(\d+)\/Buss_Trim\/name$/)))
		{
			return reply(`/Aux_Outputs/${m[1]}/Buss_Trim/name`, [state.auxName(parseInt(m[1], 10))]);
		}

		if((m = q.match(/^\/Input_Channels\/(\d+)\/Channel_Input\/name$/)))
		{
			return reply(`/Input_Channels/${m[1]}/Channel_Input/name`, [state.channelName(parseInt(m[1], 10))]);
		}

		if(q === "/Snapshots/Current_Snapshot")
		{
			return reply("/Snapshots/Current_Snapshot", [state.snapshotIndex]);
		}

		if(q === "/Snapshots/names")
		{
			const name = state.snapshotNames[state.snapshotIndex] || `Snapshot ${state.snapshotIndex}`;
			// webmixer expects args[0] === current index and the name as the last arg
			return reply("/Snapshots/name", [state.snapshotIndex, name]);
		}

		if((m = q.match(/^\/Input_Channels\/\d+\/Aux_Send\/\d+\/send_(level|pan)$/)))
		{
			const value = state.sends.has(q) ? state.sends.get(q) : defaultSend(q);
			return reply(q, [value]);
		}

		// unknown query - stay quiet, a real desk simply wouldn't answer
		return;
	}

	// --- a value being set by a web client (forwarded through webmixer) ---
	let m = address.match(/^\/Input_Channels\/\d+\/Aux_Send\/\d+\/send_(level|pan)$/);
	if(m && oscMsg.args && oscMsg.args.length)
	{
		state.sends.set(address, oscMsg.args[0]);
		return;
	}

	// --- session reload ---
	if(address === "/Console/Session/!")
	{
		console.log("  (session reload requested)");
		return;
	}
});

udpPort.open();

/**
 * Optional: periodically move the snapshot on so the snapshot-name display and the
 * reload path can be tested without touching a desk.
 */
if(args.live)
{
	setInterval(function()
	{
		state.snapshotIndex = (state.snapshotIndex + 1) % state.snapshotNames.length;
		console.log(`\n[live] snapshot -> ${state.snapshotIndex} "${state.snapshotNames[state.snapshotIndex]}"`);
		reply("/Snapshots/Current_Snapshot", [state.snapshotIndex]);
	}, 15000);
}

process.on("SIGINT", function()
{
	console.log("\nStopping mock desk.");
	udpPort.close();
	process.exit(0);
});
