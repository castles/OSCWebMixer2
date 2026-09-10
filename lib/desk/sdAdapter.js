"use strict";

/**
 * DiGiCo SD / Quantum adapter - the "DiGiCo iPad" external-control OSC dialect
 * that OSCWebMixer has always spoken. This adapter is a straight extraction of
 * the addresses and behaviour that used to be inlined in index.js, so SD /
 * Quantum behaviour is unchanged.
 *
 * See deskAdapter.js for the neutral vocabulary and interface.
 */

const q = (address) => ({ address, args: [] });

function createSdAdapter()
{
	return {
		type: "SD",
		loadStyle: "incremental",

		initialEvents()
		{
			return [];
		},

		bulkLoadRequest()
		{
			return null;
		},

		/**
		 * @param {object} request - a LoadRequest
		 * @returns {{address:string,args:any[]}|null}
		 */
		buildQuery(request)
		{
			switch(request.kind)
			{
				case "channelCount":
					// asking for the channel count also makes the desk send a batch
					// of other console info
					return q("/Console/Channels/?");
				case "auxModes":
					return q("/Console/Aux_Outputs/modes/?");
				case "auxName":
					return q(`/Aux_Outputs/${request.aux}/Buss_Trim/name/?`);
				case "channelName":
					return q(`/Input_Channels/${request.channel}/Channel_Input/name/?`);
				case "sendLevel":
					return q(`/Input_Channels/${request.channel}/Aux_Send/${request.aux}/send_level/?`);
				case "sendPan":
					return q(`/Input_Channels/${request.channel}/Aux_Send/${request.aux}/send_pan/?`);
				case "snapshot":
					return q("/Snapshots/Current_Snapshot/?");
				default:
					return null;
			}
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

			if(address === "/Console/Session/!")
			{
				return [{ type: "sessionReset" }];
			}

			if(address === "/Console/Input_Channels")
			{
				return [{ type: "channelCount", count: args[0] }];
			}

			if(address === "/Console/Aux_Outputs/modes")
			{
				return [{ type: "auxModes", modes: args.slice() }];
			}

			if((m = address.match(/^\/Aux_Outputs\/(\d+)\/Buss_Trim\/name$/)))
			{
				return [{ type: "auxName", aux: Number(m[1]), name: args[0] }];
			}

			if((m = address.match(/^\/Input_Channels\/(\d+)\/Channel_Input\/name$/)))
			{
				return [{ type: "channelName", channel: Number(m[1]), name: args[0] }];
			}

			if((m = address.match(/^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_level$/)))
			{
				return [{ type: "sendLevel", channel: Number(m[1]), aux: Number(m[2]), db: args[0] }];
			}

			if((m = address.match(/^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_pan$/)))
			{
				return [{ type: "sendPan", channel: Number(m[1]), aux: Number(m[2]), pan: args[0] }];
			}

			if(address === "/Snapshots/Current_Snapshot")
			{
				return [{ type: "snapshotIndex", index: args[0] }];
			}

			if(address === "/Snapshots/name")
			{
				// args[0] is the index, the name is the last arg
				return [{ type: "snapshotName", index: args[0], name: args[args.length - 1] }];
			}

			if((m = address.match(/^\/Snapshots\/Rename_Snapshot\/(\d+)$/)))
			{
				return [{ type: "snapshotName", index: Number(m[1]), name: args[0] }];
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
					return {
						address: `/Input_Channels/${cmd.channel}/Aux_Send/${cmd.aux}/send_level`,
						args: [cmd.db]
					};
				case "setSendPan":
					return {
						address: `/Input_Channels/${cmd.channel}/Aux_Send/${cmd.aux}/send_pan`,
						args: [cmd.pan]
					};
				case "setChannelName":
					return {
						address: `/Input_Channels/${cmd.channel}/Channel_Input/name`,
						args: [cmd.name]
					};
				case "setAuxName":
					return {
						address: `/Aux_Outputs/${cmd.aux}/Buss_Trim/name`,
						args: [cmd.name]
					};
				case "recallSnapshot":
					return { address: "/Snapshots/Current_Snapshot", args: [cmd.index] };
				default:
					return null;
			}
		},

		autoReply()
		{
			return null;
		}
	};
}

module.exports = { createSdAdapter };
