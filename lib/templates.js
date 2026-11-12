"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const dataDirectory = process.env.OSC_WEBMIXER_DATA_DIR || path.join(__dirname, "..", "data");
const directory = path.join(dataDirectory, "templates");
let writes = Promise.resolve();
class InvalidTemplate extends Error {
}
function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function positive(value) { return Number.isSafeInteger(value) && Number(value) > 0; }
function numbers(value) {
    if (!Array.isArray(value) || value.length > 1000 || !value.every(positive))
        throw new InvalidTemplate("Channel lists must contain positive channel numbers.");
    return [...new Set(value)];
}
// Channel groups follow the mobile app's rules exactly, so a template the app
// receives is never rejected: unique positive IDs, an optional name of up to
// 80 characters, two or more channels, and no channel in more than one group.
function groups(value) {
    if (!Array.isArray(value) || value.length > 500)
        throw new InvalidTemplate("Invalid channel groups.");
    return value.map(group => {
        if (!object(group) || !positive(group.id) || typeof group.name !== "string" || group.name.length > 80 || /[\x00-\x1f\x7f]/.test(group.name)
            || !Array.isArray(group.members) || group.members.length < 2 || group.members.length > 1000 || !group.members.every(positive))
            throw new InvalidTemplate("Each channel group needs at least two channels and a name of up to 80 characters.");
        return { id: group.id, name: group.name.trim(), members: [...group.members] };
    });
}
function assertDistinct(entries) {
    const ids = new Set(), channels = new Set();
    for (const group of entries) {
        if (ids.has(group.id))
            throw new InvalidTemplate("Channel group IDs must be unique.");
        ids.add(group.id);
        for (const channel of group.members) {
            if (channels.has(channel))
                throw new InvalidTemplate("A channel can only belong to one group.");
            channels.add(channel);
        }
    }
}
function auxKey(aux) {
    if (!/^[1-9]\d*$/.test(aux) || !positive(Number(aux)))
        throw new InvalidTemplate("Invalid AUX number.");
}
function validateTemplateConfig(value) {
    if (!object(value) || (value.selectedAux !== null && !positive(value.selectedAux)) || (value.view !== "list" && value.view !== "grid"))
        throw new InvalidTemplate("Invalid template settings.");
    if (!object(value.favouritesByAux) || Object.keys(value.favouritesByAux).length > 256)
        throw new InvalidTemplate("Invalid favourites settings.");
    const favouritesByAux = {};
    for (const [aux, settings] of Object.entries(value.favouritesByAux)) {
        if (!/^[1-9]\d*$/.test(aux) || !positive(Number(aux)) || !object(settings) || typeof settings.enabled !== "boolean")
            throw new InvalidTemplate("Invalid AUX favourites.");
        favouritesByAux[aux] = { channels: numbers(settings.channels), enabled: settings.enabled };
    }
    // Hidden channels and groups are optional so templates saved before they
    // existed stay valid.
    const hiddenByAux = {};
    if (value.hiddenByAux !== undefined) {
        if (!object(value.hiddenByAux) || Object.keys(value.hiddenByAux).length > 256)
            throw new InvalidTemplate("Invalid hidden channels.");
        for (const [aux, channels] of Object.entries(value.hiddenByAux)) {
            auxKey(aux);
            hiddenByAux[aux] = numbers(channels);
        }
    }
    const globalGroups = groups(value.globalGroups ?? []);
    assertDistinct(globalGroups);
    const groupsByAux = {};
    if (value.groupsByAux !== undefined) {
        if (!object(value.groupsByAux) || Object.keys(value.groupsByAux).length > 256)
            throw new InvalidTemplate("Invalid channel groups.");
        for (const [aux, entries] of Object.entries(value.groupsByAux)) {
            auxKey(aux);
            const mixGroups = groups(entries);
            // A mix's groups combine with the all-mix groups in the app.
            assertDistinct([...globalGroups, ...mixGroups]);
            if (mixGroups.length)
                groupsByAux[aux] = mixGroups;
        }
    }
    return { selectedAux: value.selectedAux, channelOrder: numbers(value.channelOrder), favouritesByAux, hiddenByAux, groupsByAux, globalGroups, view: value.view };
}
function templateName(value) {
    if (typeof value !== "string")
        throw new InvalidTemplate("Enter a template name.");
    const name = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name))
        throw new InvalidTemplate("Use a name between 1 and 80 characters.");
    return name;
}
function idFor(name) { return createHash("sha256").update(name.toLowerCase()).digest("hex"); }
function deviceUsername(value) {
    if (value === undefined || value === null || value === "")
        return null;
    return templateName(value);
}
async function readTemplate(id) {
    const raw = JSON.parse(await fs.readFile(path.join(directory, id + ".json"), "utf8"));
    if (!object(raw) || raw.version !== 1 || raw.id !== id || typeof raw.updatedAt !== "string" || !Number.isFinite(Date.parse(raw.updatedAt)))
        throw new Error("Invalid saved template.");
    const name = templateName(raw.name);
    if (idFor(name) !== id)
        throw new Error("Invalid saved template name.");
    return { version: 1, id, name, createdAt: typeof raw.createdAt === "string" ? raw.createdAt : raw.updatedAt,
        createdBy: deviceUsername(raw.createdBy), updatedAt: raw.updatedAt, updatedBy: deviceUsername(raw.updatedBy), config: validateTemplateConfig(raw.config) };
}
function missing(error) { return error.code === "ENOENT"; }
function useTemplateRoutes(app) {
    app.get("/api/templates", async (_req, res) => {
        try {
            const names = await fs.readdir(directory).catch(error => { if (missing(error))
                return []; throw error; });
            const templates = [];
            for (const file of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
                try {
                    const { config, version, ...summary } = await readTemplate(file.slice(0, -5));
                    templates.push(summary);
                }
                catch (error) {
                    console.error("Could not read template", file, error);
                }
            }
            templates.sort((a, b) => a.name.localeCompare(b.name));
            res.json({ templates });
        }
        catch (error) {
            console.error("Template listing failed", error);
            res.status(500).json({ error: "Could not read saved templates." });
        }
    });
    app.get("/api/templates/:id", async (req, res) => {
        if (!/^[a-f0-9]{64}$/.test(req.params.id)) {
            res.status(400).json({ error: "Invalid template ID." });
            return;
        }
        try {
            res.json(await readTemplate(req.params.id));
        }
        catch (error) {
            res.status(missing(error) ? 404 : 500).json({ error: missing(error) ? "Template not found." : "Could not read this template." });
        }
    });
    app.delete("/api/admin/templates/:id", async (req, res) => {
        const id = req.params.id;
        if (!/^[a-f0-9]{64}$/.test(id)) {
            res.status(400).json({ error: "Invalid template ID." });
            return;
        }
        // Serialize with saves so a pending rename cannot undo a later deletion.
        const result = writes.then(() => fs.unlink(path.join(directory, id + ".json")));
        writes = result.catch(() => { });
        try {
            await result;
            res.json({ success: true });
        } catch (error) {
            res.status(missing(error) ? 404 : 500).json({ error: missing(error) ? "Template not found. Refresh the template list." : "Could not delete this template. Try again." });
        }
    });
    app.put("/api/admin/templates", async (req, res) => {
        let name, config, username;
        try {
            name = templateName(req.body?.name);
            config = validateTemplateConfig(req.body?.config);
            username = deviceUsername(req.body?.username);
        }
        catch (error) {
            res.status(400).json({ error: error instanceof Error ? error.message : "Invalid template." });
            return;
        }
        const id = idFor(name);
        const save = async () => {
            // Preserve an unreadable existing file rather than overwriting it silently.
            let previous;
            try {
                previous = await readTemplate(id);
            }
            catch (error) {
                if (!missing(error))
                    throw error;
            }
            await fs.mkdir(directory, { recursive: true });
            const updatedAt = new Date().toISOString();
            const template = { version: 1, id, name, createdAt: previous?.createdAt || updatedAt,
                createdBy: previous ? previous.createdBy : username, updatedAt, updatedBy: username, config };
            const temporary = path.join(directory, id + "." + randomUUID() + ".tmp");
            try {
                await fs.writeFile(temporary, JSON.stringify(template, null, 2) + "\n", { flag: "wx" });
                await fs.rename(temporary, path.join(directory, id + ".json"));
            }
            finally {
                await fs.unlink(temporary).catch(error => { if (!missing(error))
                    throw error; });
            }
            return template;
        };
        const result = writes.then(save);
        writes = result.catch(() => { });
        try {
            res.json(await result);
        }
        catch (error) {
            console.error("Template save failed", error);
            res.status(500).json({ error: "Could not save your template. Your previous save is unchanged." });
        }
    });
}
module.exports = { useTemplateRoutes, deviceUsername, validateTemplateConfig };
