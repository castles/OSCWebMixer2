"use strict";

const externalDiv = document.getElementById("external"),
ipAddress = document.querySelector("input[name=ip_address]"),
serverPort = document.querySelector("input[name=server_port]"),
oscReceivePort = document.querySelector("input[name=osc_port]"),
deskSendPort = document.querySelector("input[name=desk_send_port]"),
deskIP = document.querySelector("input[name=desk_ip]"),
deskReceivePort = document.querySelector("input[name=desk_port]"),
configForm = document.getElementById("configForm"),
debug = document.querySelector("input[name=debug]"),
auxiliaries = document.getElementById("auxiliaries"),
channels = document.getElementById("channels"),
iconDialog = document.getElementById("iconDialog");

let ws = null,
timeout = null;

/**
 * Callback for delete button for external devices
 * @param {MouseEvent} e
 */
function deleteExternal(e)
{
	e.preventDefault();
	e.target.closest(".external").remove();
}

/**
 * Update the value of a hidden because checkbox fields don't get sent when blank
 */
function updateCheckboxHiddenField(e)
{
	e.target.nextElementSibling.value = e.target.checked;
}

function clearExternals() {
	externalDiv.innerHTML = ""
}

/**
 * Creates an external device and populates the values
 * @param {string} externalName
 * @param {int} externalIP
 * @param {int} externalReceivePort
 */
function createExternal(externalBroadcast = true, externalName = "", externalIP = "", externalLoopback = false, externalReceivePort = "")
{
	if(externalReceivePort == "")
	{
		externalReceivePort = 9000;
	}

	let wrapper = document.createElement("div");
	wrapper.className = "external";

	let details = document.createElement("div");
	details.className = "details";

	let nameLabel = document.createElement("label");
	nameLabel.textContent = "Name";
	let nameField = document.createElement("input");
	nameField.name="externalName[]";
	nameField.required = true;
	nameField.value = externalName;
	nameLabel.appendChild(nameField);
	details.appendChild(nameLabel);

	let ipLabel = document.createElement("label");
	ipLabel.textContent = "IP Address";
	let ipField = document.createElement("input");
	ipField.name="externalIP[]";
	ipField.required = true;
	ipField.value = externalIP;
	ipField.addEventListener("input", ipAddressCheck);
	ipLabel.appendChild(ipField);
	details.appendChild(ipLabel);

	details.appendChild(createCheckboxField("externalBroadcast[]", externalBroadcast, "Receive Broadcast Messages"));

	details.appendChild(createCheckboxField("externalLoopback[]", externalLoopback, "Receive Own Messages", "By default Webmixer doesn't broadcast messages back to the source IP to prevent message loops. This disables the IP check. Be careful when turning this on."));

	let deviceSettingsWrap = document.createElement("div");
	deviceSettingsWrap.className = "settings";

	let deskTitle = document.createElement("h2");
	deskTitle.textContent = "Device Connection Settings";
	deviceSettingsWrap.appendChild(deskTitle);

	let deskLabel = document.createElement("label");
	deskLabel.textContent = "IP Address";
	let deskField = document.createElement("input");
	deskField.disabled = true;
	deskField.value = ipAddress.value;
	deskField.addEventListener("input", ipAddressCheck);
	deskLabel.appendChild(deskField);
	deviceSettingsWrap.appendChild(deskLabel);

	let sendLabel = document.createElement("label");
	sendLabel.textContent = "Send Port";
	let sendField = document.createElement("input");
	sendField.disabled = true;
	sendField.type = "number";
	sendField.value = oscReceivePort.value;
	sendLabel.appendChild(sendField);
	deviceSettingsWrap.appendChild(sendLabel);

	let receiveLabel = document.createElement("label");
	receiveLabel.textContent = "Receive Port";
	let receiveField = document.createElement("input");
	receiveField.name="externalReceive[]";
	receiveField.required = true;
	receiveField.type = "number";
	receiveField.min = 0;
	receiveField.max = 65353;
	receiveField.value = externalReceivePort;
	receiveLabel.appendChild(receiveField);
	deviceSettingsWrap.appendChild(receiveLabel);


	let deleteButton = document.createElement("button");
	deleteButton.innerHTML = "&times;";
	deleteButton.classList = "delete";
	deleteButton.addEventListener("click", deleteExternal);

	wrapper.appendChild(details);
	wrapper.appendChild(deviceSettingsWrap);
	wrapper.appendChild(deleteButton);

	externalDiv.appendChild(wrapper);

	if(externalName == "")
	{
		nameField.focus();
		nameField.scrollIntoView({behavior: "smooth"});
	}
}

//Handle add external device button
document.getElementById("addExternal").addEventListener("click", (e) => {
	e.preventDefault();
	createExternal();
});

/**
 * Validates that the provided string is a valid IPv4 or IPv6 Address
 * @param {string} ip
 * @returns boolean - true if provided value is a IPv4 or IPv6 address
 */
function isIpAddress(ip)
{
	const ipv4Pattern =  /^(\d{1,3}\.){3}\d{1,3}$/;
	const ipv6Pattern =  /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
	return ipv4Pattern.test(ip) || ipv6Pattern.test(ip);
}

/**
 * Handle input events for ip address fields to ensure the validity message is correct.
 * @param {KeyEvent} e
 */
function ipAddressCheck(e)
{
	if(isIpAddress(e.target.value))
	{
		e.target.setCustomValidity("");
	}
	else
	{
		e.target.setCustomValidity("Please enter a valid IP address");
	}
}

deskIP.addEventListener("input", ipAddressCheck);

/**
 * Prevent form submitting when there is custom validity.
 */
configForm.addEventListener("submit", (e) => {

	if(!configForm.checkValidity())
	{
		e.preventDefault();
	}
	loadConfig();
});

/**
 * Create a checkbox field that sends a value if it is checked or not checked.
 * By default checkbox fields don't send a value when unchecked.
 * @param {string} name - the field name
 * @param {boolean} checked - whether or not the field should be checked
 * @param {string} label - the label for the field
 * @param {string} tooltip - optional tooltip for the field
 * @returns
 */
function createCheckboxField(name, checked, label, tooltip = "")
{
	const checkboxField = document.createElement("input");
	const checkboxLabel = document.createElement("label");
	const checkboxText = document.createTextNode(label);
	const checkboxHiddenField = document.createElement("input");

	checkboxHiddenField.type = "hidden";
	checkboxHiddenField.name = name;
	checkboxHiddenField.value = checked;

	checkboxField.type = "checkbox";
	checkboxField.checked = checked;
	checkboxField.addEventListener("change", updateCheckboxHiddenField);

	checkboxLabel.appendChild(checkboxField);
	checkboxLabel.appendChild(checkboxHiddenField);
	checkboxLabel.appendChild(checkboxText);

	if(tooltip != "")
	{
		const tooltipWrap = document.createElement("span");
		tooltipWrap.innerHTML = "i";
		tooltipWrap.className = "tooltip";
		tooltipWrap.title = tooltip;
		checkboxLabel.appendChild(tooltipWrap);
	}


	return checkboxLabel;
}

let iconTarget = null;
function iconClick(e)
{
	e.preventDefault();
	iconTarget = e.target;
	iconDialog.showModal();
}

iconDialog.addEventListener("click", (e) => {
	e.preventDefault();
	if(e.target.src)
	{
		let src = e.target.src;

		//is the src the blank svg?
		if(src.startsWith("data"))
		{
			src = "";
		}
		else
		{
			//remove hostname from the src
			src = e.target.src.substring(window.location.origin.length);
		}
		iconTarget.src = e.target.src;
		iconTarget.nextElementSibling.value = src;
	}
	iconDialog.close();
})

/**
 * Add an icon picker to a dom element
 * @param {DomElement} element - the element to add the picker to
 * @param {string} name - the input name of the hidden field
 * @param {string} icon - the icon src to set to
 */
function addIconPicker(element, name, icon)
{
	let iconImg = document.createElement("img");
	iconImg.src = icon == "" ? "data:image/svg+xml;charset=utf8,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E" : icon;
	iconImg.className = "icon";
	iconImg.width = 44;
	iconImg.height = 44;
	iconImg.addEventListener("click", iconClick);
	element.appendChild(iconImg);

	let iconHidden = document.createElement("input");
	iconHidden.type = "hidden";
	iconHidden.value = icon;
	iconHidden.name = name;
	element.appendChild(iconHidden);
}

/**
 * Create an Auxilary
 * @param {int} number - the aux number
 * @param {boolean} enabled - wether or not the auxilary is enabled
 * @param {string} name - the name of the auxilary
 * @param {string} colour - the colour of the auxilary
 * @param {string} icon - the icon for the auxilary
 */
function createAux(number, enabled, name, colour, icon)
{
	let auxWrap = document.createElement("div");

	let channelNumberLabel = document.createElement("label");
	channelNumberLabel.className = "listNumber";
	channelNumberLabel.innerHTML = String(number).padStart(2, "0");
	auxWrap.appendChild(channelNumberLabel);

	auxWrap.appendChild(createCheckboxField("auxEnabled[]", enabled, ""));

	let auxNameLabel = document.createElement("label");
	let auxName = document.createElement("input");
	auxName.name = "auxName[]";
	auxName.value = name;
	auxNameLabel.appendChild(auxName);
	auxWrap.appendChild(auxNameLabel);

	let auxColourLabel = document.createElement("label");
	let auxColour = document.createElement("input");
	auxColour.name = "auxColour[]";
	auxColour.value = colour;
	auxColour.type = "color";
	auxColourLabel.appendChild(auxColour);
	auxWrap.appendChild(auxColourLabel);

	addIconPicker(auxWrap, "auxIcon[]", icon);

	auxiliaries.appendChild(auxWrap);
}

function moveup(e)
{
	e.preventDefault();

	let currentOrder =  parseInt(getComputedStyle(e.target.parentNode).order);
	if(currentOrder == 1)
	{
		return;
	}

	for(let channel of channels.childNodes)
	{
		let channelOrder =  parseInt(getComputedStyle(channel).order);
		if(channelOrder == currentOrder - 1)
		{
			channel.style.order = channelOrder + 1;
			channel.querySelector('input[name="channelOrder[]"]').value = channelOrder + 1;
			break;
		}
	}

	e.target.parentNode.style.order = currentOrder - 1;
	e.target.parentNode.querySelector('input[name="channelOrder[]"]').value = currentOrder - 1;

	ensureValidOrder(channels.childNodes, "channelOrder[]");
}

function movedown(e)
{
	e.preventDefault();

	let currentOrder =  parseInt(getComputedStyle(e.target.parentNode).order);
	if(currentOrder == channels.childNodes.length)
	{
		return;
	}

	for(let channel of channels.childNodes)
	{
		let channelOrder =  parseInt(getComputedStyle(channel).order);
		if(channelOrder == currentOrder + 1)
		{
			channel.style.order = channelOrder - 1;
			channel.querySelector('input[name="channelOrder[]"]').value = channelOrder - 1;
			break;
		}
	}

	e.target.parentNode.style.order = currentOrder + 1;

	e.target.parentNode.querySelector('input[name="channelOrder[]"]').value = currentOrder + 1;

	ensureValidOrder(channels.childNodes, "channelOrder[]");
}

/**
 * Create a Channel
 * @param {int} number - the channel number
 * @param {boolean} enabled - whether or not the channel is enabled
 * @param {string} name - the name of the channel
 * @param {integer} order - the position of the channel
 * @param {string} icon - the icon for the channel
 * @param {string} title - the section title
 */
function createChannel(number, enabled, name, order, icon="", title="")
{
	let channelWrap = document.createElement("div");
	channelWrap.style.order = order;

	let channelNumberLabel = document.createElement("label");
	channelNumberLabel.className = "listNumber";
	channelNumberLabel.innerHTML = String(number).padStart(2, "0");
	channelWrap.appendChild(channelNumberLabel);

	let sectionTitleLabel = document.createElement("label");

	let sectionTitle = document.createElement("input");
	sectionTitle.name = "sectionTitle[]";
	sectionTitle.placeholder = "Section Title";
	sectionTitle.value = title;
	sectionTitleLabel.appendChild(sectionTitle);
	channelWrap.appendChild(sectionTitleLabel);

	//channelWrap.draggable = true;
	//channelWrap.droppable = true;

	channelWrap.appendChild(createCheckboxField("channelEnabled[]", enabled, ""));

	let channelNameLabel = document.createElement("label");
	let channelName = document.createElement("input");
	channelName.name = "channelName[]";
	channelName.value = name;
	channelNameLabel.appendChild(channelName);
	channelWrap.appendChild(channelNameLabel);

	addIconPicker(channelWrap, "channelIcon[]", icon);

	let moveUp = document.createElement("button");
	moveUp.className = "up";
	moveUp.addEventListener("click", moveup);
	channelWrap.appendChild(moveUp);

	let moveDown = document.createElement("button");
	moveDown.className = "down";
	moveDown.addEventListener("click", movedown);
	channelWrap.appendChild(moveDown);

	let orderInput = document.createElement("input");
	orderInput.type = "hidden";
	orderInput.name = "channelOrder[]";
	orderInput.value = order;
	channelWrap.appendChild(orderInput);

	channels.appendChild(channelWrap);

	//makeDraggable(channelWrap);
}

let dropTarget = undefined;
let dragged = undefined;
function makeDraggable(target)
{
	target.addEventListener("dragstart", e => {
		dragged = e.target;
		dragged.classList.add("dragging");
		e.dataTransfer.setData("text/plain", "data");
	});

	target.addEventListener("dragover", e => {
		e.preventDefault();
		dropTarget = e.target.closest("[draggable]");
		dropTarget.classList.add("dragTarget");
	});

	target.addEventListener("dragleave", e => {
		e.preventDefault();
		dropTarget.classList.remove("dragTarget");
	});

	target.addEventListener("drop", e => {
		e.preventDefault();
		dropTarget.classList.remove("dragTarget");

		dropTarget.before(dragged);

		dragged.classList.remove("dragging");

		dragged = undefined;
		dropTarget = undefined;
	});
}

//load current config and populate fields
function loadConfig()
{
	fetch("/config")
		.then((response) => response.json())
		.then((json) => {

			let deskPort = 9000;
			if(json.desk.port != "")
			{
				deskPort = json.desk.port;
			}

			ipAddress.value = json.server.ip;
			serverPort.value = json.server.port;
			oscReceivePort.value = json.osc.port;
			deskSendPort.value = json.osc.port;
			deskIP.value = json.desk.ip == "" ? json.server.ip.replace(/\.\d+$/, "") + "." : json.desk.ip;
			deskReceivePort.value = deskPort;
			debug.checked = json.debug == true;
	
			clearExternals();
			for(let external of json.external)
			{
				createExternal(external.broadcast, external.name, external.ip, external.loopback, external.port);
			}
		});
}
loadConfig();

function fetchAux()
{
	fetch("/aux")
		.then((response) => response.json())
		.then((json) => {

			if(json.length == 0)
			{
				auxiliaries.innerHTML = '<p class="notice">No Auxiliaries Loaded</p>';
				setTimeout(fetchAux, 5000); //try again later
				return;
			}

			auxiliaries.innerHTML = "";

			for(let [index, aux] of json.entries())
			{
				createAux(index + 1, aux.enabled, aux.name, aux.colour, aux.icon);
			}
		});
}
fetchAux();

function fetchChannels()
{
	fetch("/channels")
		.then((response) => response.json())
		.then((json) => {

			if(json.length == 0)
			{
				channels.innerHTML = '<p class="notice">No Channels Loaded</p>';
				setTimeout(fetchChannels, 5000); //try again later
				return;
			}

			channels.innerHTML = "";

			for(let [index, channel] of json.entries())
			{
				createChannel(index + 1, channel.enabled, channel.name, channel.order, channel.icon, channel.title);
			}

			ensureValidOrder(channels.childNodes, "channelOrder[]");
		});
}
fetchChannels();

/**
 * Make sure the order of node elements are valid.
 * This is only necessary if the order gets out of wack. It should only get messed up if the channel list grows or shrinks.
 * @param {DOMElement} nodes - the dom nodes to check
 * @param {string} hiddenName - the name for hidden field that stores the order value
 */
function ensureValidOrder(nodes, hiddenName)
{
	//create an array of dom elements and the current order value
	let toSort = [];
	for(let node of nodes)
	{
		toSort.push({
			elm: node,
			order: parseInt(getComputedStyle(node).order)
		})
	}

	//sort the array by the order
	toSort.sort((a, b) => a.order > b.order ? 1 : -1);

	//loop through each element and update the order with a valid value
	for(let [index, node] of toSort.entries())
	{
		node.elm.style.order = index + 1;
		node.elm.querySelector('input[name="' + hiddenName + '"]').value = index + 1;
	}
}

function navClick(e)
{
	hideSections();
	document.getElementById(e.target.hash.substr(1) + "-content").classList.add("show");
	e.target.classList.add("selected");
	e.preventDefault();
}

function hideSections()
{
	for(let tab of document.querySelectorAll("nav .selected"))
	{
		tab.classList.remove("selected");
	}
	for(let section of document.querySelectorAll("section.show"))
	{
		section.classList.remove("show");
	}
}

let navTabs = document.querySelectorAll("nav a");
for(let tab of navTabs)
{
	tab.addEventListener("click", navClick);
}

//load a specific tab if a hash exists
if(document.location.hash != "")
{
	document.querySelector('nav a[href="' + document.location.hash + '"]').dispatchEvent(new Event("click"));
}



/**
 * Callback for when socket receives a message
 * @param SocketEvent e - the message socket event
 */
function onMessage(e)
{
	let json = JSON.parse(e.data);

	//console.log(json);

	if(!json.address)
	{
		return;
	}

	//update channel names
	let channelNameMatch = json.address.match(/^\/Input_Channels\/([0-9]+)\/Channel_Input\/name$/);
	if(channelNameMatch !== null)
	{
		const row = channels.childNodes[channelNameMatch[1]-1];
		if(!row)
		{
			return;
		}
		const input = row.querySelector('input[name="channelName[]"]')
		if(!input)
		{
			return;
		}
		input.value = json.args[0];
	}

	//update Aux names
	let auxNameMatch = json.address.match(/^\/Aux_Outputs\/([0-9]+)\/Buss_Trim\/name$/);
	if(auxNameMatch !== null)
	{
		const row = auxiliaries.childNodes[auxNameMatch[1]-1];
		if(!row)
		{
			return;
		}
		const input = row.querySelector('input[name="auxName[]"]')
		if(!input)
		{
			return;
		}
		input.value = json.args[0];
	}
}

const WEBSOCKET_TIMEOUT = 2000;

/**
 * When socket is connected
 */
function onOpen()
{
	clearTimeout(timeout);

	document.body.classList.remove("disconnected");

	fetchAux();
	fetchChannels();
}

/**
 * When a socket connection fails
 */
function noConnection()
{
	document.body.classList.add("disconnected");

	clearTimeout(timeout);
	timeout = setTimeout(startWebsocket, WEBSOCKET_TIMEOUT);
}

/**
 * Start the connection to the server
 */
function startWebsocket()
{
	if(ws)
	{
		ws.close();
	}
	ws = new WebSocket("ws://" + document.location.host);
	ws.onopen = onOpen;
	ws.onmessage = onMessage;
	ws.onclose = noConnection;
	ws.onerror = noConnection;

	//retry connection in 2 seconds
	clearTimeout(timeout);
	timeout = setTimeout(startWebsocket, WEBSOCKET_TIMEOUT);
}


startWebsocket();


