/**
 * This is a plugin that boosts the volume and centres the panning of a vocal in specified auxillary packs when the vocal is added to a lead group.
 * It also reverts the changes when the vocal is removed from the lead group.
 */
class leadvol
{
	//how much to increase or deacrease the volume
	SHIFT = 3;

	//store previous values here
	savedValues = [];

	handleOSC(message, webmixer)
	{
		const AUXS_TO_ADJUST = [
			1, //DRUMS
			2, //BASS
			4, //GTR
			5 //KEYS
		];

		/**
		 * Mapping of FOH Channels => IEM Channels
		 */
		const FOH_CHANNELS = {
			26: 41, //L1
			27: 42, //L2
			28: 43, //BV1
			29: 44, //BV2
			30: 45 //BV3
		};

		//Loop over all vocal channels
		for(const [fohChannel, iemChannel] of Object.entries(FOH_CHANNELS))
		{
			//When added to Lead Group
			if(message.address == "/Input_Channels/" + fohChannel + "/Group_Send/4/group" && message.args[0] == 1)
			{
				AUXS_TO_ADJUST.forEach(aux => {

					//save the current pan. We use this to restore the panning value when the vocal is removed from the lead group.
					this.savedValues["/Input_Channels/" + iemChannel + "/Aux_Send/" + aux + "/send_pan"] = webmixer.cache["/Input_Channels/" + iemChannel + "/Aux_Send/" + aux + "/send_pan"];

					//Turn Up
					this.changeLevel(webmixer, iemChannel, aux, this.SHIFT);

					//Pan to center
					this.changePanning(webmixer, iemChannel, aux, 0.5);
				})
			}

			//When removed from Lead Group
			if(message.address == "/Input_Channels/" + fohChannel + "/Group_Send/4/group" && message.args[0] == 0)
			{
				AUXS_TO_ADJUST.forEach(aux => {

					//Turn Down
					this.changeLevel(webmixer, iemChannel, aux, -this.SHIFT);

					//reset Panning
					this.resetPanning(webmixer, iemChannel, aux);
				});
			}
		};

	}

	changeLevel(webmixer, channel, aux, amount)
	{
		webmixer.broadcast({
			address: "/Input_Channels/" + channel + "/Aux_Send/" + aux + "/send_level",
			args: [
				webmixer.cache["/Input_Channels/" + channel + "/Aux_Send/" + aux + "/send_level"].args[0] + amount
			]
		});
	}

	resetPanning(webmixer, channel, aux)
	{
		if(this.savedValues["/Input_Channels/" + channel + "/Aux_Send/" + aux + "/send_pan"].args[0] !== null)
		{
			webmixer.broadcast({
				address: "/Input_Channels/" + channel + "/Aux_Send/" + aux + "/send_pan",
				args: [
					this.savedValues["/Input_Channels/" + channel + "/Aux_Send/" + aux + "/send_pan"].args[0]
				]
			});
		}
	}

	changePanning(webmixer, channel, aux, pan)
	{
		webmixer.broadcast({
			address: "/Input_Channels/" + channel + "/Aux_Send/" + aux + "/send_pan",
			args: [
				pan
			]
		});
	}
}

module.exports = leadvol;
