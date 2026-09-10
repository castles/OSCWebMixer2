"use strict";

/**
 * The UDP/OSC link to the mixing console.
 *
 * It owns the osc.js UDPPort and a desk adapter (see deskAdapter.js), and turns
 * the console's dialect into the SD-shaped messages the rest of the server uses
 * as its internal representation:
 *
 *   - inbound:  raw desk OSC  --parseIncoming-->  DeskEvent  --serializeEvent-->
 *               SD-shaped {address,args}  -->  onInbound()
 *   - outbound: SD-shaped {address,args}  --parseIncoming/eventToCommand-->
 *               DeskCommand  --buildCommand-->  raw desk OSC
 *
 * For an SD / Quantum desk both translations are the identity, and anything the
 * adapter does not specifically model is passed through untouched, so SD
 * behaviour is exactly as before. Only S-Series traffic is actually rewritten.
 */

const osc = require("osc");
const { createDeskAdapter, eventToCommand } = require("./deskAdapter.js");
const { createSdAdapter } = require("./sdAdapter.js");

// the internal representation is always the SD dialect; this instance is only
// used for its serializeEvent() / parseIncoming() shape helpers
const sdShape = createSdAdapter();

/**
 * @param {Object} opts
 * @param {Object} opts.desk           the `desk` section of the global config
 *                                     ({ ip, port, type?, auxes? })
 * @param {number} opts.listenPort     local UDP port to receive OSC on
 * @param {Object} opts.log            a logger (info/warn/error/debug)
 * @param {(message:string)=>void} opts.onFatal   unrecoverable bind error
 * @param {(oscMsg:object, sourceIp:string)=>void} opts.onInbound  a translated
 *        inbound message, in SD shape
 * @param {()=>void} opts.onReady      the UDP socket is open
 */
function createDeskConnection({ desk, listenPort, log, onFatal, onInbound, onReady })
{
	const adapter = createDeskAdapter(desk);
	let udpPort = null;

	function sendRaw(oscMsg)
	{
		if(oscMsg && udpPort)
		{
			udpPort.send(oscMsg, desk.ip, desk.port);
		}
	}

	function handleRawInbound(rawMsg, sourceIp)
	{
		const events = adapter.parseIncoming(rawMsg);
		let handled = false;

		for(const event of events)
		{
			const reply = adapter.autoReply(event);
			if(reply)
			{
				sendRaw(reply);
			}

			if(event.type === "keepAlivePing")
			{
				handled = true;
				continue;
			}

			const internal = sdShape.serializeEvent(event);
			if(internal)
			{
				onInbound(internal, sourceIp);
				handled = true;
			}
		}

		// SD / Quantum is transparent: forward anything not specifically modelled
		// (plugins and external devices may care about it). An S-Series sends a
		// lot webmixer does not model, so for S unrecognised messages are dropped.
		if(!handled && adapter.type === "SD")
		{
			onInbound(rawMsg, sourceIp);
		}
	}

	return {
		type: adapter.type,
		loadStyle: adapter.loadStyle,

		// problems with the desk config the caller should surface (S-Series aux routing)
		configWarnings: adapter.configWarnings || [],

		/** synthetic facts to seed the load with, already in SD shape */
		initialEvents()
		{
			return adapter.initialEvents()
				.map((e) => sdShape.serializeEvent(e))
				.filter(Boolean);
		},

		/** the one request that makes a bulk-load desk dump everything (S), else null */
		bulkLoadRequest()
		{
			return adapter.bulkLoadRequest();
		},

		/** build the OSC query for a LoadRequest (incremental desks only) */
		query(request)
		{
			return adapter.buildQuery(request);
		},

		/** send a raw OSC message straight to the desk (no translation) */
		sendRaw,

		/** send a raw OSC message to an arbitrary host (external devices) */
		sendTo(ip, port, oscMsg)
		{
			if(oscMsg && udpPort)
			{
				udpPort.send(oscMsg, ip, port);
			}
		},

		/**
		 * Translate an internal (SD-shaped) message into the desk's dialect and
		 * send it. For SD this is a straight pass-through; a `/?` query is passed
		 * through as-is (SD answers those, S ignores them).
		 */
		sendToDesk(internalMsg)
		{
			if(adapter.type === "SD" || internalMsg.address.slice(-2) === "/?")
			{
				sendRaw(internalMsg);
				return;
			}
			const [event] = sdShape.parseIncoming(internalMsg);
			const command = event && eventToCommand(event);
			const deskMsg = command && adapter.buildCommand(command);
			if(deskMsg)
			{
				sendRaw(deskMsg);
			}
		},

		start()
		{
			udpPort = new osc.UDPPort({ localAddress: "0.0.0.0", localPort: listenPort });

			udpPort.on("error", function(err)
			{
				if(err.code === "EHOSTDOWN" || err.code === "EHOSTUNREACH")
				{
					log.error(err.address + " is not responding");
					return;
				}
				if(err.code === "EADDRINUSE" || err.code === "EACCES")
				{
					onFatal(`OSC port ${listenPort} is ${err.code === "EACCES" ? "not permitted" : "already in use"}. ` +
						`Close whatever is using it or change the OSC Receive Port in the admin area.`);
					return;
				}
				log.error("UDP error: " + (err && err.stack ? err.stack : err));
			});

			udpPort.on("message", function(rawMsg, timeTag, info)
			{
				log.debug("Message received over UDP: " + JSON.stringify(rawMsg));
				handleRawInbound(rawMsg, info.address);
			});

			udpPort.on("ready", onReady);
			udpPort.open();
		},

		stop()
		{
			if(udpPort)
			{
				udpPort.close();
				udpPort = null;
			}
		}
	};
}

module.exports = { createDeskConnection };
