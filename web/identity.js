"use strict";
const profileDialog = document.getElementById("profileDialog");
const usernameInput = document.getElementById("deviceUsername");
let usernameOnboarding = false;
function getDeviceUsername() { return localStorage.getItem("deviceUsername") || null; }
function sendDeviceUsername(socket) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ username: getDeviceUsername() }));
}
function updateUsernameLabel() {
  const name = getDeviceUsername();
  document.getElementById("deviceUsernameLabel").textContent = name || "Nickname";
  document.getElementById("editUsername").setAttribute("aria-label", name ? "Open profile for " + name : "Open profile");
}
function finishUsernameChoice() { usernameOnboarding = false; profileDialog.close(); document.dispatchEvent(new Event("device-username-ready")); }
function prepareUsernameForm() {
  usernameInput.value = getDeviceUsername() || "";
  document.getElementById("usernameError").textContent = "";
  document.getElementById("usernameSaved").hidden = true;
  document.getElementById("skipUsername").hidden = !usernameOnboarding;
}
function openUsernameDialog() {
  usernameOnboarding = true; prepareUsernameForm();
  document.getElementById("profileTitle").textContent = "Nickname";
  document.getElementById("usernameForm").hidden = false;
  document.getElementById("profileTemplates").hidden = true;
  document.getElementById("closeProfile").hidden = false;
  profileDialog.showModal();
}
document.getElementById("editUsername").addEventListener("click", () => {
  usernameOnboarding = false; prepareUsernameForm();
  document.getElementById("usernameForm").hidden = false;
  document.getElementById("profileTemplates").hidden = false;
  document.getElementById("profileTitle").textContent = "Device settings";
  profileDialog.showModal(); document.dispatchEvent(new Event("profile-opened"));
});
document.getElementById("closeProfile").addEventListener("click", () => { if (usernameOnboarding) finishUsernameChoice(); else profileDialog.close(); });
document.getElementById("skipUsername").addEventListener("click", finishUsernameChoice);
function saveNickname() {
  const name = usernameInput.value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) {
    document.getElementById("usernameError").textContent = "Use up to 80 characters.";
    return;
  }
  try {
    if (name) localStorage.setItem("deviceUsername", name);
    else localStorage.removeItem("deviceUsername");
    document.getElementById("usernameError").textContent = "";
    updateUsernameLabel();
    document.dispatchEvent(new Event("device-username-changed"));
  } catch { document.getElementById("usernameError").textContent = "Could not save to this device."; }
}
usernameInput.addEventListener("input", saveNickname);
profileDialog.addEventListener("cancel", event => { if (usernameOnboarding) { event.preventDefault(); finishUsernameChoice(); } });
document.getElementById("usernameForm").addEventListener("submit", event => {
  event.preventDefault(); saveNickname();
  if (usernameOnboarding) finishUsernameChoice(); else profileDialog.close();
});
window.addEventListener("storage", event => {
  if (event.key === "deviceUsername" || event.key === null) { updateUsernameLabel(); document.dispatchEvent(new Event("device-username-changed")); }
});
updateUsernameLabel();
if (!getDeviceUsername()) openUsernameDialog();
