"use strict";

/**
 * The desk connection wired to each mock console. Proves that whatever dialect
 * the desk speaks, `onInbound` always receives SD-shaped messages, and
 * `sendToDesk` reaches the desk in the right dialect.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createDeskConnection } = require("../../lib/desk/deskConnection.js");
const { createMockDesk } = require("../../tools/mock-desk.js");
const { createMockSDesk } = require("../../tools/mock-desk-s.js");

const quietLog = { info() {}, warn() {}, error() {}, debug() {} };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let nextPort = 9950;

test("SD: inbound queries answered by the mock arrive as SD-shaped messages", async () => {
	const deskPort = nextPort++;
	const listenPort = nextPort++;
	const desk = createMockDesk({ port: deskPort, replyPort: listenPort, host: "127.0.0.1", channels: 3, auxes: 2, log() {} });

	const inbound = [];
	const conn = createDeskConnection({
		desk: { ip: "127.0.0.1", port: deskPort },   // no type -> SD
		listenPort,
		log: quietLog,
		onFatal: (m) => { throw new Error(m); },
		onInbound: (msg) => inbound.push(msg),
		onReady: () => {}
	});

	try
	{
		await desk.whenReady;
		conn.start();
		await wait(50);

		assert.equal(conn.type, "SD");
		assert.equal(conn.loadStyle, "incremental");
		assert.deepEqual(conn.initialEvents(), []);

		conn.sendRaw(conn.query({ kind: "channelCount" }));
		conn.sendRaw(conn.query({ kind: "channelName", channel: 1 }));
		await wait(150);

		assert.deepEqual(inbound.find((m) => m.address === "/Console/Input_Channels").args, [3]);
		assert.equal(inbound.find((m) => m.address === "/Input_Channels/1/Channel_Input/name").args[0], "Kick");
	}
	finally { conn.stop(); desk.close(); }
});

test("SD: sendToDesk passes a fader change straight through", async () => {
	const deskPort = nextPort++;
	const listenPort = nextPort++;
	const desk = createMockDesk({ port: deskPort, replyPort: listenPort, host: "127.0.0.1", channels: 2, auxes: 1, log() {} });

	const inbound = [];
	const conn = createDeskConnection({
		desk: { ip: "127.0.0.1", port: deskPort },
		listenPort,
		log: quietLog,
		onFatal: (m) => { throw new Error(m); },
		onInbound: (msg) => inbound.push(msg),
		onReady: () => {}
	});

	try
	{
		await desk.whenReady;
		conn.start();
		await wait(50);

		conn.sendToDesk({ address: "/Input_Channels/2/Aux_Send/1/send_level", args: [-4.5] });
		await wait(80);
		// read it back
		conn.sendRaw({ address: "/Input_Channels/2/Aux_Send/1/send_level/?", args: [] });
		await wait(120);

		assert.equal(inbound.find((m) => m.address === "/Input_Channels/2/Aux_Send/1/send_level").args[0], -4.5);
	}
	finally { conn.stop(); desk.close(); }
});

test("S: a full resend arrives as SD-shaped messages the rest of the server understands", async () => {
	const deskPort = nextPort++;
	const listenPort = nextPort++;
	const desk = createMockSDesk({ port: deskPort, replyPort: listenPort, host: "127.0.0.1", channels: 4, auxes: 3, log() {} });

	const inbound = [];
	const conn = createDeskConnection({
		desk: { ip: "127.0.0.1", port: deskPort, type: "S", auxes: desk.auxes },
		listenPort,
		log: quietLog,
		onFatal: (m) => { throw new Error(m); },
		onInbound: (msg) => inbound.push(msg),
		onReady: () => {}
	});

	try
	{
		await desk.whenReady;
		conn.start();
		await wait(50);

		assert.equal(conn.type, "S");
		assert.equal(conn.loadStyle, "bulk");
		// synthetic aux modes, in SD shape, from the aux config (aux 3 is stereo)
		assert.deepEqual(conn.initialEvents(), [{ address: "/Console/Aux_Outputs/modes", args: [1, 1, 2] }]);

		conn.sendRaw(conn.bulkLoadRequest());
		await wait(250);

		// channel count came through as the SD address
		assert.equal(inbound.find((m) => m.address === "/Console/Input_Channels").args[0], 4);
		// an aux name (S channel 71 -> aux 2)
		assert.equal(inbound.find((m) => m.address === "/Aux_Outputs/2/Buss_Trim/name").args[0], "Bass IEM");
		// a channel name
		assert.equal(inbound.find((m) => m.address === "/Input_Channels/1/Channel_Input/name").args[0], "Kick");
		// a send level, SD-shaped
		assert.ok(inbound.some((m) => m.address === "/Input_Channels/1/Aux_Send/1/send_level"));
		// pan only for the stereo aux (aux 3)
		assert.ok(inbound.some((m) => m.address === "/Input_Channels/1/Aux_Send/3/send_pan"));
		assert.ok(!inbound.some((m) => m.address === "/Input_Channels/1/Aux_Send/1/send_pan"));
	}
	finally { conn.stop(); desk.close(); }
});

test("S: sendToDesk translates an SD-shaped fader change into the S dialect", async () => {
	const deskPort = nextPort++;
	const listenPort = nextPort++;
	const desk = createMockSDesk({ port: deskPort, replyPort: listenPort, host: "127.0.0.1", channels: 4, auxes: 3, log() {} });

	const inbound = [];
	const conn = createDeskConnection({
		desk: { ip: "127.0.0.1", port: deskPort, type: "S", auxes: desk.auxes },
		listenPort,
		log: quietLog,
		onFatal: (m) => { throw new Error(m); },
		onInbound: (msg) => inbound.push(msg),
		onReady: () => {}
	});

	try
	{
		await desk.whenReady;
		conn.start();
		await wait(50);

		// client speaks SD; aux 2 -> S send bus 2
		conn.sendToDesk({ address: "/Input_Channels/3/Aux_Send/2/send_level", args: [-7] });
		await wait(120);

		// the mock echoes changes back in the S dialect; the connection turns that
		// echo back into the SD shape for onInbound
		assert.equal(inbound.find((m) => m.address === "/Input_Channels/3/Aux_Send/2/send_level").args[0], -7);
	}
	finally { conn.stop(); desk.close(); }
});
