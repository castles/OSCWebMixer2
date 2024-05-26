"use strict";

const channelsDiv = document.getElementById('channels'),
auxSelect = document.getElementById('aux'),
panCheckbox = document.getElementById("panning"),
auxiliaries = document.getElementById("auxiliaries");

let ws = null,
timeout = null;

let channelInputs = null;
let panInputs = null;

/**
 * Calculate the db value from the provided slider value.
 * @param {float} value - the value to calculate from.
 * - Should be between 0 and 1.
 * - Will return a value between -150 and 10
 */
function sliderToDb(value)
{
	const val = ((Math.log(value * 100) / Math.log(100)) * 100) - 90;
	if(val === -Infinity)
	{
		return -150;
	}
	return val;
}

/**
 * Calculate the value a slider should be from the provided db value.
 * This is the reverse of the formula in sliderToDb
 * @param {float} value - The db to calculate from
 * - between -90 and +10
 */
function dbToSlider(db)
{
	return Math.pow(100, (db + 90) / 100) / 100;
}

/**
 * callback for when a channel volume or pan changes
 * @param ChangeEvent e - the channel volume/pan change event
 */
function sliderChange(e)
{
	let sliderValue = parseFloat(this.value);

	this.parentNode.style.setProperty('--value', (sliderValue * 100) + "%");

	if(!ws)
	{
		return;
	}

	let parameter = "level";

	if(this.classList.contains("volumeInput"))
	{
		sliderValue = sliderToDb(sliderValue);
	}

	if(this.classList.contains("panInput"))
	{
		parameter = "pan";
	}

	sendOSC("/Input_Channels/" + this.dataset.channel + "/Aux_Send/" + auxSelect.options[auxSelect.selectedIndex].dataset.channel + "/send_" + parameter, [sliderValue]);
}

function sendOSC(address, args = [])
{
	ws.send(JSON.stringify({
		"address": address,
		"args": args
	}));
}

/**
 * Request current AUX values from server
 */
function requestValues()
{
	for(let i=1; i<=[...document.getElementsByClassName("volumeInput")].length; i++)
	{
		sendOSC("/Input_Channels/" + i + "/Aux_Send/" + auxSelect.options[auxSelect.selectedIndex].value + "/send_level/?");
		sendOSC("/Input_Channels/" + i + "/Aux_Send/" + auxSelect.options[auxSelect.selectedIndex].value + "/send_pan/?");
	}
}

/**
 * Callback for when socket receives a message
 * @param SocketEvent e - the message socket event
 */
function onMessage(e)
{
	let json = JSON.parse(e.data);

	//console.log(json);

	//Setup AUX and channels
	if(json.config)
	{

		buildAux(json.config.aux);
		buildChannels(json.config.channels);
		auxSelect.dispatchEvent(new Event("change"));
		return;
	}

	//update level
	let sendLevel = json.address.match(/^\/Input_Channels\/([0-9]+)\/Aux_Send\/([0-9]+)\/send_level$/);
	if(sendLevel !== null)
	{

		if(sendLevel[2] == auxSelect.options[auxSelect.selectedIndex].dataset.channel)
		{
			//-90 to +10
			let slider = channelInputs[sendLevel[1] - 1];
			slider.value = dbToSlider(parseFloat(json.args[0]));
			slider.parentNode.style.setProperty('--value', (slider.value * 100) + "%");
		}
	}

	//update pan
	let sendPan = json.address.match(/^\/Input_Channels\/([0-9]+)\/Aux_Send\/([0-9]+)\/send_pan$/);
	if(sendPan !== null)
	{
		//0 to +1
		if(sendPan[2] == auxSelect.options[auxSelect.selectedIndex].dataset.channel)
		{
			let slider = panInputs[sendPan[1] - 1];
			slider.value = json.args[0];
			slider.parentNode.style.setProperty('--value', (slider.value * 100) + "%");
		}
	}

	//update channel names
	let channelNameMatch = json.address.match(/^\/Input_Channels\/([0-9]+)\/Channel_Input\/name$/);
	if(channelNameMatch !== null)
	{
		for(let slider of document.querySelectorAll('input[data-channel="' + channelNameMatch[1] + '"]'))
		{
			slider.previousElementSibling.innerHTML = json.args[0];
		}
	}

	//update Aux names
	let auxNameMatch = json.address.match(/^\/Aux_Outputs\/([0-9]+)\/Buss_Trim\/name$/);
	if(auxNameMatch !== null)
	{
		//update the select
		for(let option of auxSelect.options)
		{
			if(option.value == auxNameMatch[1])
			{
				option.innerHTML = json.args[0];

				//make sure the aux span is correct
				auxSelect.previousElementSibling.innerHTML = auxSelect.getElementsByTagName("option")[auxSelect.selectedIndex].text;
			}
		}

		//update the buttons
		for(let button of auxiliaries.getElementsByTagName("button"))
		{
			if(button.value == auxNameMatch[1])
			{
				button.lastChild.nodeValue = json.args[0];
				return; //no need to update sliders if a button was changed
			}
		}
	}

}

/**
 * Convert Hexadecimal colour to R, G, B
 * @param {string} hex - colour to convert
 * @returns string - converted colour
 */
function formatColour(hex)
{
	var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	return result ? [parseInt(result[1], 16),parseInt(result[2], 16),parseInt(result[3], 16)].join(",") : null;
}

/**
 * Populate AUX Select Box
 * @param array options - An array of AUXs to add to the select box
 */
function buildAux(options)
{
	let selectHTML = "";

	auxiliaries.innerHTML = "";

	for(let option of options)
	{
		if(!option.enabled)
		{
			if(localStorage.getItem("aux") == option.channel)
			{
				localStorage.removeItem("aux");
			}
			continue;
		}

		let iconsrc = option.icon ? option.icon : "";

		let colour = formatColour(option.colour);
		selectHTML += '<option value="' + option.channel + '" data-channel="' + option.channel + '" data-colour="' + colour + '" data-stereo="' + option.stereo + '" data-icon="' + iconsrc + '">' + option.label + '</option>';

		let button = document.createElement("button");
		button.value = option.channel;
		button.style.setProperty('--tint', colour);

		let icon = document.createElement("img");
		icon.src = iconsrc;
		icon.width = 30;
		icon.height = 30;
		button.appendChild(icon);

		let buttonText = document.createTextNode(option.label);
		button.appendChild(buttonText);



		auxiliaries.appendChild(button);
	}
	auxSelect.innerHTML = selectHTML;

	if(localStorage.getItem("aux"))
	{
		auxSelect.value = localStorage.getItem("aux");
	}
	else
	{
		document.body.classList.add("auxPicker");
	}
}

/**
 * open the auxiliaries picker when tapped
 * @param MouseEvent e - the mouse event
 */
function auxMouseDown(e)
{
	e.preventDefault();
	e.stopImmediatePropagation();
	document.body.classList.add("auxPicker");
}
auxSelect.addEventListener("mousedown", auxMouseDown);

/**
 * Select the Aux when a button is tapped
 * @param MouseEvent e - the mouse event
 */
function auxPickerClick(e)
{
	if(e.target.nodeName == "BUTTON")
	{
		auxSelect.value = e.target.value;
		auxSelect.dispatchEvent(new Event("change"));

		document.body.classList.remove("auxPicker");
	}
}
auxiliaries.addEventListener("click", auxPickerClick);

//Detect double tap events for touch devices
let tapedTwice = false;
function tapSlider(e)
{
	if(!tapedTwice)
	{
		tapedTwice = true;
		setTimeout( function() { tapedTwice = false; }, 300 );
		return false;
	}
	resetSlider(e);
}

/**
 * Reset a channel to its default value.
 - Pan sliders will be set to 0.5
 - Volume sliders will be set to 0
 * @param Event e - The Tap or Click Event
 */
function resetSlider(e)
{
	if(e.target.classList.contains("volumeInput"))
	{
		e.target.value = 0;
	}

	if(e.target.classList.contains("panInput"))
	{
		e.target.value = 0.5;
	}

	e.target.dispatchEvent(new Event("input"));
}

/**
 * Build channels html and add to the page
 * @param array channels - the channels to build
 */
function buildChannels(channels)
{
	let html = "";
	for(let channel of channels)
	{
		if(channel.title != "")
		{
			html += '<h2 style="order:' + channel.order + '">' + channel.title + '</h2>';
		}
		html += '<div' + (channel.enabled ? '' : ' class="disabled"') + ' style="order:' + channel.order + '">';
		html += '<label class="volume">';
		if(channel.icon != "")
		{
			html += '<img src="' + channel.icon + '" width="22" height="22" class="icon" />';
		}
		html += '<span>' + channel.label + '</span><input type="range" data-channel="' + channel.channel + '" class="volumeInput" step="0.001" min="0" max="1" value="0" /></label>';
		html += '<label class="pan">';
		if(channel.icon != "")
		{
			html += '<img src="' + channel.icon + '" width="22" height="22" class="icon" />';
		}
		html += '<span>' + channel.label + '</span><input type="range" data-channel="' + channel.channel + '" class="panInput" step="0.001" min="0" max="1" value="0.5" /></label>';
		html += '</div>';
	}

	channelsDiv.innerHTML = html;

	for(let slider of document.querySelectorAll(".volumeInput, .panInput"))
	{
		slider.addEventListener("input", sliderChange);
		slider.addEventListener('touchstart', tapSlider);
		slider.addEventListener('dblclick', resetSlider);
	}

	channelInputs = [...document.getElementsByClassName("volumeInput")];
	panInputs = [...document.getElementsByClassName("panInput")];
}

/**
 * When socket is connected
 */
function onOpen()
{
	document.body.classList.remove("disconnected");
}

/**
 * When a socket connection fails
 */
function noConnection()
{
	// connection closed, discard old websocket and create a new one in 2s
	if(ws)
	{
		ws.close();
	}
	clearTimeout(timeout);
	timeout = setTimeout(startWebsocket, 2000);
	document.body.classList.add("disconnected");
}

/**
 * Start the connection to the server
 */
function startWebsocket()
{
	ws = new WebSocket("ws://" + document.location.host);
	ws.onopen = onOpen;
	ws.onmessage = onMessage;
	ws.onclose = noConnection;
	ws.onerror = noConnection;
}

/**
 * When page has loaded
 */
document.addEventListener("DOMContentLoaded", function()
{
	//ensure the browser doesn't remember checked status
	panCheckbox.checked = false;

	startWebsocket();

	/**
	 * Handle Aux Select Changes
	 */
	auxSelect.addEventListener("change", function(e)
	{
		//save aux value so it can be restored
		localStorage.setItem("aux", this.value);

		//set the current page tint
		let colour = this.getElementsByTagName("option")[this.selectedIndex].dataset.colour;
		document.body.style.setProperty('--tint', colour);

		//set the current aux text
		this.previousElementSibling.innerHTML = this.getElementsByTagName("option")[this.selectedIndex].text;

		this.previousElementSibling.previousElementSibling.src = this.getElementsByTagName("option")[this.selectedIndex].dataset.icon;

		//toggle visibility of the pan checkbox
		if(this.getElementsByTagName("option")[this.selectedIndex].dataset.stereo == "true")
		{
			panCheckbox.parentNode.style.display = "flex";
		}
		else
		{
			panCheckbox.parentNode.style.display = "none";
		}

		//disable panning if it was previously selected
		panCheckbox.checked = false;
		panCheckbox.dispatchEvent(new Event("change"));


		//clear all current values
		for(let channel of channelInputs)
		{
			channel.value = 0;
			channel.parentNode.style.setProperty('--value', (channel.value * 100) + "%");
		}
		for(let channel of panInputs)
		{
			channel.value = 0.5;
			channel.parentNode.style.setProperty('--value', (channel.value * 100) + "%");
		}

		//request all the channel values for the selected aux
		requestValues();
	});

	/**
	 * Handle Panning Checkbox changes
	 */
	panCheckbox.addEventListener("change", function(e)
	{
		if(this.checked)
		{
			document.body.classList.add("panning");
		}
		else
		{
			document.body.classList.remove("panning");
		}
	});
});
