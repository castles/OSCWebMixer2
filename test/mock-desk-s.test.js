"use strict";

/**
 * Smoke tests for the mock S-Series console (tools/mock-desk-s.js).
 *
 * These also serve as executable documentation of the S-Series OSC behaviour the
 * real console is expected to have, for whoever builds the S-Series desk adapter.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const osc = require("osc");

const { createMockSDesk } = require("../tools/mock-desk-s.js");

let nextPort = 9700;

/**
 * Start the mock in-process on a fresh port and give the caller a tiny OSC client
 * that collects every message the mock sends back.
 */
async function startMock(opts = {})
{
	const port = nextPort++;
	const replyPort = nextPort++;

	const desk = createMockSDesk({
		port, replyPort, host: "127.0.0.1", channels: 4, auxes: 3, log: () => {}, ...opts
	});

	const received = [];
	const client = new osc.UDPPort({ localAddress: "127.0.0.1", localPort: replyPort, metadata: false });
	client.on("message", (m) => received.push(m));

	await Promise.all([
		desk.whenReady,
		new Promise((resolve, reject) => { client.on("ready", resolve); client.on("error", reject); client.open(); })
	]);

	return {
		received,
		send: (address, args = []) => client.send({ address, args }, "127.0.0.1", port),
		settle: (ms = 150) => new Promise((r) => setTimeout(r, ms)),
		stop: () => { client.close(); desk.close(); }
	};
}

test("responds to /console/ping with /console/pong", async () => {
	const mock = await startMock();
	try
	{
		mock.send("/console/ping");
		await mock.settle();
		assert.ok(mock.received.some((m) => m.address === "/console/pong"));
	}
	finally { mock.stop(); }
});

test("proactively sends /console/ping (like a real desk checking we're alive)", async () => {
	const mock = await startMock();
	try
	{
		mock.send("/console/resend");   // any packet tells the mock where we are
		await mock.settle(300);
		assert.ok(mock.received.some((m) => m.address === "/console/ping"));
	}
	finally { mock.stop(); }
});

test("/console/resend dumps channel counts, names and sends", async () => {
	const mock = await startMock();
	try
	{
		mock.send("/console/resend");
		await mock.settle(300);

		const byAddress = (re) => mock.received.filter((m) => re.test(m.address));

		assert.equal(mock.received.find((m) => m.address === "/console/channel/counts").args[0], 4);

		// 4 input channel names + 3 aux (channel) names
		assert.equal(byAddress(/^\/channel\/\d+\/name$/).length, 7);
		assert.ok(mock.received.some((m) => m.address === "/channel/70/name")); // aux channels from 70

		// every channel -> every send has a level and an enabled flag
		assert.equal(byAddress(/^\/channel\/\d+\/send\/\d+\/level$/).length, 12);
		assert.equal(byAddress(/^\/channel\/\d+\/send\/\d+\/enabled$/).length, 12);

		// only the one stereo aux (send 3) reports pan
		const pans = byAddress(/^\/channel\/\d+\/send\/\d+\/pan$/);
		assert.equal(pans.length, 4);
		assert.ok(pans.every((m) => m.address.endsWith("/send/3/pan")));

		// levels are dB, in the S-Series -90..10 range
		for(const m of byAddress(/\/send\/\d+\/level$/))
		{
			assert.ok(m.args[0] >= -90 && m.args[0] <= 10, `level ${m.args[0]} out of range`);
		}
	}
	finally { mock.stop(); }
});

test("echoes send level / pan changes back", async () => {
	const mock = await startMock();
	try
	{
		mock.send("/channel/2/send/1/level", [-6.5]);
		mock.send("/channel/2/send/3/pan", [0.4]);
		await mock.settle();

		assert.equal(mock.received.find((m) => m.address === "/channel/2/send/1/level").args[0], -6.5);
		assert.ok(Math.abs(mock.received.find((m) => m.address === "/channel/2/send/3/pan").args[0] - 0.4) < 1e-6);
	}
	finally { mock.stop(); }
});

test("missingHighSends withholds initial values for sends > 15", async () => {
	const mock = await startMock({ channels: 2, auxes: 18, missingHighSends: true });
	try
	{
		mock.send("/console/resend");
		await mock.settle(300);

		const sendNumbers = new Set(
			mock.received
				.map((m) => m.address.match(/^\/channel\/\d+\/send\/(\d+)\/level$/))
				.filter(Boolean)
				.map((m) => Number(m[1]))
		);
		assert.ok(sendNumbers.has(15));
		assert.ok(!sendNumbers.has(16));
	}
	finally { mock.stop(); }
});
