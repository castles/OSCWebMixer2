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
 *   - the desk periodically sends /console/ping and expects /console/pong back;
 *     this mock does the same once it knows where the client is.
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
 *
 * `createMockSDesk(opts)` is also exported so tests can run it in-process.
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

const DEFAULT_SEND_LEVEL = -10;  // dB
const DEFAULT_SEND_PAN = 0;      // S-Series pan is -1..1, 0 = centre

// The known S-Series firmware bug (see issue #4): initial values for send
// numbers above 15 are not sent on /console/resend unless the console has the
// paid channel-count upgrade, so webmixer never finishes loading.
const HIGH_SEND_LIMIT = 15;

/**
 * Create a mock S-Series console.
 *
 * @param {Object} [opts]
 * @param {number} [opts.port=9000]        UDP port the desk listens on
 * @param {number} [opts.replyPort=8000]   fallback port to reply to before a
 *                                         packet is received
 * @param {string} [opts.host="0.0.0.0"]
 * @param {number} [opts.channels=24]      number of input channels
 * @param {number} [opts.auxes=6]          number of auxes
 * @param {boolean} [opts.missingHighSends=false]  reproduce the sends > 15 bug
 * @param {boolean} [opts.live=false]      nudge faders / fire snapshots
 * @param {(...args:any[])=>void} [opts.log=console.log]
 * @returns {{ port:number, replyPort:number, auxes:object[], whenReady:Promise<void>, close:()=>void }}
 */
function createMockSDesk(opts = {})
{
	const port = opts.port ?? 9000;
	const replyPort = opts.replyPort ?? 8000;
	const host = opts.host ?? "0.0.0.0";
	const channelCount = opts.channels ?? 24;
	const auxCount = opts.auxes ?? 6;
	const missingHighSends = !!opts.missingHighSends;
	const live = !!opts.live;
	const log = opts.log ?? console.log;

	/**
	 * An aux on the S-Series is a channel (has a channel number, carries its name)
	 * plus a separate send bus number used for routing. This mirrors the v1
	 * config/default-S.json layout (aux channels 70+, sends 1+).
	 */
	const auxes = Array.from({ length: auxCount }, (_, i) => ({
		channel: 70 + i,
		send: 1 + i,
		stereo: i % 3 === 2,
		name: AUX_NAMES[i % AUX_NAMES.length] || `Aux ${i + 1}`
	}));

	const channelName = (n) => CHANNEL_NAMES[(n - 1) % CHANNEL_NAMES.length] || `Channel ${n}`;
	const sendKey = (ch, send) => `c${ch}s${send}`;

	const state = {
		names: new Map(),        // channel number -> name (overrides the default)
		sendLevel: new Map(),    // "c{ch}s{send}" -> dB
		sendPan: new Map(),      // "c{ch}s{send}" -> -1..1
		sendEnabled: new Map(),  // "c{ch}s{send}" -> bool
		fader: new Map(),        // channel number -> dB
		mute: new Map(),         // channel number -> bool
		snapshot: 1
	};

	function nameFor(ch)
	{
		if(state.names.has(ch)) return state.names.get(ch);
		const aux = auxes.find((a) => a.channel === ch);
		return aux ? aux.name : channelName(ch);
	}

	const udpPort = new osc.UDPPort({ localAddress: host, localPort: port, metadata: false });
	let replyTo = null;
	let pingTimer = null;
	let liveTimer = null;

	function send(address, oscArgs = [])
	{
		const target = replyTo || { address: "127.0.0.1", port: replyPort };
		udpPort.send({ address, args: oscArgs }, target.address, target.port);
		log(`  -> ${address} ${JSON.stringify(oscArgs)}`);
	}

	/**
	 * Dump the whole console state, the way a real S-Series does in response to
	 * /console/resend.
	 */
	function resend()
	{
		log("  (resending full console state)");

		send("/console/channel/counts", [channelCount]);

		for(let ch = 1; ch <= channelCount; ch++)
		{
			send(`/channel/${ch}/name`, [nameFor(ch)]);
		}
		for(const aux of auxes)
		{
			send(`/channel/${aux.channel}/name`, [nameFor(aux.channel)]);
		}

		for(let ch = 1; ch <= channelCount; ch++)
		{
			for(const aux of auxes)
			{
				if(missingHighSends && aux.send > HIGH_SEND_LIMIT)
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

	// A real S-Series periodically sends /console/ping and expects /console/pong
	// back. Start doing that once we know where the client is.
	function startPinging()
	{
		if(pingTimer) return;
		send("/console/ping");
		pingTimer = setInterval(() => send("/console/ping"), 3000);
		if(pingTimer.unref) pingTimer.unref();
	}

	udpPort.on("ready", function()
	{
		log(`Mock DiGiCo S-Series console listening on ${host}:${port}`);
		log(`Replies go to port ${replyPort} (learned from incoming packets).`);
		log(`${channelCount} input channels, ${auxes.length} auxes ` +
			`(${auxes.filter(a => a.stereo).length} stereo).`);
		for(const a of auxes)
		{
			log(`  "${a.name}"  channel ${a.channel}  send ${a.send}  ${a.stereo ? "stereo" : "mono"}`);
		}
		if(missingHighSends)
		{
			log(`!! --missing-high-sends: initial values for sends > ${HIGH_SEND_LIMIT} will NOT be sent`);
		}
	});

	udpPort.on("error", function(err)
	{
		console.error("UDP error:", err && err.stack ? err.stack : err);
	});

	udpPort.on("message", function(oscMsg, timeTag, info)
	{
		replyTo = { address: info.address, port: info.port };
		startPinging();

		const address = oscMsg.address;
		const oscArgs = oscMsg.args || [];
		log(`<- ${address} ${oscArgs.length ? JSON.stringify(oscArgs) : ""}`.trimEnd());

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
			return send("/console/channel/counts", [channelCount]);
		}

		let m;

		// aux send level / pan / enabled being set by a client
		if((m = address.match(/^\/channel\/(\d+)\/send\/(\d+)\/(level|pan|enabled)$/)) && oscArgs.length)
		{
			const key = sendKey(parseInt(m[1], 10), parseInt(m[2], 10));
			const value = oscArgs[0];
			if(m[3] === "level") state.sendLevel.set(key, value);
			else if(m[3] === "pan") state.sendPan.set(key, value);
			else state.sendEnabled.set(key, value);
			send(address, [value]); // a real desk echoes changes back
			return;
		}

		// channel fader / mute / rename
		if((m = address.match(/^\/channel\/(\d+)\/fader$/)) && oscArgs.length)
		{
			state.fader.set(parseInt(m[1], 10), oscArgs[0]);
			send(address, [oscArgs[0]]);
			send(`/channel/${m[1]}/total/gain`, [oscArgs[0]]); // S21 dumps showed this tracking the fader
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

		// snapshots
		if(address === "/digico/snapshots/fire" && oscArgs.length)
		{
			state.snapshot = oscArgs[0];
			log(`  (snapshot ${state.snapshot} fired)`);
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

	const whenReady = new Promise((resolve, reject) => {
		udpPort.once("ready", resolve);
		udpPort.once("error", reject);
	});

	udpPort.open();

	if(live)
	{
		let n = 0;
		liveTimer = setInterval(function()
		{
			n++;
			if(n % 4 === 0)
			{
				state.snapshot = (state.snapshot % 8) + 1;
				log(`[live] snapshot -> ${state.snapshot}`);
				send("/digico/snapshots/fire", [state.snapshot]);
				return;
			}
			const ch = 1 + (n % Math.min(4, channelCount));
			const aux = auxes[0];
			const level = -30 + Math.round(Math.random() * 30);
			state.sendLevel.set(sendKey(ch, aux.send), level);
			log(`[live] channel ${ch} -> ${aux.name} = ${level} dB`);
			send(`/channel/${ch}/send/${aux.send}/level`, [level]);
		}, 5000);
		if(liveTimer.unref) liveTimer.unref();
	}

	return {
		port,
		replyPort,
		auxes,
		whenReady,
		close()
		{
			if(pingTimer) clearInterval(pingTimer);
			if(liveTimer) clearInterval(liveTimer);
			try { udpPort.close(); } catch(e) { /* already closed */ }
		}
	};
}

module.exports = { createMockSDesk };

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

	const desk = createMockSDesk({
		port: parseInt(args.port ?? fileConfig?.desk?.port ?? 9000, 10),
		replyPort: parseInt(args["reply-port"] ?? fileConfig?.osc?.port ?? 8000, 10),
		host: args.host ?? "0.0.0.0",
		channels: parseInt(args.channels ?? 24, 10),
		auxes: parseInt(args.auxes ?? 6, 10),
		missingHighSends: !!args["missing-high-sends"],
		live: !!args.live,
		log: (...a) => console.log(...a)
	});

	desk.whenReady.then(() => console.log("\nSend /console/resend to load, /console/ping for a pong.\n"));

	process.on("SIGINT", function()
	{
		console.log("\nStopping mock S-Series console.");
		desk.close();
		process.exit(0);
	});
}
