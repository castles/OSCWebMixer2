"use strict";

/**
 * Mock DiGiCo S-Series console (S21 / S31) for developing S-Series support in
 * OSCWebMixer2 without real hardware.
 *
 * The S-Series speaks a different OSC dialect from the SD / Quantum "DiGiCo iPad"
 * connection that tools/mock-desk.js and the current server use:
 *
 *   - address scheme is /channel/{ch}/... and /console/... (some firmware /digico/...)
 *   - there is NO per-value query. The only way to read the current state is to
 *     send /console/resend, which makes the desk dump everything at once.
 *   - an aux is itself a channel (it has a channel number, used for its name) AND
 *     a separate "send" bus number, used for routing: /channel/{ch}/send/{send}/level
 *   - there is no "aux modes" message; whether an aux is stereo is not reported.
 *   - send levels are dB (-90..10), pan is -1..1.
 *   - the desk sends /console/ping and expects /console/pong back.
 *
 * Sources: the S21 OSC command list and message dumps posted on
 * https://github.com/castles/OSCWebMixer2/issues/4, and the S-mapping from
 * version 1 (https://github.com/castles/OSCWebMixer/blob/main/mapping/S-mapping.mjs).
 *
 * Anything marked "UNVERIFIED" below is a best guess - it still needs checking
 * against a real console.
 *
 * Usage:
 *   node tools/mock-desk-s.js
 *   node tools/mock-desk-s.js --channels 32 --auxes 8
 *   node tools/mock-desk-s.js --port 9000 --reply-port 8000 --host 127.0.0.1
 *   node tools/mock-desk-s.js --missing-high-sends   # reproduce the known
 *                                                    # "sends > 15 never load" bug
 *   node tools/mock-desk-s.js --live                 # nudge faders / fire snapshots
 *
 * On a real rig the S-Series receives on port 8100 and sends from 9100 by
 * default; this mock defaults to 9000 / 8000 to match tools/mock-desk.js, and
 * learns where to reply from the first packet it receives anyway.
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
const AUX_COUNT = parseInt(args.auxes ?? 6, 10);

// The known S-Series firmware bug (see issue #4): initial values for send
// numbers above 15 are not sent on /console/resend unless the console has the
// paid channel-count upgrade, so webmixer never finishes loading. Pass
// --missing-high-sends to reproduce it while building the settle-timer workaround.
const MISSING_HIGH_SENDS = !!args["missing-high-sends"];
const HIGH_SEND_LIMIT = 15;

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
 * An aux on the S-Series is a channel (has a channel number, carries its name)
 * plus a separate send bus number used for routing. This mirrors the v1
 * config/default-S.json layout (aux channels 70+, sends 1+).
 */
const auxes = Array.from({ length: AUX_COUNT }, (_, i) => ({
	channel: 70 + i,
	send: 1 + i,
	stereo: i % 3 === 2,
	name: AUX_NAMES[i % AUX_NAMES.length] || `Aux ${i + 1}`
}));

const channelName = (n) => CHANNEL_NAMES[(n - 1) % CHANNEL_NAMES.length] || `Channel ${n}`;

/**
 * Mock desk state. Sends are keyed "c{channel}s{send}".
 */
const state = {
	channelCount: CHANNEL_COUNT,
	names: new Map(),          // channel number -> name (overrides the default)
	sendLevel: new Map(),      // "c{ch}s{send}" -> dB
	sendPan: new Map(),        // "c{ch}s{send}" -> -1..1
	sendEnabled: new Map(),    // "c{ch}s{send}" -> bool
	fader: new Map(),          // channel number -> dB
	mute: new Map(),           // channel number -> bool
	snapshot: 1
};

const sendKey = (ch, send) => `c${ch}s${send}`;
const DEFAULT_SEND_LEVEL = -10;  // dB
const DEFAULT_SEND_PAN = 0;

function nameFor(ch)
{
	if(state.names.has(ch)) return state.names.get(ch);
	const aux = auxes.find((a) => a.channel === ch);
	return aux ? aux.name : channelName(ch);
}

const udpPort = new osc.UDPPort({
	localAddress: HOST,
	localPort: DESK_PORT,
	metadata: false
});

let replyTo = null; // { address, port } of the webmixer server, learned from its first packet

function send(address, oscArgs = [])
{
	const target = replyTo || { address: "127.0.0.1", port: REPLY_PORT };
	udpPort.send({ address: address, args: oscArgs }, target.address, target.port);
	console.log(`  -> ${address} ${JSON.stringify(oscArgs)}`);
}

/**
 * Dump the whole console state, the way a real S-Series does in response to
 * /console/resend.
 */
function resend()
{
	console.log("  (resending full console state)");

	send("/console/channel/counts", [state.channelCount]);

	// input channel names
	for(let ch = 1; ch <= state.channelCount; ch++)
	{
		send(`/channel/${ch}/name`, [nameFor(ch)]);
	}

	// aux (which are also channels) names
	for(const aux of auxes)
	{
		send(`/channel/${aux.channel}/name`, [nameFor(aux.channel)]);
	}

	// every channel -> aux send
	for(let ch = 1; ch <= state.channelCount; ch++)
	{
		for(const aux of auxes)
		{
			if(MISSING_HIGH_SENDS && aux.send > HIGH_SEND_LIMIT)
			{
				continue; // the firmware bug: these initial values never arrive
			}

			const key = sendKey(ch, aux.send);
			send(`/channel/${ch}/send/${aux.send}/level`,
				[state.sendLevel.has(key) ? state.sendLevel.get(key) : DEFAULT_SEND_LEVEL]);
			send(`/channel/${ch}/send/${aux.send}/enabled`,
				[state.sendEnabled.has(key) ? state.sendEnabled.get(key) : true]);
			if(aux.stereo)
			{
				send(`/channel/${ch}/send/${aux.send}/pan`,
					[state.sendPan.has(key) ? state.sendPan.get(key) : DEFAULT_SEND_PAN]);
			}
		}
	}

	// UNVERIFIED: a real S-Series may report the current snapshot differently,
	// or not at all, on resend.
	send("/digico/snapshots/fire", [state.snapshot]);
}

udpPort.on("ready", function()
{
	console.log(`Mock DiGiCo S-Series console listening on ${HOST}:${DESK_PORT}`);
	console.log(`Replies go to port ${REPLY_PORT} (learned from incoming packets).`);
	console.log(`${state.channelCount} input channels, ${auxes.length} auxes ` +
		`(${auxes.filter(a => a.stereo).length} stereo).`);
	console.log("Aux channel / send / stereo:");
	for(const a of auxes)
	{
		console.log(`  "${a.name}"  channel ${a.channel}  send ${a.send}  ${a.stereo ? "stereo" : "mono"}`);
	}
	if(MISSING_HIGH_SENDS)
	{
		console.log(`\n!! --missing-high-sends: initial values for sends > ${HIGH_SEND_LIMIT} will NOT be sent`);
	}
	console.log("\nSend /console/resend to load, /console/ping for a pong.\n");
});

udpPort.on("error", function(err)
{
	console.error("UDP error:", err && err.stack ? err.stack : err);
});

udpPort.on("message", function(oscMsg, timeTag, info)
{
	replyTo = { address: info.address, port: info.port };

	const address = oscMsg.address;
	const oscArgs = oscMsg.args || [];
	console.log(`<- ${address} ${oscArgs.length ? JSON.stringify(oscArgs) : ""}`.trimEnd());

	// --- console query / control ---
	if(address === "/console/resend")
	{
		return resend();
	}
	if(address === "/console/ping")
	{
		return send("/console/pong");
	}
	if(address === "/console/channel/counts")
	{
		// a real console only sends this, but answering a direct request is harmless
		return send("/console/channel/counts", [state.channelCount]);
	}

	let m;

	// --- aux send level / pan / enabled being set by a client ---
	if((m = address.match(/^\/channel\/(\d+)\/send\/(\d+)\/(level|pan|enabled)$/)) && oscArgs.length)
	{
		const key = sendKey(parseInt(m[1], 10), parseInt(m[2], 10));
		const value = oscArgs[0];
		if(m[3] === "level") state.sendLevel.set(key, value);
		else if(m[3] === "pan") state.sendPan.set(key, value);
		else state.sendEnabled.set(key, value);
		// a real desk echoes the change back so other controllers stay in sync
		send(address, [value]);
		return;
	}

	// --- channel fader / mute / rename ---
	if((m = address.match(/^\/channel\/(\d+)\/fader$/)) && oscArgs.length)
	{
		state.fader.set(parseInt(m[1], 10), oscArgs[0]);
		send(address, [oscArgs[0]]);
		// the S21 dumps also showed /channel/{ch}/total/gain tracking the fader
		send(`/channel/${m[1]}/total/gain`, [oscArgs[0]]);
		return;
	}
	if((m = address.match(/^\/channel\/(\d+)\/mute$/)) && oscArgs.length)
	{
		state.mute.set(parseInt(m[1], 10), oscArgs[0]);
		send(address, [oscArgs[0]]);
		return;
	}
	if((m = address.match(/^\/channel\/(\d+)\/name$/)) && oscArgs.length)
	{
		state.names.set(parseInt(m[1], 10), String(oscArgs[0]));
		send(address, [oscArgs[0]]);
		return;
	}

	// --- snapshots ---
	if(address === "/digico/snapshots/fire" && oscArgs.length)
	{
		state.snapshot = oscArgs[0];
		console.log(`  (snapshot ${state.snapshot} fired)`);
		send("/digico/snapshots/fire", [state.snapshot]);
		return;
	}
	if(address === "/digico/snapshots/fire/next")
	{
		state.snapshot++;
		return send("/digico/snapshots/fire", [state.snapshot]);
	}
	if(address === "/digico/snapshots/fire/previous")
	{
		state.snapshot = Math.max(0, state.snapshot - 1);
		return send("/digico/snapshots/fire", [state.snapshot]);
	}
});

udpPort.open();

/**
 * Optional: nudge a fader and fire a snapshot every few seconds so the
 * desk-initiated update paths can be tested.
 */
if(args.live)
{
	let n = 0;
	setInterval(function()
	{
		n++;
		if(n % 4 === 0)
		{
			state.snapshot = (state.snapshot % 8) + 1;
			console.log(`\n[live] snapshot -> ${state.snapshot}`);
			send("/digico/snapshots/fire", [state.snapshot]);
			return;
		}
		const ch = 1 + (n % Math.min(4, state.channelCount));
		const aux = auxes[0];
		const key = sendKey(ch, aux.send);
		const level = -30 + Math.round(Math.random() * 30);
		state.sendLevel.set(key, level);
		console.log(`\n[live] channel ${ch} -> ${aux.name} = ${level} dB`);
		send(`/channel/${ch}/send/${aux.send}/level`, [level]);
	}, 5000);
}

process.on("SIGINT", function()
{
	console.log("\nStopping mock S-Series console.");
	udpPort.close();
	process.exit(0);
});
