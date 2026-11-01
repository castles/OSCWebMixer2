"use strict";

const loadingEl = document.getElementById("loading");
const contentEl = document.getElementById("content");
const errorEl = document.getElementById("error");
const connectionsEl = document.getElementById("connections");
const authStatusEl = document.getElementById("authStatus");
const auxCountEl = document.getElementById("auxCount");
const channelCountEl = document.getElementById("channelCount");
const mixerUrlEl = document.getElementById("mixerUrl");
const copyUrlBtn = document.getElementById("copyUrl");
const qrCodeEl = document.getElementById("qrCode");
const customMixerUrlEl = document.getElementById("customMixerUrl");
const saveMixerUrlEl = document.getElementById("saveMixerUrl");
const mixerUrlMessageEl = document.getElementById("mixerUrlMessage");
const auxTableEl = document.getElementById("auxTable");
const channelTableEl = document.getElementById("channelTable");
const clientsListEl = document.getElementById("clientsList");
const noClientsEl = document.getElementById("noClients");
const auxMenuEl = document.getElementById("auxMenu");
const liveMixPanelEl = document.getElementById("liveMixPanel");
const liveMixFoldEl = document.getElementById("liveMixFold");
const liveMixSummaryEl = document.getElementById("liveMixSummary");
const liveMixHintEl = document.getElementById("liveMixHint");
const liveMixTitleEl = document.getElementById("liveMixTitle");
const liveMixChannelsEl = document.getElementById("liveMixChannels");
const panToggleEl = document.getElementById("panToggle");
const panToggleLabelEl = document.getElementById("panToggleLabel");
const sidebarNavEl = document.getElementById("sidebarNav");
const sidebarToggleEl = document.getElementById("sidebarToggle");
const sidebarCollapseEl = document.getElementById("sidebarCollapse");
let sidebarCollapsed = false;
try { sidebarCollapsed = localStorage.getItem("adminSidebarCollapsed") === "true"; } catch { /* Navigation still works without storage. */ }

function setSidebarCollapsed(collapsed) {
  sidebarCollapsed = collapsed;
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  sidebarCollapseEl.setAttribute("aria-expanded", String(!collapsed));
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  sidebarCollapseEl.setAttribute("aria-label", label);
  sidebarCollapseEl.setAttribute("title", label);
}
setSidebarCollapsed(sidebarCollapsed);
sidebarCollapseEl.addEventListener("click", () => {
  document.body.classList.add("sidebar-animated");
  setSidebarCollapsed(!sidebarCollapsed);
  try { localStorage.setItem("adminSidebarCollapsed", String(sidebarCollapsed)); } catch { /* The toggle works without persistence. */ }
});
const pageTitleEl = document.getElementById("pageTitle");
const pageEls = document.querySelectorAll(".page");
const navItemEls = document.querySelectorAll(".nav-item");

const pageTitles = {
  overview: "Overview",
  "live-mix": "Live mix",
  clients: "Clients",
  templates: "Templates",
  config: "Config",
  "desk-settings": "Desk settings",
};

const logIcons = { aux: appIcon("headphones"), level: appIcon("volume2"), pan: appIcon("moveHorizontal") };

const foldableOpen = new Map();
const liveChannelElements = new Map();
const statusLiveUpdates = new Map();

let statusLoading = false;
let deskReady = false;
let liveMixSocket = null;
let liveMixReconnectTimer = null;
let liveMixConnectTimer = null;
let currentUrl = "";
let mixerUrlDirty = false;
let mixerUrlSaving = false;
let mixerUrlRevision = 0;
let auxOptions = [];
let mixLevels = {};
let selectedAux = sessionStorage.getItem("adminSelectedAux");
let showPan = sessionStorage.getItem("adminShowPan") === "true";
let currentPage =
  window.location.hash.replace("#", "") ||
  sessionStorage.getItem("adminPage") ||
  "overview";

function showPage(page) {
  if (!pageTitles[page]) {
    page = "overview";
  }

  if (page === "clients") {
    for (const key of foldableOpen.keys()) {
      if (key.startsWith("adminClientFold-")) {
        foldableOpen.delete(key);
      }
    }
    clientsListEl.querySelectorAll(".client-fold").forEach((el) => {
      el.open = false;
    });
  }

  currentPage = page;
  sessionStorage.setItem("adminPage", page);
  window.location.hash = page;

  pageTitleEl.textContent = pageTitles[page];

  pageEls.forEach((el) => {
    el.classList.toggle("active", el.dataset.page === page);
  });

  navItemEls.forEach((el) => {
    el.classList.toggle("active", el.dataset.page === page);
  });

  closeAdminNavigation();
  syncLiveMixStream();
  document.dispatchEvent(new CustomEvent("admin-page-changed", { detail: { page } }));
  if (page === "live-mix") void loadStatus();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function safeColour(value) {
  const components = String(value ?? "").split(",").map(part => Number(part.trim()));
  return components.length === 3 && components.every(component => Number.isFinite(component) && component >= 0 && component <= 255)
    ? components.map(Math.round).join(", ") : "100, 116, 139";
}

function levelPercentage(value) {
  return Number.isFinite(value) ? Math.round(Math.max(0, Math.min(1, value)) * 100) : 0;
}

function formatTime(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatLevel(level) {
  if (!Number.isFinite(level)) {
    return "—";
  }
  return `${levelPercentage(level)}%`;
}

function formatPan(pan) {
  if (!Number.isFinite(pan)) {
    return "";
  }
  if (pan === 0) {
    return "C";
  }
  return pan < 0 ? `L ${Math.abs(Math.round(pan * 100))}` : `R ${Math.round(pan * 100)}`;
}

function formatClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString();
}

function restoreFoldable(el, storageKey) {
  el.open = foldableOpen.get(storageKey) ?? false;
}

const boundFoldables = new WeakSet();

function bindFoldable(el, storageKey) {
  restoreFoldable(el, storageKey);

  if (boundFoldables.has(el)) {
    return;
  }

  boundFoldables.add(el);
  el.addEventListener("toggle", () => {
    foldableOpen.set(storageKey, el.open);
  });
}

function coalesceClientLog(log) {
  if (!log?.length) {
    return [];
  }

  const coalesced = [];

  for (const entry of log) {
    const previous = coalesced[coalesced.length - 1];
    const sameGroup =
      previous &&
      previous.type === entry.type &&
      previous.aux === entry.aux &&
      (entry.type === "aux" || previous.channel === entry.channel);

    if (sameGroup) {
      previous.at = entry.at;
      previous.toValue = entry.value;
      previous.count += 1;
      continue;
    }

    coalesced.push({
      ...entry,
      fromValue:
        entry.previousValue != null ? entry.previousValue : entry.value,
      toValue: entry.value,
      count: 1,
    });
  }

  return coalesced.reverse();
}

function formatLogValue(type, value) {
  if (type === "level") {
    return formatLevel(value);
  }
  if (type === "pan") {
    return formatPan(value) || "C";
  }
  return escapeHtml(value);
}

function formatLogEntryText(entry) {
  const auxName = escapeHtml(entry.auxLabel || `AUX ${entry.aux}`);
  const channelName = escapeHtml(entry.channelLabel || `Ch ${entry.channel}`);

  if (entry.type === "aux") {
    return `<strong>${auxName}</strong>`;
  }

  const fromValue = entry.fromValue;
  const toValue = entry.toValue ?? entry.value;
  const hasRange =
    fromValue != null && Math.abs(fromValue - toValue) > 0.005;

  const changed = hasRange
    ? `${formatLogValue(entry.type, fromValue)} → ${formatLogValue(entry.type, toValue)}`
    : formatLogValue(entry.type, toValue);

  const suffix =
    entry.count > 1 && !hasRange
      ? `<span class="log-count">${entry.count} changes</span>`
      : "";

  if (entry.type === "level") {
    return `<strong>${channelName}</strong> · ${changed} · ${auxName}${suffix}`;
  }

  return `<strong>${channelName}</strong> · ${changed} · ${auxName}${suffix}`;
}

function renderClientLog(log) {
  const entries = coalesceClientLog(log);

  if (!entries.length) {
    return '<p class="muted">No changes yet.</p>';
  }

  return `<ol class="client-log">
    ${entries
      .map(
        (entry) => `<li class="log-entry log-entry-${["aux", "level", "pan"].includes(entry.type) ? entry.type : "unknown"}">
          <span class="log-icon-wrap">${logIcons[entry.type] || ""}</span>
          <time>${escapeHtml(formatClock(entry.at))}</time>
          <span class="log-text">${formatLogEntryText(entry)}</span>
        </li>`,
      )
      .join("")}
  </ol>`;
}

function renderClientLevels(levels) {
  if (!levels || levels.length === 0) {
    return '<p class="muted">No AUX selected yet.</p>';
  }

  const activeLevels = levels.filter((entry) => entry.level != null);
  if (activeLevels.length === 0) {
    return '<p class="muted">Waiting for desk values…</p>';
  }

  return `<table class="client-levels">
    <thead>
      <tr>
        <th>Channel</th>
        <th>Label</th>
        <th>Level</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${activeLevels
        .map((entry) => {
          const panText = formatPan(entry.pan);
          return `<tr>
            <td>${escapeHtml(entry.channel)}</td>
            <td>${escapeHtml(entry.label || "—")}</td>
            <td>${formatLevel(entry.level)}${panText ? ` · ${panText}` : ""}</td>
            <td class="level-cell">
              <div class="level-bar">
                <div class="level-bar-fill" style="width: ${levelPercentage(entry.level)}%"></div>
              </div>
            </td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>`;
}

function escapeClientName(value) {
  return escapeHtml(value);
}
function renderClientCard(client) {
  const auxName =
    client.auxLabel ||
    (client.aux != null ? `AUX ${client.aux}` : "No AUX selected");
  const auxColour = client.auxColour
    ? `style="--client-tint: ${safeColour(client.auxColour)}"`
    : "";
  const statusText = `Active ${formatTime(client.lastActivity)}`;

  return `<article class="client-card" data-client-id="${escapeHtml(client.id)}" ${auxColour}>
    <div class="client-header">
      <div>
        <strong>${escapeClientName(client.username || `Client ${client.id}`)}</strong>
        <span class="muted">${client.username ? `Client ${escapeHtml(client.id)} · ` : ""}${escapeHtml(client.address || "Unknown address")}</span>
      </div>
      <div class="client-meta">
        <span class="client-aux">${escapeHtml(auxName)}</span>
        <span class="muted">${statusText}</span>
      </div>
    </div>
    <details class="foldable client-fold" data-section="mix">
      <summary>Current mix</summary>
      <div class="foldable-body">
        ${renderClientLevels(client.levels)}
      </div>
    </details>
    <details class="foldable client-fold" data-section="log">
      <summary>Changelog (${coalesceClientLog(client.log || []).length})</summary>
      <div class="foldable-body">
        ${renderClientLog(client.log)}
      </div>
    </details>
  </article>`;
}

function bindClientFoldables(container) {
  container.querySelectorAll(".client-fold").forEach((el) => {
    const clientId = el.closest(".client-card")?.dataset.clientId;
    const section = el.dataset.section;
    bindFoldable(el, `adminClientFold-${clientId}-${section}`);
  });
}

function renderClients(connected) {
  noClientsEl.hidden = connected.length > 0;
  clientsListEl.innerHTML = connected.map((client) => renderClientCard(client)).join("");
  bindClientFoldables(clientsListEl);

}

function getAuxLabel(aux) {
  return aux.label || `AUX ${aux.channel}`;
}

function renderAuxMenu() {
  const signature = JSON.stringify(auxOptions.map(aux => [aux.channel, getAuxLabel(aux)]));
  if (auxMenuEl.dataset.options !== signature) {
    auxMenuEl.replaceChildren();
    for (const aux of auxOptions) {
      const option = document.createElement("option");
      option.value = String(aux.channel); option.textContent = getAuxLabel(aux);
      auxMenuEl.appendChild(option);
    }
    auxMenuEl.dataset.options = signature;
  }
  auxMenuEl.value = selectedAux || "";
  auxMenuEl.disabled = !auxOptions.length;
}

function renderLiveMixChannels(levels, stereo) {
  liveChannelElements.clear();
  if (!levels) {
    liveMixChannelsEl.innerHTML = '<p class="muted">Waiting for desk values…</p>';
    return;
  }

  const visibleLevels = levels.filter((entry) => entry.level != null);
  if (!visibleLevels.length) {
    liveMixChannelsEl.innerHTML = '<p class="muted">Waiting for desk values…</p>';
    return;
  }

  liveMixChannelsEl.innerHTML = visibleLevels
    .map((entry) => {
      const levelPercent = levelPercentage(entry.level);
      const channelLabel = escapeHtml(entry.label || `Ch ${entry.channel}`);
      const panStyle =
        Number.isFinite(entry.pan) ? `${Math.round((Math.max(-1, Math.min(1, entry.pan)) + 1) * 50)}%` : "50%";

      return `<div class="live-channel" data-channel="${Number(entry.channel)}">
        <div class="mixer-fader volume" style="--value: ${levelPercent}%">
          <span title="${channelLabel}">${channelLabel}</span>
          <div class="fader-track" role="meter" aria-label="${channelLabel} send level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${levelPercent}"><div class="fader-fill"></div><div class="fader-thumb"></div></div>
          <span class="level-readout">${levelPercent}%</span>
        </div>
        ${
          stereo
            ? `<div class="mixer-fader pan-display${showPan ? "" : " hidden"}" style="--value: ${panStyle}">
          <span>Pan</span>
          <div class="pan-track"></div>
          <span class="pan-readout">${formatPan(entry.pan)}</span>
        </div>`
            : ""
        }
      </div>`;
    })
    .join("");
  for (const row of liveMixChannelsEl.querySelectorAll(".live-channel")) {
    liveChannelElements.set(row.dataset.channel, row);
  }
}

function parseLiveMixUpdate(message) {
  if (!message || typeof message.address !== "string" || !Array.isArray(message.args)) return null;
  const match = message.address.match(/^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_(level|pan)$/);
  const value = message.args[0];
  if (!match || !Number.isFinite(value)) return null;
  return {
    channel: Number(match[1]), aux: Number(match[2]), field: match[3],
    value: match[3] === "level"
      ? (value <= -150 ? 0 : Math.max(0, Math.min(1, Math.pow(100, (value + 90) / 100) / 100)))
      : Math.max(-1, Math.min(1, value * 2 - 1)),
  };
}

function applyLiveMixUpdate(levels, update) {
  const entry = levels?.[update.aux]?.find(entry => Number(entry.channel) === update.channel);
  if (entry) entry[update.field] = update.value;
  return entry;
}

function receiveLiveMixMessage(event) {
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  if (message?.address === "/MixReload") { void loadStatus(); return; }
  const update = parseLiveMixUpdate(message);
  if (!update) return;
  const entry = applyLiveMixUpdate(mixLevels, update);
  if (!entry) return;
  // A status response may have been captured before this newer streamed value.
  if (statusLoading) statusLiveUpdates.set(message.address, update);
  if (String(update.aux) !== String(selectedAux)) return;
  const row = liveChannelElements.get(String(update.channel));
  if (!row) {
    const aux = auxOptions.find(aux => Number(aux.channel) === update.aux);
    if (aux && entry.level != null) renderLiveMixChannels(mixLevels[update.aux], aux.stereo);
    return;
  }
  if (update.field === "level") {
    const percent = levelPercentage(entry.level);
    row.querySelector(".volume").style.setProperty("--value", `${percent}%`);
    row.querySelector(".fader-track").setAttribute("aria-valuenow", String(percent));
    row.querySelector(".level-readout").textContent = `${percent}%`;
  } else {
    const pan = row.querySelector(".pan-display");
    if (pan) {
      pan.style.setProperty("--value", `${Math.round((entry.pan + 1) * 50)}%`);
      row.querySelector(".pan-readout").textContent = formatPan(entry.pan);
    }
  }
}

function stopLiveMixStream() {
  clearTimeout(liveMixReconnectTimer);
  clearTimeout(liveMixConnectTimer);
  liveMixReconnectTimer = null;
  const socket = liveMixSocket;
  liveMixSocket = null;
  if (socket) socket.close();
}

function syncLiveMixStream() {
  if (currentPage !== "live-mix" || !deskReady) { stopLiveMixStream(); return; }
  if (liveMixSocket || liveMixReconnectTimer) return;
  const socket = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/?role=observer");
  liveMixSocket = socket;
  socket.onopen = () => {
    if (liveMixSocket !== socket) return;
    clearTimeout(liveMixConnectTimer);
    void loadStatus(); // Reconcile any changes missed while disconnected.
  };
  socket.onmessage = event => { if (liveMixSocket === socket) receiveLiveMixMessage(event); };
  socket.onerror = () => socket.close();
  socket.onclose = () => {
    if (liveMixSocket !== socket) return;
    clearTimeout(liveMixConnectTimer);
    liveMixSocket = null;
    liveMixReconnectTimer = setTimeout(() => {
      liveMixReconnectTimer = null;
      syncLiveMixStream();
    }, 1000);
  };
  liveMixConnectTimer = setTimeout(() => {
    if (liveMixSocket === socket && socket.readyState === WebSocket.CONNECTING) socket.close();
  }, 3000);
}

function renderLiveMix() {
  const aux = auxOptions.find(
    (entry) => String(entry.channel) === String(selectedAux),
  );

  if (!aux) {
    liveMixFoldEl.hidden = true;
    liveMixHintEl.hidden = false;
    return;
  }

  liveMixHintEl.hidden = true;
  liveMixFoldEl.hidden = false;
  restoreFoldable(liveMixFoldEl, "adminLiveMixFold");
  liveMixTitleEl.textContent = getAuxLabel(aux);
  liveMixSummaryEl.textContent = `Live sends · ${getAuxLabel(aux)}`;
  document.body.style.setProperty("--live-tint", safeColour(aux.colour));

  panToggleLabelEl.hidden = !aux.stereo;
  panToggleEl.checked = showPan && aux.stereo;

  renderLiveMixChannels(mixLevels[aux.channel], aux.stereo);
}

function selectAux(channel) {
  selectedAux = String(channel);
  sessionStorage.setItem("adminSelectedAux", selectedAux);
  renderAuxMenu();
  renderLiveMix();
  if (currentPage === "live-mix") void loadStatus();
}

function renderMixerConnection(data) {
  currentUrl = data.url;
  mixerUrlEl.href = data.url;
  mixerUrlEl.textContent = data.url;
  qrCodeEl.src = data.qr;
  if (!mixerUrlDirty && !mixerUrlSaving) customMixerUrlEl.value = data.customMixerUrl || "";
}

function renderStatus(data, updateMixerUrl = true) {
  const version = document.getElementById("appVersion");
  version.hidden = typeof data.version !== "string" || !data.version;
  version.textContent = version.hidden ? "" : "v" + data.version;
  version.title = version.hidden ? "" : "EarsMixer " + version.textContent;
  deskReady = !!data.loaded;
  loadingEl.hidden = true;
  errorEl.hidden = true;
  contentEl.hidden = false;
  setAdminConnection(true, data.loaded);
  const deskStatus = document.getElementById("deskStatus");
  deskStatus.textContent = data.loaded ? "Desk discovered. Mix values load when an AUX is selected." : "Waiting for desk discovery. Check the connection in Desk settings.";
  const deskSnapshot = document.getElementById("deskSnapshot");
  deskSnapshot.hidden = data.snapshot == null || data.snapshot === "";
  deskSnapshot.textContent = deskSnapshot.hidden ? "" : "Snapshot: " + String(data.snapshot);

  if (updateMixerUrl) renderMixerConnection(data);
  connectionsEl.textContent = String(data.connections);
  authStatusEl.textContent = data.adminPasswordEnabled ? "Enabled" : "Disabled";
  renderAdminPassword(!!data.adminPasswordEnabled);
  auxCountEl.textContent = String(data.aux.length);
  channelCountEl.textContent = String(data.channels.length);

  auxOptions = data.aux || [];
  mixLevels = data.mixLevels || {};

  if (
    selectedAux &&
    !auxOptions.some((entry) => String(entry.channel) === String(selectedAux))
  ) {
    selectedAux = null;
    sessionStorage.removeItem("adminSelectedAux");
  }

  if (!selectedAux && auxOptions.length) {
    selectedAux = String(auxOptions[0].channel);
    sessionStorage.setItem("adminSelectedAux", selectedAux);
  }

  renderAuxMenu();
  renderLiveMix();
  syncLiveMixStream();

  renderClients(data.clients || []);
  document.dispatchEvent(new CustomEvent("admin-mixer-config", { detail: { channels: data.channels, aux: data.aux } }));

  auxTableEl.innerHTML = data.aux
    .map(
      (aux) => `<tr>
        <td><span class="colour-dot" style="background: rgb(${safeColour(aux.colour)})"></span>${escapeHtml(aux.channel)}</td>
        <td>${escapeHtml(aux.label || "—")}</td>
        <td>${aux.stereo ? "Yes" : "No"}</td>
      </tr>`,
    )
    .join("");

  channelTableEl.innerHTML = data.channels
    .map(
      (channel) => `<tr>
        <td>${escapeHtml(channel.channel)}</td>
        <td>${escapeHtml(channel.label || "—")}</td>
      </tr>`,
    )
    .join("");
}

async function loadStatus() {
  if (statusLoading) return;
  statusLoading = true;
  const requestMixerUrlRevision = mixerUrlRevision;
  statusLiveUpdates.clear();
  try {
    const query = currentPage === "live-mix" && selectedAux ? "?aux=" + encodeURIComponent(selectedAux) : "";
    const response = await adminFetch("/api/admin/status" + query);
    if (!response.ok) {
      throw new Error("Request failed");
    }
    const data = await response.json();
    for (const update of statusLiveUpdates.values()) applyLiveMixUpdate(data.mixLevels, update);
    renderStatus(data, requestMixerUrlRevision === mixerUrlRevision);
  } catch {
    loadingEl.hidden = true;
    contentEl.hidden = true;
    errorEl.hidden = false;
    setAdminConnection(false);
  } finally {
    statusLoading = false;
  }
}

customMixerUrlEl.addEventListener("input", () => {
  mixerUrlDirty = true;
  mixerUrlMessageEl.textContent = "";
});

document.getElementById("mixerUrlForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (mixerUrlSaving) return;
  mixerUrlSaving = true;
  customMixerUrlEl.disabled = true;
  saveMixerUrlEl.disabled = true;
  mixerUrlMessageEl.textContent = "Saving…";
  mixerUrlMessageEl.classList.remove("error");
  try {
    const response = await adminFetch("/api/admin/mixer-url", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: customMixerUrlEl.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save the mixer URL.");
    mixerUrlRevision++;
    mixerUrlDirty = false;
    customMixerUrlEl.value = data.customMixerUrl;
    renderMixerConnection(data);
    mixerUrlMessageEl.textContent = "Mixer link and QR code updated.";
  } catch (error) {
    mixerUrlMessageEl.textContent = error.message || "Could not save the mixer URL. Please try again.";
    mixerUrlMessageEl.classList.toggle("error", true);
  } finally {
    mixerUrlSaving = false;
    customMixerUrlEl.disabled = false;
    saveMixerUrlEl.disabled = false;
  }
});

copyUrlBtn.addEventListener("click", async () => {
  if (!currentUrl) {
    return;
  }

  try {
    await navigator.clipboard.writeText(currentUrl);
    copyUrlBtn.innerHTML = appIcon("check") + " Copied";
    setTimeout(() => {
      copyUrlBtn.innerHTML = appIcon("copy") + " Copy";
    }, 1500);
  } catch {
    copyUrlBtn.innerHTML = appIcon("x") + " Copy failed";
    setTimeout(() => {
      copyUrlBtn.innerHTML = appIcon("copy") + " Copy";
    }, 1500);
  }
});

auxMenuEl.addEventListener("change", () => selectAux(auxMenuEl.value));

panToggleEl.addEventListener("change", () => {
  showPan = panToggleEl.checked;
  sessionStorage.setItem("adminShowPan", String(showPan));
  renderLiveMix();
});

sidebarNavEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button) {
    return;
  }
  showPage(button.dataset.page);
});

sidebarToggleEl.addEventListener("click", () => {
  const open = document.body.classList.toggle("sidebar-open");
  document.getElementById("sidebarBackdrop").hidden = !open;
  sidebarToggleEl.setAttribute("aria-expanded", String(open));
});
window.addEventListener("resize", () => { if (window.innerWidth > 768) closeAdminNavigation(); });

window.addEventListener("hashchange", () => {
  const page = window.location.hash.replace("#", "");
  if (page && page !== currentPage) {
    showPage(page);
  }
});

showPage(currentPage);
bindFoldable(liveMixFoldEl, "adminLiveMixFold");
loadStatus();
setInterval(loadStatus, 2000);
window.addEventListener("pagehide", stopLiveMixStream);
window.addEventListener("pageshow", event => {
  if (event.persisted) { contentEl.hidden = true; void loadStatus(); }
});

function setAdminConnection(connected, deskReady = true) {
  const status = document.getElementById("adminConnection");
  status.classList.toggle("online", connected && deskReady);
  status.lastElementChild.textContent = connected ? (deskReady ? "Connected" : "Waiting for desk…") : "Reconnecting…";
}
function closeAdminNavigation() {
  document.body.classList.remove("sidebar-open");
  document.getElementById("sidebarBackdrop").hidden = true;
  sidebarToggleEl.setAttribute("aria-expanded", "false");
}
document.getElementById("sidebarBackdrop").addEventListener("click", closeAdminNavigation);
document.addEventListener("keydown", event => { if (event.key === "Escape") closeAdminNavigation(); });

document.addEventListener("desk-settings-saved", () => { void loadStatus(); });
