const ADDED_TO_GROUP = 1;

/**
 * This is a plugin that boosts the volume and centres the panning of a vocal in specified auxillary packs when the vocal is added to a lead group.
 * It also reverts the changes when the vocal is removed from the lead group.
 */
class leadvol
{
	//how much to increase or deacrease the volume
	SHIFT = 5;

	//store previous values here
	savedValues = [];

	AUXS_TO_ADJUST = [
		//1, //DRUMS
		2, //BASS
		3, //Stage Management
		4, //GTR
		5 //KEYS
	];

	/**
	 * Mapping of FOH Channels => IEM Channels
	 */
	CHANNEL_MAPPING = {
		26: 41, //L1
		27: 42, //L2
		28: 43, //BV1
		29: 44, //BV2
		30: 45 //BV3
	};


	handleOSC(message, webmixer)
	{
		//update the saved value whenever it changes
		if(/^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_pan$/.test(message.address))
		{
			this.savedValues[message.address] = message;
			return;
		}

		//look for lead group changes
		const matches = /\/Input_Channels\/(\d+)\/Group_Send\/4\/group/.exec(message.address);
		if(matches == null)
		{
			return;
		}

		const fohChannel = matches[1],
		iemChannel = this.CHANNEL_MAPPING[fohChannel];

		//only process the channels we care about
		if(undefined == iemChannel)
		{
			return;
		}

		//When added to Lead Group
		if(message.args[0] == ADDED_TO_GROUP)
		{
			this.AUXS_TO_ADJUST.forEach(aux => {

				//save the current pan. We use this to restore the panning value when the vocal is removed from the lead group.
				const panKey = this.panAddress(iemChannel, aux);
				this.savedValues[panKey] = webmixer.cache.get(panKey);

				//Turn Up
				this.changeLevel(webmixer, iemChannel, aux, this.SHIFT);

				//Pan to center
				this.changePanning(webmixer, iemChannel, aux, 0.5);
			});
			return;
		}

		//When removed from Lead Group
		this.AUXS_TO_ADJUST.forEach(aux => {

			//Turn Down
			this.changeLevel(webmixer, iemChannel, aux, -this.SHIFT);

			//reset Panning
			this.resetPanning(webmixer, iemChannel, aux);
		});
	}

	isLeadGroupAddress(address, fohChannel)
	{
		return address == "/Input_Channels/" + fohChannel + "/Group_Send/4/group"
	}

	changeLevel(webmixer, channel, aux, amount)
	{
		const key = "/Input_Channels/" + channel + "/Aux_Send/" + aux + "/send_level";
		if(webmixer.cache.has(key))
		{
			webmixer.broadcast({
				address: key,
				args: [
					webmixer.cache.get(key).args[0] + amount
				]
			});
		}
	}

	resetPanning(webmixer, channel, aux)
	{
		const key = this.panAddress(channel, aux),
		savedValue = this.savedValues[key];
		if(savedValue !== undefined)
		{
			const msg = {
				address: key,
				args: [
					savedValue.args[0]
				]
			};

			//reset the panning for all connections
			webmixer.broadcast(msg);

			//set the cache to the broadcasted value
			webmixer.cache.set(key, msg);
		}
	}

	changePanning(webmixer, channel, aux, pan)
	{
		const msg = {
			address: this.panAddress(channel, aux),
			args: [
				pan
			]
		};

		//notify all connections to update the panning
		webmixer.broadcast(msg);

		//set the cache to the new value
		webmixer.cache.set(msg.address, msg);
	}

	panAddress(channel, aux)
	{
		return "/Input_Channels/" + channel + "/Aux_Send/" + aux + "/send_pan";
	}
}

module.exports = leadvol;
