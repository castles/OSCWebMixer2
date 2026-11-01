(() => {
"use strict";

const settingsRoot = document.getElementById("deskSettings");
if (!settingsRoot) return;
let initialized = false;
let settingsDirty = false;
let savingSettings = false;
const settingsMessage = document.getElementById("deskSettingsMessage");
const saveButton = document.getElementById("saveDeskSettings");
const externalDiv = document.getElementById("externalDevices"),
ipAddress = settingsRoot.querySelector("input[name=ip_address]"),
serverPort = settingsRoot.querySelector("input[name=server_port]"),
oscReceivePort = settingsRoot.querySelector("input[name=osc_port]"),
deskSendPort = settingsRoot.querySelector("input[name=desk_send_port]"),
deskIP = settingsRoot.querySelector("input[name=desk_ip]"),
deskReceivePort = settingsRoot.querySelector("input[name=desk_port]"),
configForm = document.getElementById("configForm"),
debug = settingsRoot.querySelector("input[name=debug]"),
auxiliaries = document.getElementById("auxiliaries"),
channels = document.getElementById("channels"),
iconDialog = document.getElementById("iconDialog");
const deskTabs = TabSelector.mount(settingsRoot.querySelector("[data-tabs]"));

let ws = null,
timeout = null;
let deskSignInRequired = false;
let channelSorter = null;
const channelGrid = window.matchMedia("(min-width: 700px)");

function settingsFormData() {
  const data = new FormData(configForm);
  // The server's parallel arrays are indexed by desk channel number, not display order.
  const rows = Array.from(channels.querySelectorAll(".desk-channel")).sort((a, b) => Number(a.dataset.channel) - Number(b.dataset.channel));
  for (const name of ["channelEnabled[]", "channelName[]", "channelOrder[]", "channelIcon[]", "sectionTitle[]"]) {
    data.delete(name);
    for (const row of rows) data.append(name, row.querySelector('[name="' + name + '"]').value);
  }
  return data;
}

async function deskFetch(url, options = {}) {
    const response = await fetch(url, { ...options, cache: "no-store" });
    if (response.status === 401 || (response.redirected && new URL(response.url, document.location.href).pathname === "/admin-login.html")) {
        deskSignInRequired = true;
        clearTimeout(timeout);
        settingsRoot.classList.add("disconnected");
        if (ws) ws.close();
        window.location.replace("/admin-login.html#desk-settings");
        const error = new Error("Enter the admin password to continue.");
        error.signInRequired = true;
        throw error;
    }
    if (!response.ok) {
        const data = await response.clone().json().catch(() => null);
        throw new Error(data?.error || data?.message || "The settings request failed. Please try again.");
    }
    return response;
}

function reportSettingsError(error) {
    if (error.signInRequired || deskSignInRequired) return;
    let message = document.getElementById("settingsRequestMessage");
    if (!message) {
        message = document.createElement("p");
        message.id = "settingsRequestMessage";
        message.className = "notice";
        message.setAttribute("role", "alert");
        configForm.prepend(message);
    }
    message.textContent = error.message || "Could not reach the server. Please try again.";
    settingsMessage.textContent = "Settings could not be saved or loaded.";
    console.error("Desk settings request failed:", error);
}

function clearSettingsError() {
    document.getElementById("settingsRequestMessage")?.remove();
}

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
 * Submit the config form via fetch instead of a real page navigation, so the
 * currently selected dashboard tab stays open after saving.
 * @returns {Promise<boolean>} true if the settings were saved, false if the
 * form was invalid or the page is redirecting to a new port.
 */
async function submitConfigForm() {
  clearSettingsError();
  if (savingSettings) return false;
  if (!configForm.checkValidity()) {
    const panel = configForm.querySelector(':invalid')?.closest('[role="tabpanel"]');
    if (panel) selectSettingsTab(panel.id.replace(/-content$/, ''));
    configForm.reportValidity(); return false;
  }
  savingSettings = true;
  saveButton.disabled = true;
  settingsMessage.textContent = 'Saving settings…';
  try {
    const response = await deskFetch(configForm.action, {
      method: 'POST', body: new URLSearchParams(settingsFormData())
    });
    const text = await response.text();
    const redirect = text.match(/document\.location\.href="([^"]+)"/);
    if (redirect) { document.location.href = redirect[1]; return false; }
    settingsDirty = false;
    settingsMessage.textContent = 'Settings saved';
    document.dispatchEvent(new Event('desk-settings-saved'));
    return true;
  } finally { savingSettings = false; saveButton.disabled = false; }
}

function markSettingsDirty() { settingsDirty = true; settingsMessage.textContent = 'Unsaved changes'; }
for (const event of ['input', 'change']) configForm.addEventListener(event, e => { if (e.target.name) markSettingsDirty(); });
configForm.addEventListener('click', e => {
  if (e.target.closest('.toggle-selection, .invert-selection, .delete, #addExternal')) markSettingsDirty();
});
iconDialog.addEventListener('click', e => { if (e.target.classList.contains('iconDialogImage')) markSettingsDirty(); });
configForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try { await submitConfigForm(); } catch (error) { reportSettingsError(error); }
});

/**
 * Create a checkbox field that sends a value if it is checked or not checked.
 * By default checkbox fields don't send a value when unchecked.
 * @param {string} name - the field name
 * @param {boolean} checked - whether or not the field should be checked
 * @param {string} label - the label for the field
 * @param {string} tooltip - optional tooltip for the field
 * @param {string} labelClass - optional class for the label
 * @returns {DomElement} - the checkbox field element
 */
function createCheckboxField(name, checked, label, tooltip = "", labelClass = "")
{
	const checkboxField = document.createElement("input");
	const checkboxLabel = document.createElement("label");

	if (labelClass != "")
	{
		checkboxLabel.className = labelClass;
	}

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

	auxWrap.appendChild(createCheckboxField("auxEnabled[]", enabled, "", "", "enabled"));

	let auxNameLabel = document.createElement("label");
	let auxName = document.createElement("input");
	auxName.name = "auxName[]";
    auxName.setAttribute("aria-label", "AUX " + number + " name");
	auxName.value = name;
	auxNameLabel.appendChild(auxName);
	auxWrap.appendChild(auxNameLabel);

	let auxColourLabel = document.createElement("label");
	let auxColour = document.createElement("input");
	auxColour.name = "auxColour[]";
    auxColour.setAttribute("aria-label", "AUX " + number + " colour");
	auxColour.value = colour;
	auxColour.type = "color";
	auxColourLabel.appendChild(auxColour);
	auxWrap.appendChild(auxColourLabel);

	addIconPicker(auxWrap, "auxIcon[]", icon);

	auxWrap.querySelector('input[type="checkbox"]').setAttribute("aria-label", "Enable AUX " + number);
    auxiliaries.appendChild(auxWrap);
}

function saveChannelOrder() {
  for (const [index, row] of Array.from(channels.children).entries()) {
    row.querySelector('input[name="channelOrder[]"]').value = index + 1;
  }
}

function moveChannelWithKeys(event) {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const row = event.currentTarget.closest(".desk-channel");
  const rows = Array.from(channels.children);
  const columns = channelGrid.matches ? 2 : 1;
  const delta = event.key === "ArrowUp" ? -columns : event.key === "ArrowDown" ? columns : event.key === "ArrowLeft" ? -1 : 1;
  const index = rows.indexOf(row);
  const target = index + delta;
  if (target < 0 || target >= rows.length) return;
  channels.insertBefore(row, delta > 0 ? rows[target].nextSibling : rows[target]);
  event.currentTarget.focus();
  row.scrollIntoView({ block: "nearest" });
  saveChannelOrder();
  markSettingsDirty();
}

function updateChannelDragging() {
  if (channelSorter) channelSorter.option("handle", channelGrid.matches ? null : ".desk-channel-handle");
  document.getElementById("channelOrderHint").textContent = channelGrid.matches
    ? "Drag cards to reorder. Arrow keys on a handle also move channels."
    : "Drag a handle to reorder. Arrow keys on a handle also move channels.";
}
channelGrid.addEventListener("change", updateChannelDragging);

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
	channelWrap.className = "desk-channel";
	channelWrap.dataset.channel = String(number);

	const dragHandle = document.createElement("button");
	dragHandle.type = "button";
	dragHandle.className = "desk-channel-handle";
	dragHandle.innerHTML = appIcon("gripVertical");
	dragHandle.setAttribute("aria-label", "Move channel " + number);
	dragHandle.setAttribute("aria-describedby", "channelOrderHint");
	dragHandle.addEventListener("keydown", moveChannelWithKeys);
	channelWrap.appendChild(dragHandle);

	let channelNumberLabel = document.createElement("label");
	channelNumberLabel.className = "listNumber";
	channelNumberLabel.innerHTML = String(number).padStart(2, "0");
	channelWrap.appendChild(channelNumberLabel);

	let sectionTitleLabel = document.createElement("label");
	sectionTitleLabel.className = "desk-channel-section";

	let sectionTitle = document.createElement("input");
	sectionTitle.name = "sectionTitle[]";
    sectionTitle.setAttribute("aria-label", "Channel " + number + " section title");
	sectionTitle.placeholder = "Section Title";
	sectionTitle.value = title;
	sectionTitleLabel.appendChild(sectionTitle);
	channelWrap.appendChild(sectionTitleLabel);

	channelWrap.appendChild(createCheckboxField("channelEnabled[]", enabled, "", "", "enabled"));

	let channelNameLabel = document.createElement("label");
	channelNameLabel.className = "desk-channel-name";
	let channelName = document.createElement("input");
	channelName.name = "channelName[]";
    channelName.setAttribute("aria-label", "Channel " + number + " name");
	channelName.value = name;
	channelNameLabel.appendChild(channelName);
	channelWrap.appendChild(channelNameLabel);

	addIconPicker(channelWrap, "channelIcon[]", icon);

	let orderInput = document.createElement("input");
	orderInput.type = "hidden";
	orderInput.name = "channelOrder[]";
	orderInput.value = order;
	channelWrap.appendChild(orderInput);

	channelWrap.querySelector('input[type="checkbox"]').setAttribute("aria-label", "Enable channel " + number);
    channels.appendChild(channelWrap);
}

/**
 * Find the enable checkboxes for the list a selection button belongs to. Each
 * pair of buttons sits in a .button-row inside the same <section> as the list
 * it controls.
 * @param {DomElement} button - the clicked selection button
 * @returns {NodeListOf<HTMLInputElement>}
 */
function selectionCheckboxes(button)
{
	return button.closest("section").querySelectorAll('label.enabled > input[type="checkbox"]');
}

/**
 * Toggle a list's enable checkboxes: if every box is already checked, uncheck
 * them all, otherwise check them all.
 * @param {MouseEvent} e
 */
function toggleSelection(e)
{
	e.preventDefault();

	let checkboxes = selectionCheckboxes(this);
	let allChecked = [...checkboxes].every((checkbox) => checkbox.checked);

	for(let checkbox of checkboxes)
	{
		checkbox.checked = !allChecked;
		checkbox.dispatchEvent(new Event("change"));
	}
}

/**
 * Flip every enable checkbox in a list.
 * @param {MouseEvent} e
 */
function invertSelection(e)
{
	e.preventDefault();

	for(let checkbox of selectionCheckboxes(this))
	{
		checkbox.checked = !checkbox.checked;
		checkbox.dispatchEvent(new Event("change"));
	}
}

for(let button of settingsRoot.querySelectorAll(".toggle-selection"))
{
	button.addEventListener("click", toggleSelection);
}
for(let button of settingsRoot.querySelectorAll(".invert-selection"))
{
	button.addEventListener("click", invertSelection);
}

//load current config and populate fields
function loadConfig()
{
	deskFetch("/config")
		.then((response) => response.json())
		.then((json) => {
            if (settingsDirty) return;

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
			for(let external of json.externalDevices)
			{
				createExternal(external.broadcast, external.name, external.ip, external.loopback, external.port);
			}
		}).catch(reportSettingsError);
}

function fetchAux()
{
	deskFetch("/aux")
		.then((response) => response.json())
		.then((json) => {
            if (settingsDirty) return;

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
		}).catch(reportSettingsError);
}

function fetchChannels()
{
	deskFetch("/channels")
		.then((response) => response.json())
		.then((json) => {
            if (settingsDirty) return;

			if(json.length == 0)
			{
				channels.innerHTML = '<p class="notice">No Channels Loaded</p>';
				setTimeout(fetchChannels, 5000); //try again later
				return;
			}

			if (channelSorter) channelSorter.destroy();
			channels.innerHTML = "";

			for(let [index, channel] of json.entries())
			{
				createChannel(index + 1, channel.enabled, channel.name, channel.order, channel.icon, channel.title);
			}

			const rows = Array.from(channels.children).sort((a, b) =>
                Number(a.querySelector('input[name="channelOrder[]"]').value) - Number(b.querySelector('input[name="channelOrder[]"]').value));
            for (const row of rows) channels.appendChild(row);
            saveChannelOrder();
            channelSorter = new Sortable(channels, {
                draggable: "> .desk-channel",
                handle: channelGrid.matches ? null : ".desk-channel-handle",
                filter: "input, label, .icon", preventOnFilter: false,
                direction: () => channelGrid.matches ? "horizontal" : "vertical",
                swapThreshold: 0.65, invertSwap: true,
                animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180,
                ghostClass: "desk-channel-placeholder", chosenClass: "desk-channel-chosen", dragClass: "desk-channel-dragging",
                forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4,
                forceAutoScrollFallback: true, scrollSensitivity: 70, scrollSpeed: 12,
                onChoose: () => document.body.classList.add("reordering-desk-channels"),
                onUnchoose: () => document.body.classList.remove("reordering-desk-channels"),
                onClone: event => event.clone.classList.add("desk-settings"),
                onEnd: event => { if (event.oldIndex !== event.newIndex) { saveChannelOrder(); markSettingsDirty(); } },
            });
            updateChannelDragging();
		}).catch(reportSettingsError);
}

function selectSettingsTab(tab) {
  deskTabs.select(tab);
}

/**
 * Callback for when socket receives a message
 * @param SocketEvent e - the message socket event
 */
function onMessage(e)
{
    if (settingsDirty) return;
	let json;
	try
	{
		json = JSON.parse(e.data);
	}
	catch(err)
	{
		return;
	}

	//console.log(json);

	if(!json.address)
	{
		return;
	}

	//update channel names
	let channelNameMatch = json.address.match(/^\/Input_Channels\/([0-9]+)\/Channel_Input\/name$/);
	if(channelNameMatch !== null)
	{
		const row = channels.querySelector('[data-channel="' + channelNameMatch[1] + '"]');
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

	settingsRoot.classList.remove("disconnected");

	/*
	Sockets close and open again when the config is saved. We want to make sure we have the latest when the socket is opened.
	TODO: This isn't the most elegant solution and it might be better to save & reload the config using the websocket.
	*/
	if (!settingsDirty && !savingSettings) { loadConfig(); fetchAux(); fetchChannels(); }
	
}

/**
 * When a socket connection fails
 */
function noConnection()
{
	if (deskSignInRequired) return;
	settingsRoot.classList.add("disconnected");

	clearTimeout(timeout);
	timeout = setTimeout(startWebsocket, WEBSOCKET_TIMEOUT);
}

/**
 * Start the connection to the server
 */
function startWebsocket()
{
	if (deskSignInRequired) return;
	if(ws)
	{
		ws.close();
	}
	ws = new WebSocket((document.location.protocol === "https:" ? "wss://" : "ws://") + document.location.host + "/?role=observer");
	ws.onopen = onOpen;
	ws.onmessage = onMessage;
	ws.onclose = noConnection;
	ws.onerror = noConnection;

	//retry connection in 2 seconds
	clearTimeout(timeout);
	timeout = setTimeout(startWebsocket, WEBSOCKET_TIMEOUT);
}



function renderPresetList(presets) {
    const listContainer = document.getElementById("preset-list");
    listContainer.replaceChildren();
    if (!Array.isArray(presets)) throw new Error("Could not read the preset list.");
    if (!presets.length) {
        const empty = document.createElement("p");
        empty.className = "notice";
        empty.textContent = "No presets found";
        listContainer.appendChild(empty);
        return;
    }
    for (const preset of presets) {
        const item = document.createElement("div");
        item.className = "preset-item";
        item.dataset.id = String(preset.uuid ?? "");
        const info = document.createElement("div");
        info.className = "preset-info";
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = String(preset.name ?? "Unnamed preset");
        const date = document.createElement("span");
        date.className = "date";
        const timestamp = new Date(preset.lastChanged);
        date.textContent = Number.isFinite(timestamp.getTime())
            ? timestamp.toLocaleDateString() + ", " + timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "Unknown date";
        info.append(name, date);
        const actions = document.createElement("div");
        actions.className = "preset-actions";
        for (const [className, label, handler] of [["btn-load", "Load", loadPreset], ["btn-delete", "Delete", deletePreset]]) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = className;
            button.textContent = label;
            button.addEventListener("click", handler);
            actions.appendChild(button);
        }
        item.append(info, actions);
        listContainer.appendChild(item);
    }
}

function refreshPresetList() {
    return deskFetch("/api/presets")
        .then(response => response.json())
        .then(renderPresetList)
        .catch(reportSettingsError);
}

document.getElementById("refresh-presets").addEventListener("click", async (e) => {
	e.preventDefault()
	refreshPresetList();
});


async function savePreset() {
	const nameInput = document.getElementById("new-preset-name");
	const name = nameInput.value.trim()

	if (!name) {
		alert("Please enter a name for the preset.");
		return;
	}

	try {
		// persist the current settings first so the preset captures the latest
		// edits, not just whatever was last saved
		if (!(await submitConfigForm())) {
			return;
		}

		const response = await deskFetch('/api/presets/save-current-state', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name })
		});

		const data = await response.json();

		if (!response.ok) {
			throw new Error(data.message || "Something went wrong");
		}

		// Success Path
		nameInput.value = '';
		refreshPresetList();
		console.log("Success:", data.message);

	} catch (err) {
		// Catches the 'throw' above OR network/parsing failures
		reportSettingsError(err);
	}
}

document.getElementById("save-preset").addEventListener("click", async (e) => {
	e.preventDefault();
	await savePreset();
})

async function loadPreset(event) {
	event.preventDefault()

	const presetItem = event.target.closest('.preset-item');
	const uuid = presetItem.getAttribute('data-id');
	const presetName = presetItem.querySelector('.name').textContent;

	if (confirm(`Load preset "${presetName}"?`)) {
        try {
		const response = await deskFetch(`/api/presets/${encodeURIComponent(uuid)}/load`, { method: 'POST' });
		if (!response.ok) {
			const data = await response.json();
			alert(data.message);
			return;
		}

		settingsDirty = false;
		settingsMessage.textContent = "Desk preset loaded";
		document.dispatchEvent(new Event("desk-settings-saved"));
		fetchAux();
		fetchChannels();
        } catch (error) { reportSettingsError(error); }
	}
}

async function deletePreset(event) {
	event.preventDefault()

	const presetItem = event.target.closest('.preset-item');
	const uuid = presetItem.getAttribute('data-id');
	const presetName = presetItem.querySelector('.name').textContent;

	if (confirm(`Delete preset "${presetName}"?`)) {
        try {
		const response = await deskFetch(`/api/presets/${encodeURIComponent(uuid)}`, { method: 'DELETE' });
		if (!response.ok) {
			const data = await response.json();
			alert(data.message);
			return;
		}

		refreshPresetList();
        } catch (error) { reportSettingsError(error); }
	}
}


function initializeSettings() {
  if (initialized) return;
  initialized = true;
  loadConfig(); fetchAux(); fetchChannels(); refreshPresetList(); startWebsocket();
}
document.addEventListener('admin-page-changed', event => {
  if (event.detail.page === 'desk-settings') initializeSettings();
});
if (settingsRoot.closest('.page').classList.contains('active')) initializeSettings();
})();

