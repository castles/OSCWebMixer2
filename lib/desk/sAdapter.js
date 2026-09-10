"use strict";

/**
 * Check an S-Series aux routing list. The send-bus number and the master channel
 * number must each be unique - two auxes on the same send bus are
 * indistinguishable in an incoming message, so moving one would appear to move
 * the other.
 *
 * @param {Array<{channel:number,send:number}>} auxes
 * @returns {string[]} human-readable problems (empty if the list is fine)
 */
function validateSAuxRouting(auxes)
{
	const problems = [];
	const seenSend = new Map();
	const seenChannel = new Map();

	(auxes || []).forEach((aux, i) =>
	{
		const label = i + 1;

		const send = Number(aux.send);
		if(!Number.isFinite(send) || send <= 0)
		{
			problems.push(`Aux ${label} has no send bus number.`);
		}
		else if(seenSend.has(send))
		{
			problems.push(`Aux ${label} and aux ${seenSend.get(send)} both use send bus ${send}.`);
		}
		else
		{
			seenSend.set(send, label);
		}

		const channel = Number(aux.channel);
		if(!Number.isFinite(channel) || channel <= 0)
		{
			problems.push(`Aux ${label} has no channel number.`);
		}
		else if(seenChannel.has(channel))
		{
			problems.push(`Aux ${label} and aux ${seenChannel.get(channel)} both use channel ${channel}.`);
		}
		else
		{
			seenChannel.set(channel, label);
		}
	});

	return problems;
}

/**
 * DiGiCo S-Series (S21 / S31) adapter.
 *
 * Modelled on the S21 OSC command list and message dumps in
 * https://github.com/castles/OSCWebMixer2/issues/4 and the v1 S-mapping
 * (https://github.com/castles/OSCWebMixer/blob/main/mapping/S-mapping.mjs).
 * Anything not confirmed against a real console is marked UNVERIFIED.
 *
 * Key differences from SD (see deskAdapter.js for the full picture):
 *
 *   - address scheme is `/channel/{ch}/...` and `/console/...`
 *   - no per-value query: send `/console/resend`, the desk dumps everything
 *   - an aux is a channel (carries its name) plus a separate "send" bus number
 *     used for routing. That mapping, and whether the aux is stereo, must come
 *     from config.
 *   - send pan is -1..1 (SD / neutral is 0..1)
 *   - the desk sends `/console/ping`; reply with `/console/pong`
 *
 * @param {Object} opts
 * @param {Array<{channel:number,send:number,stereo:boolean}>} opts.auxes
 *        the aux -> channel/send/stereo mapping, in aux order (aux 1 is auxes[0]).
 */
function createSAdapter({ auxes = [] } = {})
{
	// aux index (1-based, the number the rest of webmixer uses) <-> S numbers
	const sendToAux = new Map();   // S "send" bus number -> aux index (1-based)
	const channelToAux = new Map(); // S channel number    -> aux index (1-based)
	auxes.forEach((aux, i) => {
		sendToAux.set(Number(aux.send), i + 1);
		channelToAux.set(Number(aux.channel), i + 1);
	});

	const auxByIndex = (auxIndex) => auxes[auxIndex - 1];

	// neutral pan (0..1, 0.5 centre) <-> S pan (-1..1, 0 centre)
	const sPanToNeutral = (p) => (p + 1) / 2;
	const neutralPanToS = (p) => (p * 2) - 1;

	return {
		type: "S",
		loadStyle: "bulk",

		// problems with the aux routing (duplicate send bus / channel, missing
		// numbers). The rest of the app surfaces these to the user.
		configWarnings: validateSAuxRouting(auxes),

		initialEvents()
		{
			// the S-Series never reports aux modes; derive them from config
			if(auxes.length === 0)
			{
				return [];
			}
			return [{ type: "auxModes", modes: auxes.map((a) => (a.stereo ? 2 : 1)) }];
		},

		bulkLoadRequest()
		{
			return { address: "/console/resend", args: [] };
		},

		buildQuery()
		{
			// S-Series has no per-value query; everything comes from bulkLoadRequest()
			return null;
		},

		/**
		 * @param {{address:string,args:any[]}} osc
		 * @returns {object[]} zero or more DeskEvents
		 */
		parseIncoming(osc)
		{
			const address = osc.address;
			const args = osc.args || [];
			let m;

			if(address === "/console/ping")
			{
				return [{ type: "keepAlivePing" }];
			}

			if(address === "/console/channel/counts")
			{
				return [{ type: "channelCount", count: args[0] }];
			}

			// a channel name - could be an input channel or an aux (which is a channel)
			if((m = address.match(/^\/channel\/(\d+)\/name$/)))
			{
				const ch = Number(m[1]);
				const auxIndex = channelToAux.get(ch);
				if(auxIndex !== undefined)
				{
					return [{ type: "auxName", aux: auxIndex, name: args[0] }];
				}
				return [{ type: "channelName", channel: ch, name: args[0] }];
			}

			// an aux send level / pan
			if((m = address.match(/^\/channel\/(\d+)\/send\/(\d+)\/level$/)))
			{
				const auxIndex = sendToAux.get(Number(m[2]));
				if(auxIndex === undefined)
				{
					return []; // a send we don't have an aux for - ignore
				}
				return [{ type: "sendLevel", channel: Number(m[1]), aux: auxIndex, db: args[0] }];
			}

			if((m = address.match(/^\/channel\/(\d+)\/send\/(\d+)\/pan$/)))
			{
				const auxIndex = sendToAux.get(Number(m[2]));
				if(auxIndex === undefined)
				{
					return [];
				}
				return [{ type: "sendPan", channel: Number(m[1]), aux: auxIndex, pan: sPanToNeutral(args[0]) }];
			}

			// `/channel/{ch}/send/{send}/enabled` is sent but webmixer does not model
			// per-send routing on/off yet, so it is ignored on purpose.

			// UNVERIFIED: how the current snapshot is reported. The S21 command list
			// only documents `/digico/snapshots/fire` (int) as a "both" message.
			if(address === "/digico/snapshots/fire")
			{
				return [{ type: "snapshotIndex", index: args[0] }];
			}

			return [];
		},

		/**
		 * @param {object} cmd - a DeskCommand
		 * @returns {{address:string,args:any[]}|null}
		 */
		buildCommand(cmd)
		{
			switch(cmd.type)
			{
				case "setSendLevel":
				{
					const aux = auxByIndex(cmd.aux);
					if(!aux) return null;
					return { address: `/channel/${cmd.channel}/send/${aux.send}/level`, args: [cmd.db] };
				}
				case "setSendPan":
				{
					const aux = auxByIndex(cmd.aux);
					if(!aux) return null;
					return { address: `/channel/${cmd.channel}/send/${aux.send}/pan`, args: [neutralPanToS(cmd.pan)] };
				}
				case "setChannelName":
					return { address: `/channel/${cmd.channel}/name`, args: [cmd.name] };
				case "setAuxName":
				{
					const aux = auxByIndex(cmd.aux);
					if(!aux) return null;
					return { address: `/channel/${aux.channel}/name`, args: [cmd.name] };
				}
				case "recallSnapshot":
					return { address: "/digico/snapshots/fire", args: [cmd.index] };
				default:
					return null;
			}
		},

		/**
		 * @param {object} event - a DeskEvent
		 * @returns {{address:string,args:any[]}|null}
		 */
		autoReply(event)
		{
			if(event && event.type === "keepAlivePing")
			{
				return { address: "/console/pong", args: [] };
			}
			return null;
		}
	};
}

module.exports = { createSAdapter, validateSAuxRouting };
