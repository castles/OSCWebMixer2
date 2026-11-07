"use strict";

const adminPasswordForm = document.getElementById("adminPasswordForm");
const adminPasswordFields = document.getElementById("adminPasswordFields");
const currentAdminPassword = document.getElementById("currentAdminPassword");
const newAdminPassword = document.getElementById("newAdminPassword");
const confirmAdminPassword = document.getElementById("confirmAdminPassword");
const adminPasswordMessage = document.getElementById("adminPasswordMessage");
const adminLogout = document.getElementById("adminLogout");
let adminPasswordBusy = false;

async function adminFetch(url, options = {}) {
  const response = await fetch(url, { ...options, cache: "no-store" });
  if (response.status === 401) {
    document.getElementById("content").hidden = true;
    window.location.replace("/admin-login.html" + window.location.hash);
    throw new Error("Enter the admin password to continue.");
  }
  return response;
}

function renderAdminPassword(enabled) {
  document.getElementById("adminPasswordStatus").textContent = enabled
    ? "Password protection is enabled. Sign in to access the admin dashboard."
    : "No password is set. Anyone on this network can access the admin dashboard.";
  document.getElementById("currentPasswordLabel").hidden = !enabled;
  currentAdminPassword.required = enabled;
  currentAdminPassword.disabled = !enabled;
  document.getElementById("saveAdminPassword").textContent = enabled ? "Change password" : "Set password";
  document.getElementById("removeAdminPassword").hidden = !enabled;
  adminLogout.hidden = !enabled;
}

function passwordMessage(message, error = false) {
  adminPasswordMessage.textContent = message;
  adminPasswordMessage.classList.toggle("error", error);
}

async function saveAdminPassword(remove) {
  if (adminPasswordBusy) return;
  if (remove && !currentAdminPassword.reportValidity()) return;
  if (!remove && !adminPasswordForm.reportValidity()) return;
  if (!remove && newAdminPassword.value !== confirmAdminPassword.value) {
    passwordMessage("The new passwords do not match.", true);
    confirmAdminPassword.focus();
    return;
  }
  adminPasswordBusy = true;
  adminPasswordFields.disabled = true;
  passwordMessage("");
  try {
    const response = await adminFetch("/api/admin/password", {
      method: remove ? "DELETE" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: currentAdminPassword.value, password: newAdminPassword.value }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not save the password.");
    adminPasswordForm.reset();
    renderAdminPassword(body.enabled);
    document.dispatchEvent(new Event("admin-password-changed"));
    passwordMessage(remove
      ? "Password removed. The admin dashboard is now open to anyone on this network."
      : "Password saved. Other admins must sign in with the new password. You are still signed in.");
  } catch (error) {
    passwordMessage(error.message, true);
  } finally {
    adminPasswordBusy = false;
    adminPasswordFields.disabled = false;
  }
}

adminPasswordForm.addEventListener("submit", event => {
  event.preventDefault();
  void saveAdminPassword(false);
});
document.getElementById("removeAdminPassword").addEventListener("click", () => { void saveAdminPassword(true); });
adminLogout.addEventListener("click", async () => {
  adminLogout.disabled = true;
  try {
    const response = await adminFetch("/api/admin/logout", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!response.ok) throw new Error("Could not sign out. Please try again.");
    document.getElementById("content").hidden = true;
    window.location.replace("/admin-login.html");
  } catch (error) {
    passwordMessage(error.message, true);
    showPage("config");
    adminLogout.disabled = false;
  }
});
