/**
 * This is a plugin to redirect Key change OSC messages sent from ableton to trigger a streamdeck button.
 */
class AbletonStreamDeck
{
	handleOSC(message, webmixer)
	{
		//if the message is not an Ableton key change message
		if(false === /\/Note1/.test(message.address))
		{
			return message;
		}

		const mapping = [
			"/location/2/0/0/press", //C
			"/location/2/0/1/press", //C#
			"/location/2/0/2/press", //Db
			"/location/2/1/0/press", //D
			"/location/2/1/1/press", //D#
			"/location/3/0/0/press", //Eb
			"/location/3/0/1/press", //E
			"/location/3/0/2/press", //F
			"/location/3/1/0/press", //F#
			"/location/3/1/1/press", //Gb
			"/location/4/0/0/press", //G
			"/location/4/0/1/press", //G#
			"/location/4/0/2/press", //Ab
			"/location/4/1/0/press", //A
			"/location/4/1/1/press", //A#
			"/location/5/0/0/press", //Bb
			"/location/5/0/1/press", //B
		]

		webmixer.send(
			"StreamDeck",
			{
				"address": mapping[message.args[0]]
			}
		);

		return false;
	}
}
module.exports = AbletonStreamDeck;
