/**
 * This is a plugin that updates StreamDeck button labels when certain channel labels change on the desk
 */
class streamdecklabels
{
	handleOSC(message, webmixer)
	{
		const STREAMDECK_IP = "192.168.1.131";
		const nameChangeMatch = message.address.match(/^\/Input_Channels\/([0-9]+)\/Channel_Input\/name$/);

		if(nameChangeMatch == undefined)
		{
			return;
		}

		/**
		 * Mapping of FOH Channels => StreamDeck button position
		 */
		const FOH_CHANNELS = {
			26: "1/0/0", //L1
			27: "1/0/1", //L2
			28: "1/0/2", //L3
			29: "1/1/0", //L4
		};

		webmixer.broadcast(
			{
				address: "/location/" + FOH_CHANNELS[nameChangeMatch[1]] + "/style/text",
				args: [
					message.args[0] + " Autotune"
				]
			},
			{
				target: STREAMDECK_IP
			}
		);

		webmixer.send
	}
}

module.exports = streamdecklabels;
