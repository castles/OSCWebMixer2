"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createSAdapter } = require("../../lib/desk/sAdapter.js");
const { createDeskAdapter, eventToCommand, validateSAuxRouting } = require("../../lib/desk/deskAdapter.js");

// aux 1 -> channel 70 / send 1 / stereo
// aux 2 -> channel 71 / send 2 / mono
// aux 3 -> channel 72 / send 3 / stereo
const AUXES = [
	{ channel: 70, send: 1, stereo: true },
	{ channel: 71, send: 2, stereo: false },
	{ channel: 72, send: 3, stereo: true }
];

test("S adapter identifies as S and loads in bulk", () => {
	const a = createSAdapter({ auxes: AUXES });
	assert.equal(a.type, "S");
	assert.equal(a.loadStyle, "bulk");
	assert.deepEqual(a.bulkLoadRequest(), { address: "/console/resend", args: [] });
	assert.equal(a.buildQuery({ kind: "channelCount" }), null);
});

test("S initialEvents synthesises aux modes from config (S-Series has no modes message)", () => {
	const a = createSAdapter({ auxes: AUXES });
	assert.deepEqual(a.initialEvents(), [{ type: "auxModes", modes: [2, 1, 2] }]);

	// with no aux config there is nothing to synthesise
	assert.deepEqual(createSAdapter({ auxes: [] }).initialEvents(), []);
});

test("S parseIncoming: /console/ping -> keepAlivePing, and autoReply pongs it", () => {
	const a = createSAdapter({ auxes: AUXES });
	const events = a.parseIncoming({ address: "/console/ping", args: [] });
	assert.deepEqual(events, [{ type: "keepAlivePing" }]);
	assert.deepEqual(a.autoReply(events[0]), { address: "/console/pong", args: [] });
	assert.equal(a.autoReply({ type: "sendLevel" }), null);
});

test("S parseIncoming: channel count", () => {
	const a = createSAdapter({ auxes: AUXES });
	assert.deepEqual(a.parseIncoming({ address: "/console/channel/counts", args: [32] }),
		[{ type: "channelCount", count: 32 }]);
});

test("S parseIncoming: /channel/{n}/name is an aux name when n is an aux channel, otherwise a channel name", () => {
	const a = createSAdapter({ auxes: AUXES });

	assert.deepEqual(a.parseIncoming({ address: "/channel/71/name", args: ["Bass IEM"] }),
		[{ type: "auxName", aux: 2, name: "Bass IEM" }]);

	assert.deepEqual(a.parseIncoming({ address: "/channel/5/name", args: ["Hi Hat"] }),
		[{ type: "channelName", channel: 5, name: "Hi Hat" }]);
});

test("S parseIncoming: send level/pan resolve the send bus number to an aux index", () => {
	const a = createSAdapter({ auxes: AUXES });

	assert.deepEqual(a.parseIncoming({ address: "/channel/5/send/2/level", args: [-8] }),
		[{ type: "sendLevel", channel: 5, aux: 2, db: -8 }]);

	// send 99 is not one of our auxes - ignored
	assert.deepEqual(a.parseIncoming({ address: "/channel/5/send/99/level", args: [-8] }), []);
});

test("S parseIncoming: pan is converted from S -1..1 to neutral 0..1", () => {
	const a = createSAdapter({ auxes: AUXES });

	assert.deepEqual(a.parseIncoming({ address: "/channel/5/send/1/pan", args: [0] }),
		[{ type: "sendPan", channel: 5, aux: 1, pan: 0.5 }]);   // centre
	assert.deepEqual(a.parseIncoming({ address: "/channel/5/send/1/pan", args: [-1] }),
		[{ type: "sendPan", channel: 5, aux: 1, pan: 0 }]);     // hard left
	assert.deepEqual(a.parseIncoming({ address: "/channel/5/send/1/pan", args: [1] }),
		[{ type: "sendPan", channel: 5, aux: 1, pan: 1 }]);     // hard right
});

test("S parseIncoming: /channel/{ch}/send/{s}/enabled is ignored (not modelled yet)", () => {
	const a = createSAdapter({ auxes: AUXES });
	assert.deepEqual(a.parseIncoming({ address: "/channel/5/send/1/enabled", args: [true] }), []);
});

test("S buildCommand: send level/pan use the send bus number and convert pan back to -1..1", () => {
	const a = createSAdapter({ auxes: AUXES });

	assert.deepEqual(a.buildCommand({ type: "setSendLevel", channel: 5, aux: 2, db: -8 }),
		{ address: "/channel/5/send/2/level", args: [-8] });

	assert.deepEqual(a.buildCommand({ type: "setSendPan", channel: 5, aux: 1, pan: 0.5 }),
		{ address: "/channel/5/send/1/pan", args: [0] });
	assert.deepEqual(a.buildCommand({ type: "setSendPan", channel: 5, aux: 1, pan: 1 }),
		{ address: "/channel/5/send/1/pan", args: [1] });

	// aux index out of range
	assert.equal(a.buildCommand({ type: "setSendLevel", channel: 5, aux: 9, db: 0 }), null);
});

test("S buildCommand: aux rename targets the aux's channel", () => {
	const a = createSAdapter({ auxes: AUXES });
	assert.deepEqual(a.buildCommand({ type: "setAuxName", aux: 3, name: "Gtr IEM" }),
		{ address: "/channel/72/name", args: ["Gtr IEM"] });
	assert.deepEqual(a.buildCommand({ type: "setChannelName", channel: 5, name: "Snare" }),
		{ address: "/channel/5/name", args: ["Snare"] });
});

test("round trip: an S send command parses back to the same neutral value", () => {
	const a = createSAdapter({ auxes: AUXES });

	for(const cmd of [
		{ type: "setSendLevel", channel: 9, aux: 3, db: -3.25 },
		{ type: "setSendPan", channel: 9, aux: 3, pan: 0.2 }
	])
	{
		const osc = a.buildCommand(cmd);
		const [event] = a.parseIncoming(osc);
		if(cmd.type === "setSendLevel")
		{
			assert.deepEqual(event, { type: "sendLevel", channel: 9, aux: 3, db: -3.25 });
		}
		else
		{
			assert.equal(event.type, "sendPan");
			assert.ok(Math.abs(event.pan - 0.2) < 1e-9);
		}
	}
});

test("validateSAuxRouting catches duplicate send buses and channels", () => {
	assert.deepEqual(validateSAuxRouting(AUXES), []);   // the good config from above

	assert.deepEqual(
		validateSAuxRouting([
			{ channel: 70, send: 3 },
			{ channel: 71, send: 2 },
			{ channel: 72, send: 3 }   // send bus 3 again
		]),
		["Aux 3 and aux 1 both use send bus 3."]
	);

	assert.deepEqual(
		validateSAuxRouting([
			{ channel: 70, send: 1 },
			{ channel: 70, send: 2 }   // channel 70 again
		]),
		["Aux 2 and aux 1 both use channel 70."]
	);

	assert.deepEqual(
		validateSAuxRouting([{ channel: 70 }]),
		["Aux 1 has no send bus number."]
	);
});

test("the S adapter exposes routing problems as configWarnings", () => {
	const bad = createSAdapter({ auxes: [{ channel: 70, send: 1 }, { channel: 71, send: 1 }] });
	assert.equal(bad.configWarnings.length, 1);
	assert.match(bad.configWarnings[0], /both use send bus 1/);

	assert.deepEqual(createSAdapter({ auxes: AUXES }).configWarnings, []);
});

test("eventToCommand turns a value event into the command that sets it", () => {
	assert.deepEqual(eventToCommand({ type: "sendLevel", channel: 3, aux: 2, db: -4 }),
		{ type: "setSendLevel", channel: 3, aux: 2, db: -4 });
	assert.deepEqual(eventToCommand({ type: "sendPan", channel: 3, aux: 2, pan: 0.7 }),
		{ type: "setSendPan", channel: 3, aux: 2, pan: 0.7 });
	assert.deepEqual(eventToCommand({ type: "channelName", channel: 3, name: "Kick" }),
		{ type: "setChannelName", channel: 3, name: "Kick" });
	assert.equal(eventToCommand({ type: "auxModes", modes: [1] }), null);
});

test("factory returns the S adapter for S / S-Series and passes the aux config through", () => {
	const a = createDeskAdapter({ type: "S", auxes: AUXES });
	assert.equal(a.type, "S");
	assert.deepEqual(a.buildCommand({ type: "setSendLevel", channel: 1, aux: 2, db: 0 }),
		{ address: "/channel/1/send/2/level", args: [0] });

	assert.equal(createDeskAdapter({ type: "s-series", auxes: AUXES }).type, "S");
});
