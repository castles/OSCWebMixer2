/**
 * This is a plugin to redirect Key change OSC messages sent from ableton to trigger a streamdeck button.
 */
class AbletonStreamDeck
{
	handleOSC(message, webmixer)
	{
		//if the message is not an Ableton key change message
		if(false === /\/Ableton\/KeyChange/.test(message.address))
		{
			return message;
		}

		//determine the key to set
		//trigger the correct key
		//determine major or minor?


		webmixer.send(
			"StreamDeck",
			{
				"address": "/location/2/1/0/press"
			}
		);

		return false;
	}
}
module.exports = AbletonStreamDeck;
