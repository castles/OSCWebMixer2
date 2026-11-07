"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } = require("node:crypto");
const { promisify } = require("node:util");
const { validateTemplateConfig } = require("./templates.js");
const derive = promisify(scrypt);
const COOKIE = "ears_user_session";
const LIFETIME = 30 * 24 * 60 * 60 * 1000;
class AccountError extends Error { constructor(status, message) { super(message); this.status = status; } }

function username(value) {
  const name = typeof value === "string" ? value.normalize("NFKC").trim() : "";
  if (!/^[a-z\d][a-z\d._-]{2,31}$/i.test(name)) throw new AccountError(400, "Use a username of 3–32 letters, numbers, dots, underscores or hyphens.");
  return name.toLowerCase();
}
function displayName(value) {
  const name = typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw new AccountError(400, "Use a display name between 1 and 80 characters.");
  return name;
}
function password(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128 || !value.trim()) throw new AccountError(400, "Use a password between 8 and 128 characters.");
  return value;
}
function preferences(value) {
  let config;
  try { config = validateTemplateConfig(value); } catch (error) { throw new AccountError(400, error.message); }
  if (typeof value.compact !== "boolean") throw new AccountError(400, "Invalid compact-view setting.");
  const result = { ...config, compact: value.compact };
  if (JSON.stringify(result).length > 65536) throw new AccountError(400, "The saved layout is too large.");
  return result;
}
const digest = token => createHash("sha256").update(token).digest("hex");

function createUserAccounts({ directory = process.env.OSC_WEBMIXER_DATA_DIR || path.join(__dirname, "..", "data"), now = Date.now } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, "earsmixer.sqlite");
  const db = new DatabaseSync(filename);
  fs.chmodSync(filename, 0o600);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > 1) { db.close(); throw new Error("The accounts database requires a newer EarsMixer version."); }
  if (version === 0) db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX sessions_expiry ON sessions(expires_at);
    CREATE INDEX sessions_user ON sessions(user_id);
    CREATE TABLE preferences (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      config_json TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    PRAGMA user_version=1;
    COMMIT;
  `);
  const attempts = new Map();
  let hashes = 0;
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function userView(user) { return { id: user.id, username: user.username, displayName: user.display_name }; }
  function profile(user) {
    const saved = db.prepare("SELECT config_json, revision, updated_at FROM preferences WHERE user_id=?").get(user.id);
    return { user: userView(user), preferences: saved ? JSON.parse(saved.config_json) : null, revision: saved?.revision || 0, updatedAt: saved?.updated_at || null };
  }
  function token(req) {
    const value = req.headers.cookie?.split(";").map(part => part.trim()).find(part => part.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
    return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
  }
  function authenticated(req) {
    const value = token(req);
    return value ? db.prepare("SELECT users.* FROM users JOIN sessions ON sessions.user_id=users.id WHERE token_hash=? AND expires_at>?").get(digest(value), now()) : null;
  }
  function requireUser(req) {
    const user = authenticated(req);
    if (!user) throw new AccountError(401, "Sign in to save your account settings.");
    return user;
  }
  function newSession(req, userId) {
    db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now());
    const previous = token(req);
    if (previous) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(previous));
    const value = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(digest(value), userId, now() + LIFETIME, now());
    return value;
  }
  function setCookie(req, res, value) { res.cookie(COOKIE, value, { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/", maxAge: LIFETIME }); }
  function allowAttempt(req) {
    for (const [key, item] of attempts) if (item.expires <= now()) attempts.delete(key);
    const key = attempts.size < 1000 ? req.socket.remoteAddress || "unknown" : "overflow";
    const item = attempts.get(key) || { count: 0, expires: now() + 60000 };
    if (++item.count > 10) throw new AccountError(429, "Too many sign-in attempts. Try again in a minute.");
    attempts.set(key, item);
  }
  async function hash(value, salt) {
    if (hashes >= 4) throw new AccountError(503, "Sign-in is busy. Try again shortly.");
    hashes++;
    try { return await derive(value, Buffer.from(salt, "hex"), 64); }
    finally { hashes--; }
  }
  function register(app, { adminAuth }) {
    app.use("/api/account", (req, res, next) => {
      res.set("Cache-Control", "no-store");
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        const origin = req.get("Origin");
        if ((origin && origin !== `${req.protocol}://${req.get("Host")}`) || req.get("Sec-Fetch-Site") === "cross-site") return res.status(403).json({ error: "Account requests must come from this mixer." });
        if (!req.is("application/json")) return res.status(415).json({ error: "Send account requests as JSON." });
      }
      next();
    });
    const route = handler => async (req, res) => {
      try { await handler(req, res); }
      catch (error) {
        if (!error.status) console.error("Account request failed:", error.message);
        if ([429, 503].includes(error.status)) res.set("Retry-After", error.status === 429 ? "60" : "5");
        res.status(error.status || 500).json({ error: error.status ? error.message : "Could not update the account. Please try again." });
      }
    };
    app.get("/api/account", route((req, res) => {
      const user = authenticated(req);
      res.json(user ? profile(user) : { user: null, preferences: null, revision: 0 });
    }));
    app.post("/api/account/register", route(async (req, res) => {
      allowAttempt(req);
      const name = username(req.body?.username);
      const label = displayName(req.body?.displayName || name);
      const secret = password(req.body?.password);
      if (db.prepare("SELECT id FROM users WHERE username=?").get(name)) throw new AccountError(409, "That username is already in use.");
      const salt = randomBytes(16).toString("hex");
      const key = (await hash(secret, salt)).toString("hex");
      const id = randomUUID();
      let session;
      try {
        session = transaction(() => {
          db.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, name, label, salt, key, now(), now());
          return newSession(req, id);
        });
      } catch (error) {
        if (db.prepare("SELECT id FROM users WHERE username=?").get(name)) throw new AccountError(409, "That username is already in use.");
        throw error;
      }
      setCookie(req, res, session);
      res.status(201).json(profile(db.prepare("SELECT * FROM users WHERE id=?").get(id)));
    }));
    app.post("/api/account/login", route(async (req, res) => {
      allowAttempt(req);
      const name = username(req.body?.username);
      const secret = typeof req.body?.password === "string" && req.body.password.length <= 128 ? req.body.password : "";
      const user = db.prepare("SELECT * FROM users WHERE username=?").get(name);
      // Perform the same KDF even when the username does not exist.
      const candidate = await hash(secret, user?.password_salt || "0".repeat(32));
      const valid = user && timingSafeEqual(candidate, Buffer.from(user.password_hash, "hex"));
      const current = user && db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
      if (!valid || current?.password_hash !== user.password_hash) throw new AccountError(401, "Incorrect username or password.");
      const session = transaction(() => newSession(req, user.id));
      setCookie(req, res, session);
      res.json(profile(current));
    }));
    app.post("/api/account/logout", route((req, res) => {
      const value = token(req);
      if (value) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(value));
      res.clearCookie(COOKIE, { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/" });
      res.json({ ok: true });
    }));
    app.put("/api/account", route((req, res) => {
      const user = requireUser(req);
      if (req.body?.userId !== user.id) throw new AccountError(401, "The signed-in account changed. Sign in again before saving.");
      db.prepare("UPDATE users SET display_name=?, updated_at=? WHERE id=?").run(displayName(req.body?.displayName), now(), user.id);
      res.json(profile(db.prepare("SELECT * FROM users WHERE id=?").get(user.id)));
    }));
    app.put("/api/account/preferences", route((req, res) => {
      const user = requireUser(req);
      if (req.body?.userId !== user.id) throw new AccountError(401, "The signed-in account changed. Sign in again before saving.");
      const config = preferences(req.body?.preferences);
      const revision = req.body?.revision;
      if (!Number.isSafeInteger(revision) || revision < 0) throw new AccountError(400, "Invalid layout revision.");
      const result = transaction(() => {
        const current = db.prepare("SELECT revision FROM preferences WHERE user_id=?").get(user.id);
        if ((current?.revision || 0) !== revision) return null;
        db.prepare("INSERT INTO preferences VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET config_json=excluded.config_json, revision=excluded.revision, updated_at=excluded.updated_at")
          .run(user.id, JSON.stringify(config), revision + 1, now());
        return profile(user);
      });
      if (!result) return res.status(409).json({ error: "Your layout changed on another device. Reload the saved layout before saving again.", ...profile(user) });
      res.json(result);
    }));
    function adminRequired() {
      // Existing admin middleware verifies the session; management additionally requires a configured password.
      if (!adminAuth.isEnabled()) throw new AccountError(403, "Set an admin password before managing musician accounts.");
    }
    app.get("/api/admin/users", route((_req, res) => {
      adminRequired();
      res.json({ users: db.prepare("SELECT id, username, display_name, created_at FROM users ORDER BY username").all().map(user => ({ ...userView(user), createdAt: user.created_at })) });
    }));
    app.post("/api/admin/users/:id/password", route(async (req, res) => {
      adminRequired(); allowAttempt(req);
      const id = req.params.id;
      if (!db.prepare("SELECT id FROM users WHERE id=?").get(id)) throw new AccountError(404, "Account not found.");
      const salt = randomBytes(16).toString("hex");
      const key = (await hash(password(req.body?.password), salt)).toString("hex");
      transaction(() => {
        const result = db.prepare("UPDATE users SET password_salt=?, password_hash=?, updated_at=? WHERE id=?").run(salt, key, now(), id);
        if (!result.changes) throw new AccountError(404, "Account not found.");
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
      });
      res.json({ ok: true });
    }));
    app.delete("/api/admin/users/:id", route((req, res) => {
      adminRequired();
      const result = db.prepare("DELETE FROM users WHERE id=?").run(req.params.id);
      if (!result.changes) throw new AccountError(404, "Account not found.");
      res.json({ ok: true });
    }));
  }
  return { register, filename, close() { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); db.close(); } };
}

module.exports = { createUserAccounts, validateUserPreferences: preferences };
