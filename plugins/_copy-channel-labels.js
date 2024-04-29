/**
 * This is a plugin that copys channel labels
 */
class copyChannelLabels
{
	handleOSC(message, webmixer)
	{
		const nameChangeMatch = message.address.match(/^\/Input_Channels\/([0-9]+)\/Channel_Input\/name$/);

		if(nameChangeMatch == undefined)
		{
			return;
		}

		/**
		 * Mapping of Channel From => Channel To
		 */
		const FOH_CHANNELS = {
			26: 1, //L1
			//27: 1000, //L2
			//28: 1000, //L3
			//29: 1000, //L4
		};

		//create osc message to send to everything
		const osc = {
			address: "/Input_Channels/" + FOH_CHANNELS[nameChangeMatch[1]] + "/Channel_Input/name",
			args: [
				message.args[0]
			]
		};

		webmixer.broadcast(osc);

		//update cache with new message
		webmixer.cache[osc.address] = osc;
	}
}

module.exports = copyChannelLabels
