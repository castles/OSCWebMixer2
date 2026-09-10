"use strict";

/**
 * Integration check: the S-Series adapter and the S-Series mock console agree on
 * the protocol. Everything the mock sends in response to /console/resend and
 * /console/ping should be understood by createSAdapter().parseIncoming(), and
 * the resulting neutral picture should be complete.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const osc = require("osc");

const { createSAdapter } = require("../../lib/desk/sAdapter.js");
const { createMockSDesk } = require("../../tools/mock-desk-s.js");

const CHANNELS = 6;
const AUX_COUNT = 4;

test("S adapter understands a full resend from the mock console", async () => {
	const port = 9880 + Math.floor(Math.random() * 60);
	const replyPort = port + 1;

	const desk = createMockSDesk({
		port, replyPort, host: "127.0.0.1", channels: CHANNELS, auxes: AUX_COUNT, log: () => {}
	});
	const adapter = createSAdapter({ auxes: desk.auxes });   // same aux layout the mock uses
	const client = new osc.UDPPort({ localAddress: "127.0.0.1", localPort: replyPort, metadata: false });

	const picture = {
		channelCount: null,
		channelNames: new Map(),
		auxNames: new Map(),
		sendLevels: new Map(),
		sendPans: new Map(),
		auxModes: null,
		snapshotIndex: null,
		pongs: 0,
		unhandled: []
	};

	// messages the adapter deliberately drops (returns no events for)
	const IGNORED = [
		/^\/console\/pong$/,
		/^\/channel\/\d+\/send\/\d+\/enabled$/
	];

	function apply(events)
	{
		for(const e of events)
		{
			if(e.type === "channelCount") picture.channelCount = e.count;
			else if(e.type === "channelName") picture.channelNames.set(e.channel, e.name);
			else if(e.type === "auxName") picture.auxNames.set(e.aux, e.name);
			else if(e.type === "sendLevel") picture.sendLevels.set(`c${e.channel}a${e.aux}`, e.db);
			else if(e.type === "sendPan") picture.sendPans.set(`c${e.channel}a${e.aux}`, e.pan);
			else if(e.type === "auxModes") picture.auxModes = e.modes;
			else if(e.type === "snapshotIndex") picture.snapshotIndex = e.index;
			else if(e.type === "keepAlivePing") { /* replied to below */ }
			else picture.unhandled.push(e);
		}
	}

	client.on("message", (m) => {
		const events = adapter.parseIncoming(m);
		if(events.length === 0)
		{
			if(!IGNORED.some((re) => re.test(m.address))) picture.unhandled.push(m.address);
			return;
		}
		apply(events);
		for(const e of events)
		{
			const reply = adapter.autoReply(e);
			if(reply) { picture.pongs++; client.send(reply, "127.0.0.1", port); }
		}
	});

	try
	{
		await Promise.all([
			desk.whenReady,
			new Promise((resolve, reject) => { client.on("ready", resolve); client.on("error", reject); client.open(); })
		]);

		apply(adapter.initialEvents());   // synthetic aux modes from config

		client.send({ address: "/console/ping", args: [] }, "127.0.0.1", port);
		client.send({ address: "/console/resend", args: [] }, "127.0.0.1", port);
		await new Promise((r) => setTimeout(r, 400));

		assert.equal(picture.channelCount, CHANNELS, "channel count");
		// mock: every 3rd aux (index 2 -> aux 3) is stereo
		assert.deepEqual(picture.auxModes, [1, 1, 2, 1], "aux modes synthesised from config");
		const stereoAux = 3;

		for(let ch = 1; ch <= CHANNELS; ch++)
		{
			assert.ok(picture.channelNames.has(ch), `channel ${ch} name`);
		}
		for(let aux = 1; aux <= AUX_COUNT; aux++)
		{
			assert.ok(picture.auxNames.has(aux), `aux ${aux} name`);
		}

		for(let ch = 1; ch <= CHANNELS; ch++)
		{
			for(let aux = 1; aux <= AUX_COUNT; aux++)
			{
				const db = picture.sendLevels.get(`c${ch}a${aux}`);
				assert.equal(typeof db, "number", `send level c${ch} a${aux}`);
				assert.ok(db >= -90 && db <= 10);
			}
		}

		for(let ch = 1; ch <= CHANNELS; ch++)
		{
			assert.ok(picture.sendPans.has(`c${ch}a${stereoAux}`), `stereo aux pan c${ch}`);
			assert.ok(!picture.sendPans.has(`c${ch}a1`), `mono aux has no pan c${ch}`);
			const pan = picture.sendPans.get(`c${ch}a${stereoAux}`);
			assert.ok(pan >= 0 && pan <= 1);
		}

		assert.equal(picture.snapshotIndex, 1, "current snapshot from resend");
		assert.ok(picture.pongs >= 1, "replied to at least one ping");
		assert.deepEqual(picture.unhandled, [],
			"adapter placed every message the mock sent (except the known-ignored ones)");
	}
	finally
	{
		client.close();
		desk.close();
	}
});
