"use strict";

// Only public, read-only musician endpoints may be read by browser clients on
// another origin. Never enable credentialed CORS or expose the admin API.
function musicianCors(req, res, next) {
  if (!/^\/api\/(?:connection|templates(?:\/[a-f0-9]{64})?)\/?$/.test(req.path)) return next();
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const requestedMethod = req.get("Access-Control-Request-Method");
  if (req.method === "OPTIONS" && requestedMethod && !["GET", "HEAD"].includes(requestedMethod)) return next();
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Accept, Content-Type");
    res.set("Access-Control-Max-Age", "600");
    return res.sendStatus(204);
  }
  next();
}

module.exports = { musicianCors };
