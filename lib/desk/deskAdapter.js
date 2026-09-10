"use strict";

/**
 * Desk adapter layer.
 *
 * OSCWebMixer talks to a mixing console over OSC, but the OSC dialect depends on
 * the console:
 *
 *   - SD / Quantum ("DiGiCo iPad" external control): addresses like
 *     `/Input_Channels/{ch}/Aux_Send/{aux}/send_level`, individual values can be
 *     queried by appending `/?`, send levels are dB, send pan is 0..1.
 *
 *   - S-Series (S21 / S31): addresses like `/channel/{ch}/send/{send}/level`,
 *     no per-value query (you send `/console/resend` and the desk dumps
 *     everything), send levels are dB, send pan is -1..1, an aux is itself a
 *     channel (carries its name) plus a separate "send" bus number for routing,
 *     and there is no "aux modes" message so stereo/mono comes from config.
 *     The desk sends `/console/ping` and expects `/console/pong` back.
 *
 * An adapter converts between those dialects and a small neutral vocabulary so
 * the rest of the server never has to care which console is connected.
 *
 * ---------------------------------------------------------------------------
 * Neutral vocabulary
 * ---------------------------------------------------------------------------
 *
 * `DeskEvent` - something the desk told us (from `parseIncoming`):
 *
 *   { type: "channelCount",  count }
 *   { type: "channelName",   channel, name }
 *   { type: "auxName",       aux, name }          // aux is 1-based
 *   { type: "auxModes",      modes }              // [1|2, ...]  1 = mono, 2 = stereo
 *   { type: "sendLevel",     channel, aux, db }
 *   { type: "sendPan",       channel, aux, pan }  // 0..1  (0 = left, 0.5 = centre)
 *   { type: "snapshotIndex", index }
 *   { type: "snapshotName",  index, name }
 *   { type: "sessionReset" }                      // reload everything
 *   { type: "keepAlivePing" }                     // desk wants proof we're alive
 *
 * `DeskCommand` - something a client wants to push to the desk (to `buildCommand`):
 *
 *   { type: "setSendLevel",  channel, aux, db }
 *   { type: "setSendPan",    channel, aux, pan } // 0..1
 *   { type: "setChannelName",channel, name }
 *   { type: "setAuxName",    aux, name }
 *   { type: "recallSnapshot",index }
 *
 * `LoadRequest` - something the loader needs from the desk (to `buildQuery`):
 *
 *   { kind: "channelCount" }
 *   { kind: "auxModes" }
 *   { kind: "auxName",     aux }
 *   { kind: "channelName", channel }
 *   { kind: "sendLevel",   channel, aux }
 *   { kind: "sendPan",     channel, aux }
 *   { kind: "snapshot" }
 *
 * ---------------------------------------------------------------------------
 * Adapter interface
 * ---------------------------------------------------------------------------
 *
 *   adapter.type                       "SD" | "S"
 *   adapter.loadStyle                  "incremental" | "bulk"
 *   adapter.initialEvents()            DeskEvent[]  - facts known from config,
 *                                      not the desk (S: synthetic auxModes)
 *   adapter.bulkLoadRequest()          OscMessage | null  (S: /console/resend)
 *   adapter.buildQuery(LoadRequest)    OscMessage | null  (SD only)
 *   adapter.parseIncoming(OscMessage)  DeskEvent[]
 *   adapter.buildCommand(DeskCommand)  OscMessage | null
 *   adapter.autoReply(DeskEvent)       OscMessage | null  (S: pong for ping)
 *
 * OscMessage is osc.js's `{ address: string, args: any[] }`.
 */

const { createSdAdapter } = require("./sdAdapter.js");
const { createSAdapter } = require("./sAdapter.js");

/**
 * Build the desk adapter for the configured console type.
 *
 * @param {Object} [deskConfig] - the `desk` section of the global config.
 * @param {string} [deskConfig.type] - "SD" (default) or "S".
 * @param {Array<{channel:number,send:number,stereo:boolean}>} [deskConfig.auxes]
 *        - S-Series only: the aux -> channel/send/stereo mapping, in aux order.
 * @returns {object} a desk adapter
 */
function createDeskAdapter(deskConfig = {})
{
	const type = String(deskConfig.type || "SD").toUpperCase();

	if(type === "S" || type === "S-SERIES" || type === "SSERIES")
	{
		return createSAdapter({ auxes: deskConfig.auxes || [] });
	}

	if(type === "SD" || type === "QUANTUM")
	{
		return createSdAdapter();
	}

	throw new Error(`Unknown desk type "${deskConfig.type}". Use "SD" or "S".`);
}

/**
 * Turn a neutral DeskEvent describing a value into the DeskCommand that would set
 * that same value. Used when a change observed from one client needs to be
 * pushed to the desk. Dialect-independent.
 *
 * @param {object} event - a DeskEvent
 * @returns {object|null} a DeskCommand, or null if the event is not a settable value
 */
function eventToCommand(event)
{
	switch(event.type)
	{
		case "sendLevel":
			return { type: "setSendLevel", channel: event.channel, aux: event.aux, db: event.db };
		case "sendPan":
			return { type: "setSendPan", channel: event.channel, aux: event.aux, pan: event.pan };
		case "channelName":
			return { type: "setChannelName", channel: event.channel, name: event.name };
		case "auxName":
			return { type: "setAuxName", aux: event.aux, name: event.name };
		case "snapshotIndex":
			return { type: "recallSnapshot", index: event.index };
		default:
			return null;
	}
}

module.exports = { createDeskAdapter, createSdAdapter, createSAdapter, eventToCommand };
