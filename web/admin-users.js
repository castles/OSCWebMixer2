"use strict";
(() => {
  const table = document.getElementById("usersTable");
  const message = document.getElementById("usersMessage");
  const form = document.getElementById("userPasswordForm");
  const password = document.getElementById("userNewPassword");
  const confirmation = document.getElementById("userConfirmPassword");
  const submit = document.getElementById("resetUserPassword");
  let selected = null;
  let busy = false;
  async function loadUsers() {
    if (busy) return;
    busy = true;
    try {
      const response = await adminFetch("/api/admin/users");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load accounts.");
      table.replaceChildren();
      for (const user of data.users) {
        const row = document.createElement("tr");
        for (const value of [user.username, user.displayName]) {
          const cell = document.createElement("td"); cell.textContent = value; row.appendChild(cell);
        }
        const cell = document.createElement("td");
        const button = document.createElement("button"); button.type = "button"; button.textContent = "Reset password";
        button.setAttribute("aria-label", "Reset password for " + user.username);
        button.addEventListener("click", () => {
          if (busy) return;
          selected = user; form.reset(); form.hidden = false;
          document.getElementById("userPasswordTitle").textContent = "Reset password for " + user.username;
          password.focus();
        });
        cell.appendChild(button); row.appendChild(cell); table.appendChild(row);
      }
      message.textContent = data.users.length ? "" : "No musician accounts yet. Musicians can create an account from Your profile in the mixer.";
    } catch (error) { table.replaceChildren(); message.textContent = error.message; }
    finally { busy = false; }
  }
  document.getElementById("refreshUsers").addEventListener("click", loadUsers);
  document.addEventListener("admin-page-changed", event => { if (event.detail.page === "config") void loadUsers(); });
  document.addEventListener("admin-password-changed", loadUsers);
  document.getElementById("cancelUserPassword").addEventListener("click", () => { if (!busy) { form.reset(); form.hidden = true; selected = null; } });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!selected || busy) return;
    if (password.value !== confirmation.value) { message.textContent = "The new passwords do not match."; confirmation.focus(); return; }
    busy = true; submit.disabled = true;
    try {
      const response = await adminFetch("/api/admin/users/" + encodeURIComponent(selected.id) + "/password", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: password.value })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not reset the password.");
      message.textContent = "Password reset for " + selected.username + ". Their saved layout is unchanged. They can sign in with the new password.";
      form.reset(); form.hidden = true; selected = null;
    } catch (error) { message.textContent = error.message; }
    finally { busy = false; submit.disabled = false; }
  });
  if (window.location.hash === "#config") void loadUsers();
})();
