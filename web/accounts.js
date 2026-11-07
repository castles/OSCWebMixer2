"use strict";

let accountUser = null;
let accountRevision = 0;
let accountRestoring = false;
let accountConflict = false;
let accountSaved = "";
let accountEnabled = false;
let accountSaving = false;
let accountBusy = false;
let accountGeneration = 0;
let accountTimer = null;
let accountPending = null;
let accountRegistering = false;
const accountMessage = document.getElementById("accountMessage");
const accountStatus = document.getElementById("accountSyncStatus");
const accountSaveButton = document.getElementById("saveAccountLayout");
const accountReloadButton = document.getElementById("reloadAccountLayout");

function captureMixerPreferences() {
  const favouritesByAux = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const match = /^aux([1-9]\d*)fav(?:Checked)?$/.exec(key);
    if (!match || favouritesByAux[match[1]]) continue;
    const id = match[1];
    favouritesByAux[id] = { channels: (localStorage.getItem("aux" + id + "fav") || "").split(",").map(Number).filter(id => Number.isSafeInteger(id) && id > 0), enabled: localStorage.getItem("aux" + id + "favChecked") === "true" };
  }
  let channelOrder;
  try { channelOrder = JSON.parse(localStorage.getItem("channelLayout") || "null"); } catch {}
  if (!Array.isArray(channelOrder)) channelOrder = Array.from(channelsDiv.children, row => Number(row.dataset.channel));
  return { selectedAux: Number(auxSelect.value) || null, channelOrder: channelOrder.map(Number).filter(id => Number.isSafeInteger(id) && id > 0), favouritesByAux,
    view: localStorage.getItem("channelView") === "grid" ? "grid" : "list", compact: localStorage.getItem("compactMode") === "true" };
}

async function accountRequest(path = "", { method = "GET", body, keepalive = false } = {}) {
  const response = await fetch("/api/account" + path, { method, cache: "no-store", credentials: "same-origin", keepalive,
    ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || "The account request failed."); error.status = response.status; error.data = data; throw error; }
  return data;
}

function renderAccount() {
  document.getElementById("accountGuest").hidden = !!accountUser;
  document.getElementById("accountMember").hidden = !accountUser;
  if (accountUser) {
    document.getElementById("accountIdentity").textContent = "Signed in as " + accountUser.username;
    const nameInput = document.getElementById("accountDisplayName");
    if (document.activeElement !== nameInput) nameInput.value = accountUser.displayName;
    document.getElementById("usernameForm").hidden = true;
  }
  accountSaveButton.textContent = accountConflict ? "Keep this layout" : "Save this layout";
  accountReloadButton.hidden = !accountRevision;
}

function accountLabel() {
  if (accountUser) { localStorage.setItem("deviceUsername", accountUser.displayName); updateUsernameLabel(); document.dispatchEvent(new Event("device-username-changed")); }
}

function restoreAccountLayout(config) {
  if (!mixerConfigReady) { accountPending = config; return; }
  accountRestoring = true;
  try {
    applyLocalTemplate(config);
    localStorage.setItem("compactMode", String(config.compact));
    setCompactMode(config.compact);
    localStorage.setItem("templateChoice", JSON.stringify({ type: "fresh" }));
    templateChoice = { type: "fresh" };
    accountSaved = JSON.stringify(captureMixerPreferences());
  } finally { accountRestoring = false; }
}

function acceptAccount(data, { restore = true } = {}) {
  accountUser = data.user;
  localStorage.setItem("activeMixerAccount", data.user.id);
  accountRevision = data.revision;
  accountConflict = false;
  accountEnabled = !!data.preferences;
  accountPending = null;
  accountSaved = "";
  if (data.preferences && restore) restoreAccountLayout(data.preferences);
  accountStatus.textContent = data.preferences ? "Layout saved to this server. Changes save automatically." : "No saved layout yet. Save this layout to start syncing.";
  accountLabel(); renderAccount();
}

function rememberGuestLayout() {
  if (!accountUser && !localStorage.getItem("activeMixerAccount")) localStorage.setItem("guestMixerProfile", JSON.stringify({ name: getDeviceUsername(), preferences: captureMixerPreferences() }));
}

function leaveAccount(message) {
  accountGeneration++; clearTimeout(accountTimer); accountUser = null; accountEnabled = false; accountPending = null; accountSaved = ""; accountRevision = 0; accountConflict = false;
  localStorage.removeItem("activeMixerAccount");
  let guest;
  try { guest = JSON.parse(localStorage.getItem("guestMixerProfile") || "null"); } catch {}
  restoreAccountLayout(guest?.preferences || { selectedAux: Number(auxSelect.options[0]?.value) || null, channelOrder: defaultChannelOrder.map(Number), favouritesByAux: {}, view: "list", compact: false });
  if (guest?.name) localStorage.setItem("deviceUsername", guest.name); else localStorage.removeItem("deviceUsername");
  updateUsernameLabel(); document.dispatchEvent(new Event("device-username-changed"));
  document.getElementById("usernameForm").hidden = false;
  accountMessage.textContent = message;
  renderAccount();
}

async function saveAccountPreferences({ keepalive = false } = {}) {
  clearTimeout(accountTimer);
  if (!accountUser || !accountEnabled || accountRestoring || accountConflict || accountSaving || !mixerConfigReady) return;
  const config = captureMixerPreferences();
  const json = JSON.stringify(config);
  if (json === accountSaved) return;
  const generation = accountGeneration;
  accountSaving = true;
  accountStatus.textContent = "Saving layout…";
  let success = false;
  try {
    const result = await accountRequest("/preferences", { method: "PUT", body: { userId: accountUser.id, preferences: config, revision: accountRevision }, keepalive });
    if (generation !== accountGeneration) return;
    accountRevision = result.revision; accountSaved = json; success = true;
    accountStatus.textContent = "Layout saved to this server.";
  } catch (error) {
    if (generation !== accountGeneration) return;
    if (error.status === 409) {
      accountRevision = error.data.revision;
      accountConflict = true;
      accountStatus.textContent = "Your layout changed on another device. Load the saved layout or explicitly keep this one.";
    } else if (error.status === 401) leaveAccount("Your session ended. Sign in again to load your saved layout.");
    else accountStatus.textContent = "Layout not saved. Check the connection and press Save this layout to retry.";
  } finally {
    accountSaving = false;
    renderAccount();
    if (success && generation === accountGeneration && JSON.stringify(captureMixerPreferences()) !== accountSaved) scheduleAccountSave();
  }
}

function scheduleAccountSave() {
  if (!accountUser || !accountEnabled || accountRestoring || accountConflict) return;
  clearTimeout(accountTimer);
  accountTimer = setTimeout(() => { void saveAccountPreferences(); }, 600);
}
document.addEventListener("mixer-preferences-changed", scheduleAccountSave);
document.addEventListener("mixer-config-ready", () => {
  if (accountPending) { const pending = accountPending; accountPending = null; restoreAccountLayout(pending); }
  else if (accountEnabled && !accountSaved) scheduleAccountSave();
});
document.addEventListener("profile-opened", renderAccount);
window.addEventListener("pagehide", () => { void saveAccountPreferences({ keepalive: true }); });
window.addEventListener("online", scheduleAccountSave);

document.getElementById("accountMode").addEventListener("click", () => {
  accountRegistering = !accountRegistering;
  document.getElementById("accountSubmit").textContent = accountRegistering ? "Create account" : "Sign in";
  document.getElementById("accountMode").textContent = accountRegistering ? "Sign in instead" : "Create account";
  document.getElementById("accountImportLabel").hidden = !accountRegistering;
  document.getElementById("accountPassword").autocomplete = accountRegistering ? "new-password" : "current-password";
  accountMessage.textContent = "";
});

document.getElementById("accountForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (accountBusy || accountSaving) return;
  accountBusy = true;
  const submit = document.getElementById("accountSubmit"); submit.disabled = true;
  accountMessage.textContent = "";
  try {
    rememberGuestLayout();
    const result = await accountRequest(accountRegistering ? "/register" : "/login", { method: "POST", body: {
      username: document.getElementById("accountUsername").value, password: document.getElementById("accountPassword").value,
      ...(accountRegistering ? { displayName: getDeviceUsername() || document.getElementById("accountUsername").value } : {}) } });
    accountGeneration++; acceptAccount(result);
    document.getElementById("accountPassword").value = "";
    if (accountRegistering && document.getElementById("accountImportLayout").checked) {
      accountEnabled = true; accountSaved = ""; await saveAccountPreferences();
    }
    usernameOnboarding = false; templateOnboarding = false;
    profileDialog.close();
  } catch (error) { accountMessage.textContent = error.message; }
  finally { accountBusy = false; submit.disabled = false; }
});

accountSaveButton.addEventListener("click", () => {
  accountEnabled = true; accountConflict = false; accountSaved = "";
  void saveAccountPreferences();
});
accountReloadButton.addEventListener("click", async () => {
  if (accountBusy || accountSaving) return;
  accountBusy = true;
  try {
    const data = await accountRequest();
    if (!data.user || data.user.id !== accountUser?.id) throw new Error("Sign in again before loading your layout.");
    accountGeneration++; acceptAccount(data);
  } catch (error) { accountMessage.textContent = error.message; }
  finally { accountBusy = false; }
});
document.getElementById("accountNameForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (accountBusy || !accountUser) return;
  accountBusy = true;
  try {
    const result = await accountRequest("", { method: "PUT", body: { userId: accountUser.id, displayName: document.getElementById("accountDisplayName").value } });
    accountUser = result.user; accountLabel(); renderAccount(); accountMessage.textContent = "Name saved.";
  } catch (error) { accountMessage.textContent = error.message; }
  finally { accountBusy = false; }
});
document.getElementById("accountLogout").addEventListener("click", async () => {
  if (accountBusy || accountSaving) { accountMessage.textContent = "Please wait for the current save to finish."; return; }
  accountBusy = true;
  try {
    await saveAccountPreferences();
    if (accountUser && accountEnabled && (accountConflict || JSON.stringify(captureMixerPreferences()) !== accountSaved)) {
      accountMessage.textContent = "Your changes have not been saved. Save this layout or load the saved layout before signing out.";
      return;
    }
    await accountRequest("/logout", { method: "POST", body: {} });
    leaveAccount("Signed out. Guest settings are active on this device.");
  } catch (error) { accountMessage.textContent = error.message; }
  finally { accountBusy = false; }
});

async function refreshAccount() {
  if (accountBusy || accountSaving) return;
  const generation = accountGeneration;
  try {
    const result = await accountRequest();
    if (generation !== accountGeneration || accountBusy || accountSaving) return;
    if (!result.user) {
      if (accountUser || localStorage.getItem("activeMixerAccount")) leaveAccount("Your session ended. Sign in again to load your saved layout.");
      return;
    }
    if (accountUser && result.user.id !== accountUser.id) leaveAccount("The signed-in account changed in another window.");
    if (accountUser && result.revision !== accountRevision && JSON.stringify(captureMixerPreferences()) !== accountSaved) {
      accountRevision = result.revision; accountConflict = true;
      accountStatus.textContent = "Your layout changed on another device. Load the saved layout or explicitly keep this one."; renderAccount(); return;
    }
    if (!accountUser || result.revision !== accountRevision) {
      rememberGuestLayout();
      accountGeneration++; acceptAccount(result);
      usernameOnboarding = false; templateOnboarding = false; profileDialog.close();
    }
    else { accountUser = result.user; accountLabel(); renderAccount(); }
  } catch { accountMessage.textContent = "Accounts are unavailable. You can still mix as a guest."; }
}
window.addEventListener("focus", () => { void refreshAccount(); });
void refreshAccount();
