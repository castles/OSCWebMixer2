"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createSdAdapter } = require("../../lib/desk/sdAdapter.js");
const { createDeskAdapter } = require("../../lib/desk/deskAdapter.js");

test("SD adapter identifies as SD and loads incrementally", () => {
	const a = createSdAdapter();
	assert.equal(a.type, "SD");
	assert.equal(a.loadStyle, "incremental");
	assert.deepEqual(a.initialEvents(), []);
	assert.equal(a.bulkLoadRequest(), null);
	assert.equal(a.autoReply({ type: "keepAlivePing" }), null);
});

test("SD buildQuery produces the DiGiCo iPad query addresses", () => {
	const a = createSdAdapter();
	assert.equal(a.buildQuery({ kind: "channelCount" }).address, "/Console/Channels/?");
	assert.equal(a.buildQuery({ kind: "auxModes" }).address, "/Console/Aux_Outputs/modes/?");
	assert.equal(a.buildQuery({ kind: "auxName", aux: 3 }).address, "/Aux_Outputs/3/Buss_Trim/name/?");
	assert.equal(a.buildQuery({ kind: "channelName", channel: 7 }).address, "/Input_Channels/7/Channel_Input/name/?");
	assert.equal(a.buildQuery({ kind: "sendLevel", channel: 7, aux: 2 }).address,
		"/Input_Channels/7/Aux_Send/2/send_level/?");
	assert.equal(a.buildQuery({ kind: "sendPan", channel: 7, aux: 2 }).address,
		"/Input_Channels/7/Aux_Send/2/send_pan/?");
	assert.equal(a.buildQuery({ kind: "snapshot" }).address, "/Snapshots/Current_Snapshot/?");
	assert.equal(a.buildQuery({ kind: "nonsense" }), null);
});

test("SD parseIncoming maps desk messages to neutral events", () => {
	const a = createSdAdapter();

	assert.deepEqual(a.parseIncoming({ address: "/Console/Input_Channels", args: [48] }),
		[{ type: "channelCount", count: 48 }]);

	assert.deepEqual(a.parseIncoming({ address: "/Console/Aux_Outputs/modes", args: [1, 2, 1] }),
		[{ type: "auxModes", modes: [1, 2, 1] }]);

	assert.deepEqual(a.parseIncoming({ address: "/Aux_Outputs/2/Buss_Trim/name", args: ["Monitors"] }),
		[{ type: "auxName", aux: 2, name: "Monitors" }]);

	assert.deepEqual(a.parseIncoming({ address: "/Input_Channels/12/Channel_Input/name", args: ["Kick"] }),
		[{ type: "channelName", channel: 12, name: "Kick" }]);

	assert.deepEqual(a.parseIncoming({ address: "/Input_Channels/12/Aux_Send/3/send_level", args: [-6.5] }),
		[{ type: "sendLevel", channel: 12, aux: 3, db: -6.5 }]);

	assert.deepEqual(a.parseIncoming({ address: "/Input_Channels/12/Aux_Send/3/send_pan", args: [0.25] }),
		[{ type: "sendPan", channel: 12, aux: 3, pan: 0.25 }]);

	assert.deepEqual(a.parseIncoming({ address: "/Snapshots/Current_Snapshot", args: [4] }),
		[{ type: "snapshotIndex", index: 4 }]);

	// the name is the last arg, args[0] is the index
	assert.deepEqual(a.parseIncoming({ address: "/Snapshots/name", args: [4, 4, "Encore"] }),
		[{ type: "snapshotName", index: 4, name: "Encore" }]);

	assert.deepEqual(a.parseIncoming({ address: "/Snapshots/Rename_Snapshot/4", args: ["Encore 2"] }),
		[{ type: "snapshotName", index: 4, name: "Encore 2" }]);

	assert.deepEqual(a.parseIncoming({ address: "/Console/Session/!", args: [] }),
		[{ type: "sessionReset" }]);

	assert.deepEqual(a.parseIncoming({ address: "/something/unrelated", args: [1] }), []);
});

test("SD buildCommand produces the DiGiCo iPad set addresses (dB level, 0..1 pan pass through)", () => {
	const a = createSdAdapter();

	assert.deepEqual(a.buildCommand({ type: "setSendLevel", channel: 5, aux: 1, db: -12 }),
		{ address: "/Input_Channels/5/Aux_Send/1/send_level", args: [-12] });

	assert.deepEqual(a.buildCommand({ type: "setSendPan", channel: 5, aux: 1, pan: 0.75 }),
		{ address: "/Input_Channels/5/Aux_Send/1/send_pan", args: [0.75] });

	assert.deepEqual(a.buildCommand({ type: "setChannelName", channel: 5, name: "Snare" }),
		{ address: "/Input_Channels/5/Channel_Input/name", args: ["Snare"] });

	assert.deepEqual(a.buildCommand({ type: "setAuxName", aux: 2, name: "IEM 2" }),
		{ address: "/Aux_Outputs/2/Buss_Trim/name", args: ["IEM 2"] });

	assert.equal(a.buildCommand({ type: "unknown" }), null);
});

test("round trip: an SD send_level command parses back to the same neutral value", () => {
	const a = createSdAdapter();
	const cmd = { type: "setSendLevel", channel: 9, aux: 4, db: -3.25 };
	const osc = a.buildCommand(cmd);
	const [event] = a.parseIncoming(osc);
	assert.deepEqual(event, { type: "sendLevel", channel: 9, aux: 4, db: -3.25 });
});

test("serializeEvent is the exact inverse of parseIncoming", () => {
	const a = createSdAdapter();
	const messages = [
		{ address: "/Console/Input_Channels", args: [48] },
		{ address: "/Console/Aux_Outputs/modes", args: [1, 2, 1] },
		{ address: "/Aux_Outputs/2/Buss_Trim/name", args: ["Monitors"] },
		{ address: "/Input_Channels/12/Channel_Input/name", args: ["Kick"] },
		{ address: "/Input_Channels/12/Aux_Send/3/send_level", args: [-6.5] },
		{ address: "/Input_Channels/12/Aux_Send/3/send_pan", args: [0.25] },
		{ address: "/Snapshots/Current_Snapshot", args: [4] },
		{ address: "/Console/Session/!", args: [] }
	];
	for(const msg of messages)
	{
		const [event] = a.parseIncoming(msg);
		assert.deepEqual(a.serializeEvent(event), msg, msg.address);
	}
	assert.equal(a.serializeEvent({ type: "keepAlivePing" }), null);
});

test("factory returns the SD adapter by default and for explicit SD/Quantum", () => {
	assert.equal(createDeskAdapter().type, "SD");
	assert.equal(createDeskAdapter({ type: "SD" }).type, "SD");
	assert.equal(createDeskAdapter({ type: "sd" }).type, "SD");
	assert.equal(createDeskAdapter({ type: "Quantum" }).type, "SD");
	assert.throws(() => createDeskAdapter({ type: "X32" }), /Unknown desk type/);
});
