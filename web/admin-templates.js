"use strict";
const adminTemplateSelect = document.getElementById("adminTemplateSelect");
const templateEditor = document.getElementById("templateEditor");
const templateNameInput = document.getElementById("templateName");
const templateAuxInput = document.getElementById("templateAux");
const templateViewInput = document.getElementById("templateView");
const templateRows = document.getElementById("templateChannels");
const templateFilterInput = document.getElementById("templateFavouritesOnly");
const templateAuthorInput = document.getElementById("templateAuthor");
let adminTemplates = [];
let templateChannels = [];
let templateAuxes = [];
let templateDraft = null;
let templateSorter = null;
let adminTemplateBusy = false;
let templateConfigSignature = "";
templateAuthorInput.value = localStorage.getItem("templateAdminName") || localStorage.getItem("deviceUsername") || "Admin";
async function adminTemplateRequest(url, options) {
  const response = await adminFetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Template request failed.");
  return body;
}
function adminTemplateMessage(text, error = false) {
  const el = document.getElementById("adminTemplateMessage"); el.textContent = text; el.classList.toggle("error", error);
}
function updateAdminTemplateControls() {
  const selected = adminTemplates.find(template => template.id === adminTemplateSelect.value);
  document.getElementById("editSavedTemplate").disabled = adminTemplateBusy || !selected || !templateChannels.length;
  document.getElementById("newTemplate").disabled = adminTemplateBusy || !templateChannels.length || !templateAuxes.length;
  document.getElementById("deleteSavedTemplate").disabled = adminTemplateBusy || !selected;
  adminTemplateSelect.disabled = adminTemplateBusy || !adminTemplates.length;
  document.getElementById("templateFields").disabled = adminTemplateBusy || !templateAuxes.length;
  if (templateSorter) templateSorter.option("disabled", adminTemplateBusy);
  document.getElementById("adminTemplateUpdated").textContent = selected ? "Created by " + (selected.createdBy || "an unnamed admin") + " · Updated " + new Date(selected.updatedAt).toLocaleString() + " by " + (selected.updatedBy || "an unnamed admin") : "";
  const name = templateNameInput.value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const existing = adminTemplates.find(template => template.name.toLowerCase() === name);
  document.getElementById("templateSaveHint").textContent = existing ? "Saving updates “" + existing.name + "”." : "";
}
async function refreshAdminTemplates(id = adminTemplateSelect.value) {
  const result = await adminTemplateRequest("/api/templates", { cache: "no-store" });
  adminTemplates = result.templates;
  adminTemplateSelect.replaceChildren(new Option(adminTemplates.length ? "Choose a template…" : "No templates yet", ""));
  for (const template of adminTemplates) adminTemplateSelect.add(new Option(template.name, template.id));
  if (id) adminTemplateSelect.value = id;
  updateAdminTemplateControls();
}
function draftAuxSettings() {
  const aux = templateAuxInput.value;
  if (!templateDraft.favouritesByAux[aux]) templateDraft.favouritesByAux[aux] = { channels: [], enabled: false };
  return templateDraft.favouritesByAux[aux];
}
function draftHidden() { return templateDraft.hiddenByAux[templateAuxInput.value] || []; }
// Groups follow the mobile app's rules: unique IDs across all groups, and no
// channel in more than one group a mix can see (its own groups plus the
// all-mix groups). Channels used by a conflicting group are unavailable.
function allTemplateGroups() { return [...templateDraft.globalGroups, ...Object.values(templateDraft.groupsByAux).flat()]; }
function takenChannels(group, global) {
  const others = global ? allTemplateGroups() : [...templateDraft.globalGroups, ...(templateDraft.groupsByAux[templateAuxInput.value] || [])];
  return new Set(others.filter(entry => entry !== group).flatMap(entry => entry.members));
}
function addTemplateGroup(global) {
  const id = Math.max(0, ...allTemplateGroups().map(group => group.id)) + 1;
  const list = global ? templateDraft.globalGroups : (templateDraft.groupsByAux[templateAuxInput.value] ||= []);
  list.push({ id, name: "", members: [] });
  renderTemplateGroups();
  document.querySelector('[data-group-id="' + id + '"] input')?.focus();
}
function templateGroupCard(group, list, global) {
  const channels = new Map(templateChannels.map(channel => [channel.channel, channel]));
  const order = [...templateDraft.channelOrder, ...channels.keys()].filter((id, index, ids) => channels.has(id) && ids.indexOf(id) === index);
  const card = document.createElement("div"); card.className = "template-group"; card.dataset.groupId = String(group.id);
  card.innerHTML = '<div class="template-group-head"><input maxlength="80" placeholder="Group name (optional)"><button type="button">Delete</button></div><div class="template-group-members"></div><p class="template-group-warning"></p>';
  const name = card.querySelector("input"); name.value = group.name; name.setAttribute("aria-label", "Group name");
  name.addEventListener("input", () => { group.name = name.value; });
  card.querySelector("button").addEventListener("click", () => { list.splice(list.indexOf(group), 1); renderTemplateGroups(); });
  card.querySelector("button").setAttribute("aria-label", "Delete group " + (group.name || group.id));
  const members = card.querySelector(".template-group-members"), taken = takenChannels(group, global);
  for (const id of order) {
    const channel = channels.get(id), label = document.createElement("label"); label.className = "template-group-member";
    label.innerHTML = '<input type="checkbox"><span></span>';
    label.querySelector("span").textContent = channel.label || "Channel " + id;
    const box = label.querySelector("input"); box.checked = group.members.includes(id); box.disabled = !box.checked && taken.has(id);
    if (box.disabled) label.title = "Already in another group";
    box.addEventListener("change", () => {
      group.members = box.checked ? [...group.members, id] : group.members.filter(value => value !== id);
      renderTemplateGroups();
    });
    members.appendChild(label);
  }
  card.querySelector(".template-group-warning").textContent = group.members.length < 2 ? "Choose at least two channels." : "";
  return card;
}
function renderTemplateGroups() {
  if (!templateDraft) return;
  const aux = templateAuxes.find(entry => String(entry.channel) === templateAuxInput.value);
  document.getElementById("templateAuxGroupsTitle").textContent = "This AUX mix" + (aux ? " (" + (aux.label || "AUX " + aux.channel) + ")" : "");
  const scopes = [[document.getElementById("templateAuxGroups"), templateDraft.groupsByAux[templateAuxInput.value] || [], false],
    [document.getElementById("templateGlobalGroups"), templateDraft.globalGroups, true]];
  for (const [container, list, global] of scopes) {
    container.replaceChildren(...list.map(group => templateGroupCard(group, global ? templateDraft.globalGroups : (templateDraft.groupsByAux[templateAuxInput.value] ||= []), global)));
    if (!list.length) { const empty = document.createElement("p"); empty.className = "template-group-empty"; empty.textContent = "No groups."; container.appendChild(empty); }
  }
}
function incompleteTemplateGroup() {
  const group = allTemplateGroups().find(entry => entry.members.length < 2);
  return group ? "Group “" + (group.name.trim() || "Untitled") + "” needs at least two channels, or delete it." : "";
}
// Drop empty per-AUX entries so saved templates stay tidy.
function templateSaveConfig() {
  const config = JSON.parse(JSON.stringify(templateDraft));
  for (const [aux, channels] of Object.entries(config.hiddenByAux)) if (!channels.length) delete config.hiddenByAux[aux];
  for (const [aux, groups] of Object.entries(config.groupsByAux)) if (!groups.length) delete config.groupsByAux[aux];
  return config;
}
document.getElementById("addAuxGroup").addEventListener("click", () => addTemplateGroup(false));
document.getElementById("addGlobalGroup").addEventListener("click", () => addTemplateGroup(true));
function saveDraftOrder() { if (templateDraft) templateDraft.channelOrder = Array.from(templateRows.children, row => Number(row.dataset.channel)); }
function renderTemplateChannels() {
  if (!templateDraft) return;
  if (templateSorter) templateSorter.destroy();
  templateRows.replaceChildren();
  const channels = new Map(templateChannels.map(channel => [channel.channel, channel]));
  const order = [...templateDraft.channelOrder, ...channels.keys()].filter((id, index, ids) => channels.has(id) && ids.indexOf(id) === index);
  const settings = draftAuxSettings(); templateFilterInput.checked = settings.enabled;
  for (const id of order) {
    const channel = channels.get(id), row = document.createElement("div"); row.className = "template-channel"; row.dataset.channel = String(id);
    row.innerHTML = '<button type="button" class="template-drag-handle">' + appIcon("gripVertical") + '</button><span class="template-channel-name"></span><label class="template-hide"><input type="checkbox"> Hidden</label><label class="template-star"><input type="checkbox">' + appIcon("star") + '</label>';
    row.querySelector(".template-channel-name").textContent = channel.label || "Channel " + id;
    const handle = row.querySelector("button"); handle.setAttribute("aria-label", "Move " + (channel.label || "Channel " + id)); handle.addEventListener("keydown", moveTemplateChannel);
    const hide = row.querySelector(".template-hide input"), hidden = draftHidden();
    hide.checked = hidden.includes(id); hide.setAttribute("aria-label", "Hide " + (channel.label || "Channel " + id) + " in this AUX");
    hide.addEventListener("change", () => { const list = draftHidden(); const next = list.filter(value => value !== id); if (hide.checked) next.push(id); templateDraft.hiddenByAux[templateAuxInput.value] = next; });
    const star = row.querySelector(".template-star input"); star.checked = settings.channels.includes(id); star.setAttribute("aria-label", "Favourite " + (channel.label || "Channel " + id));
    star.addEventListener("change", () => { settings.channels = Array.from(templateRows.querySelectorAll('.template-star input:checked'), input => Number(input.closest(".template-channel").dataset.channel)); });
    templateRows.appendChild(row);
  }
  saveDraftOrder();
  templateSorter = new Sortable(templateRows, { draggable: "> .template-channel", handle: ".template-drag-handle", filter: ".template-star, .template-hide", preventOnFilter: false,
    animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180,
    direction: () => getComputedStyle(templateRows).gridTemplateColumns.split(" ").length > 1 ? "horizontal" : "vertical",
    ghostClass: "template-placeholder", dragClass: "template-drag", forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4, onEnd: saveDraftOrder });
  templateRows.classList.toggle("template-grid", templateDraft.view === "grid");
  updateTemplateSortingMode();
  renderTemplateGroups();
  updateAdminTemplateControls();
}
function updateTemplateSortingMode() {
  if (templateSorter) templateSorter.option("handle", templateDraft?.view === "grid" && window.matchMedia("(min-width: 700px)").matches ? null : ".template-drag-handle");
}
window.matchMedia("(min-width: 700px)").addEventListener("change", updateTemplateSortingMode);
function moveTemplateChannel(event) {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault(); const row = event.currentTarget.closest(".template-channel"); const rows = Array.from(templateRows.children);
  const columns = getComputedStyle(templateRows).gridTemplateColumns.split(" ").length;
  const delta = event.key === "ArrowUp" ? -columns : event.key === "ArrowDown" ? columns : event.key === "ArrowLeft" ? -1 : 1;
  const index = rows.indexOf(row) + delta; if (index < 0 || index >= rows.length) return;
  templateRows.insertBefore(row, delta > 0 ? rows[index].nextSibling : rows[index]); event.currentTarget.focus(); row.scrollIntoView({ block: "nearest" }); saveDraftOrder();
}
function showTemplateDraft(name, config) {
  templateNameInput.value = name; templateDraft = JSON.parse(JSON.stringify(config));
  templateDraft.hiddenByAux ||= {}; templateDraft.groupsByAux ||= {}; templateDraft.globalGroups ||= [];
  templateAuxInput.replaceChildren();
  for (const aux of templateAuxes) templateAuxInput.add(new Option(aux.label || "AUX " + aux.channel, String(aux.channel)));
  if (templateAuxes.some(aux => aux.channel === templateDraft.selectedAux)) templateAuxInput.value = String(templateDraft.selectedAux);
  templateDraft.selectedAux = Number(templateAuxInput.value);
  templateViewInput.value = templateDraft.view; templateEditor.hidden = false;
  document.getElementById("templateEditorTitle").textContent = name ? "Edit template" : "New template";
  renderTemplateChannels();
}
document.addEventListener("admin-mixer-config", event => {
  const signature = JSON.stringify(event.detail); if (signature === templateConfigSignature) return;
  templateConfigSignature = signature; templateChannels = event.detail.channels; templateAuxes = event.detail.aux;
  if (templateDraft) showTemplateDraft(templateNameInput.value, templateDraft);
  updateAdminTemplateControls();
});
document.getElementById("newTemplate").addEventListener("click", () => {
  showTemplateDraft("", { selectedAux: templateAuxes[0]?.channel || null, channelOrder: [], favouritesByAux: {}, hiddenByAux: {}, groupsByAux: {}, globalGroups: [], view: "list" });
  adminTemplateMessage(""); templateNameInput.focus();
});
document.getElementById("editSavedTemplate").addEventListener("click", async () => {
  if (!adminTemplateSelect.value || adminTemplateBusy) return;
  adminTemplateBusy = true; updateAdminTemplateControls();
  try { const template = await adminTemplateRequest("/api/templates/" + adminTemplateSelect.value, { cache: "no-store" }); showTemplateDraft(template.name, template.config); adminTemplateMessage(""); }
  catch (error) { adminTemplateMessage(error.message, true); }
  finally { adminTemplateBusy = false; updateAdminTemplateControls(); }
});
document.getElementById("deleteSavedTemplate").addEventListener("click", async () => {
  const selected = adminTemplates.find(template => template.id === adminTemplateSelect.value);
  if (!selected || adminTemplateBusy) return;
  if (!confirm('Delete template “' + selected.name + '”? This cannot be undone. Layouts already loaded by users will not change.')) return;
  adminTemplateBusy = true; updateAdminTemplateControls(); adminTemplateMessage("");
  try {
    await adminTemplateRequest("/api/admin/templates/" + selected.id, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" });
    adminTemplates = adminTemplates.filter(template => template.id !== selected.id);
    const option = Array.from(adminTemplateSelect.options).find(option => option.value === selected.id);
    if (option) option.remove();
    adminTemplateSelect.value = "";
    if (templateNameInput.value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase() === selected.name.toLowerCase()) {
      templateDraft = null; templateEditor.hidden = true;
      if (templateSorter) { templateSorter.destroy(); templateSorter = null; }
    }
    adminTemplateMessage('Deleted “' + selected.name + '”.');
    try { await refreshAdminTemplates(""); }
    catch { adminTemplateMessage("Template deleted, but the list could not refresh. Reload the admin page to refresh it."); }
  } catch (error) { adminTemplateMessage(error.message, true); }
  finally { adminTemplateBusy = false; updateAdminTemplateControls(); }
});
adminTemplateSelect.addEventListener("change", updateAdminTemplateControls);
templateNameInput.addEventListener("input", updateAdminTemplateControls);
templateAuxInput.addEventListener("change", () => { templateDraft.selectedAux = Number(templateAuxInput.value); renderTemplateChannels(); });
templateViewInput.addEventListener("change", () => { templateDraft.view = templateViewInput.value; templateRows.classList.toggle("template-grid", templateDraft.view === "grid"); updateTemplateSortingMode(); });
templateFilterInput.addEventListener("change", () => { draftAuxSettings().enabled = templateFilterInput.checked; });
templateEditor.addEventListener("submit", async event => {
  event.preventDefault(); if (!templateDraft || adminTemplateBusy) return;
  const incomplete = incompleteTemplateGroup();
  if (incomplete) { adminTemplateMessage(incomplete, true); return; }
  adminTemplateBusy = true; updateAdminTemplateControls(); adminTemplateMessage("");
  try {
    const template = await adminTemplateRequest("/api/admin/templates", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: templateNameInput.value, username: templateAuthorInput.value, config: templateSaveConfig() }) });
    localStorage.setItem("templateAdminName", templateAuthorInput.value); templateNameInput.value = template.name;
    document.getElementById("templateEditorTitle").textContent = "Edit template";
    adminTemplateMessage("Saved “" + template.name + "”.");
    try { await refreshAdminTemplates(template.id); }
    catch { adminTemplateMessage("Template saved, but the template list could not refresh. Reload the admin page to refresh it."); }
  } catch (error) { adminTemplateMessage(error.message, true); }
  finally { adminTemplateBusy = false; updateAdminTemplateControls(); }
});
updateAdminTemplateControls();
refreshAdminTemplates().catch(error => adminTemplateMessage(error.message, true));
